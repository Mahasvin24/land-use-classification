# main.py
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import io
import base64
import re

import joblib
import numpy as np
import rasterio
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from matplotlib.colors import ListedColormap
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

app = FastAPI()

# CORS so Next.js frontend (e.g. localhost:3000) can call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Load models once at startup; paths relative to this file so CWD doesn't matter.
# Each model loads independently: a missing pickle makes only that model's endpoint
# return 503 rather than taking down the whole server.
MODEL_PATH = Path(__file__).resolve().parent / "terrae.pkl"
if MODEL_PATH.exists():
    model = joblib.load(MODEL_PATH)
else:
    model = None
    print(
        f"[startup] Terrae model not found at {MODEL_PATH}. "
        "/predict will return 503 until the file is present."
    )

# --- Oscilla v1 (harmonic time-series) model, loaded independently of Terrae ---
OSCILLA_MODEL_PATH = Path(__file__).resolve().parent / "oscilla.pkl"
if OSCILLA_MODEL_PATH.exists():
    oscilla_model = joblib.load(OSCILLA_MODEL_PATH)
else:
    oscilla_model = None
    print(
        f"[startup] Oscilla model not found at {OSCILLA_MODEL_PATH}. "
        "/predict_oscilla will return 503 until the file is present."
    )

# ESA WorldCover class colors and labels (same as training script)
CLASS_COLORS = [
    "#006400",  # 0: Forest
    "#ffbb22",  # 1: Shrubland
    "#ffff4c",  # 2: Grassland
    "#f096ff",  # 3: Cropland
    "#fa0000",  # 4: Built-up
    "#b4b4b4",  # 5: Bare
    "#0064ff",  # 6: Water
]
CLASS_LABELS = {
    0: "Forest",
    1: "Shrubland",
    2: "Grassland",
    3: "Cropland",
    4: "Built-up",
    5: "Bare",
    6: "Water",
}
CUSTOM_CMAP = ListedColormap(CLASS_COLORS)

# Post-classification spatial smoothing. A per-pixel classifier can produce
# salt-and-pepper noise: a lone Grassland pixel surrounded by Built-up is
# almost certainly Built-up that the model got wrong. A small majority filter
# reclassifies each pixel to the most common class in its neighborhood,
# cleaning up isolated misclassifications while preserving real boundaries.
DEFAULT_SMOOTHING_WINDOW = 3


_BAND_CODE_TARGET_WAVELENGTH_NM = {
    "B2": 492.0,   # Blue
    "B3": 560.0,   # Green
    "B4": 665.0,   # Red
    "B8": 842.0,   # NIR
    "B11": 1610.0, # SWIR1
}
_BAND_CODE_WAVELENGTH_TOLERANCE_NM = {
    "B2": 80.0,
    "B3": 90.0,
    "B4": 90.0,
    "B8": 140.0,
    "B11": 220.0,
}
_BAND_CODE_TOKEN_ALIASES = {
    "B2": ("b2", "band2", "blue", "coastalblue"),
    "B3": ("b3", "band3", "green"),
    "B4": ("b4", "band4", "red"),
    "B8": ("b8", "band8", "nir", "nir08", "nearinfrared", "nearir"),
    "B11": ("b11", "band11", "swir1", "swir01", "swir", "shortwaveinfrared1"),
}


def _tokenize_band_text(value: str) -> List[str]:
    lowered = value.lower().replace("μ", "u").replace("µ", "u")
    return [tok for tok in re.split(r"[^a-z0-9]+", lowered) if tok]


def _to_compact_tokens(tokens: List[str]) -> set:
    compact = set(tokens)
    compact.update("".join(tokens[i : i + 2]) for i in range(max(0, len(tokens) - 1)))
    compact.update("".join(tokens[i : i + 3]) for i in range(max(0, len(tokens) - 2)))
    return compact


def _parse_wavelength_nm(raw_value: object) -> Optional[float]:
    if raw_value is None:
        return None
    text = str(raw_value).strip().lower().replace("μ", "u").replace("µ", "u")
    if not text:
        return None
    match = re.search(r"(-?\d+(?:\.\d+)?)", text)
    if not match:
        return None
    numeric = float(match.group(1))
    if "um" in text:
        return numeric * 1000.0
    if "nm" in text:
        return numeric
    # Heuristic: small values are usually micrometers, large values nanometers.
    if 0.1 <= numeric <= 20:
        return numeric * 1000.0
    if 200 <= numeric <= 3000:
        return numeric
    return None


def _extract_band_hints(src: rasterio.io.DatasetReader) -> List[Dict[str, object]]:
    hints: List[Dict[str, object]] = []
    descriptions = src.descriptions or ()
    for band_idx in src.indexes:
        per_band_tags = src.tags(band_idx) or {}
        desc = descriptions[band_idx - 1] if (band_idx - 1) < len(descriptions) else ""
        text_parts = [str(desc)] + [f"{k}:{v}" for k, v in per_band_tags.items()]
        tokens = _tokenize_band_text(" ".join(text_parts))
        compact_tokens = _to_compact_tokens(tokens)
        wavelength_nm = None
        for key in (
            "wavelength",
            "wavelength_nm",
            "center_wavelength",
            "center_wavelength_nm",
            "band_wavelength",
            "band_wavelength_nm",
        ):
            if key in per_band_tags:
                wavelength_nm = _parse_wavelength_nm(per_band_tags.get(key))
                if wavelength_nm is not None:
                    break
        hints.append(
            {
                "band_idx_1based": band_idx,
                "tokens": compact_tokens,
                "wavelength_nm": wavelength_nm,
            }
        )
    return hints


def _resolve_required_band_indices(
    src: rasterio.io.DatasetReader,
    required_codes: List[str],
    context_name: str,
    positional_fallback: Optional[List[int]] = None,
) -> Tuple[List[int], str]:
    hints = _extract_band_hints(src)
    selected: Dict[str, int] = {}
    used_band_indices = set()

    # Pass 1: explicit token matches from descriptions/tags.
    for code in required_codes:
        aliases = _BAND_CODE_TOKEN_ALIASES[code]
        candidates = [
            i
            for i, hint in enumerate(hints)
            if i not in used_band_indices and any(alias in hint["tokens"] for alias in aliases)
        ]
        if len(candidates) > 1:
            candidate_bands = ", ".join(str(hints[i]["band_idx_1based"]) for i in candidates)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{context_name}: ambiguous metadata for {code}; matching bands: "
                    f"{candidate_bands}. Please export with unambiguous band metadata."
                ),
            )
        if len(candidates) == 1:
            selected[code] = candidates[0]
            used_band_indices.add(candidates[0])

    # Pass 2: wavelength-based matches for unresolved required bands.
    unresolved = [code for code in required_codes if code not in selected]
    for code in unresolved:
        target = _BAND_CODE_TARGET_WAVELENGTH_NM[code]
        tolerance = _BAND_CODE_WAVELENGTH_TOLERANCE_NM[code]
        candidates: List[Tuple[float, int]] = []
        for i, hint in enumerate(hints):
            if i in used_band_indices:
                continue
            wavelength = hint["wavelength_nm"]
            if wavelength is None:
                continue
            diff = abs(float(wavelength) - target)
            if diff <= tolerance:
                candidates.append((diff, i))
        if not candidates:
            continue
        candidates.sort(key=lambda t: t[0])
        if len(candidates) > 1 and abs(candidates[0][0] - candidates[1][0]) < 1e-6:
            b1 = hints[candidates[0][1]]["band_idx_1based"]
            b2 = hints[candidates[1][1]]["band_idx_1based"]
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{context_name}: ambiguous wavelength mapping for {code} between "
                    f"bands {b1} and {b2}. Please provide clearer band metadata."
                ),
            )
        chosen = candidates[0][1]
        selected[code] = chosen
        used_band_indices.add(chosen)

    unresolved = [code for code in required_codes if code not in selected]
    if unresolved:
        if positional_fallback is not None:
            if src.count < len(positional_fallback):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{context_name}: could not identify required bands "
                        f"{', '.join(unresolved)} from metadata, and file has only "
                        f"{src.count} bands."
                    ),
                )
            return [i - 1 for i in positional_fallback], "fallback"
        raise HTTPException(
            status_code=400,
            detail=(
                f"{context_name}: could not identify required bands "
                f"{', '.join(unresolved)} from metadata/wavelength. "
                "Please include explicit band names or center wavelengths."
            ),
        )

    ordered_zero_based = [selected[code] for code in required_codes]
    return ordered_zero_based, "metadata"


def majority_filter(prediction_map: np.ndarray, window_size: int = DEFAULT_SMOOTHING_WINDOW) -> np.ndarray:
    """Replace each pixel with the most common class in its NxN neighborhood.

    Implementation notes:
    - For each class id c, build a binary mask and count how many of its
      pixels fall inside the window around every pixel, using a summed-area
      table (integral image) so the whole pass is O(H*W) per class rather
      than O(H*W*window^2).
    - Edges are padded with the nearest edge value, so border pixels still
      get a full window vote (their out-of-bounds neighbors echo the edge).
    - Ties resolve to the lower class id, which matches how `np.unique`
      orders its output.
    """
    if window_size is None or window_size <= 1:
        return prediction_map
    if window_size % 2 == 0:
        window_size += 1
    if prediction_map.ndim != 2:
        return prediction_map

    h, w = prediction_map.shape
    pad = window_size // 2
    classes = np.unique(prediction_map)
    if classes.size <= 1:
        return prediction_map

    best_count = np.full((h, w), -1, dtype=np.int32)
    smoothed = np.empty_like(prediction_map)

    for c in classes:
        mask = (prediction_map == c).astype(np.int32)
        padded = np.pad(mask, pad, mode="edge")
        sat = np.zeros((padded.shape[0] + 1, padded.shape[1] + 1), dtype=np.int32)
        sat[1:, 1:] = padded.cumsum(axis=0).cumsum(axis=1)
        bottom = window_size
        right = window_size
        counts = (
            sat[bottom : bottom + h, right : right + w]
            - sat[0:h, right : right + w]
            - sat[bottom : bottom + h, 0:w]
            + sat[0:h, 0:w]
        )
        winning = counts > best_count
        smoothed = np.where(winning, c, smoothed)
        best_count = np.where(winning, counts, best_count)

    return smoothed.astype(prediction_map.dtype)


def preprocess_geotiff(contents: bytes, n_features: int):
    """
    Mirror training script: load GeoTIFF, require at least the needed Terrae bands,
    and optionally add NDVI for a 5-feature model.
    Returns (pixels array shape (n_pixels, n_features), height, width).
    """
    try:
        with rasterio.open(io.BytesIO(contents)) as src:
            band_indices, _selection_mode = _resolve_required_band_indices(
                src=src,
                required_codes=["B2", "B3", "B4", "B8"],
                context_name="Terrae",
                positional_fallback=[1, 2, 3, 4],
            )
            img = src.read(indexes=[i + 1 for i in band_indices]).astype(np.float32)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(
            status_code=400,
            detail=(
                f"Failed to open GeoTIFF: {str(e)}. Expected a valid raster that "
                "includes B2, B3, B4, and B8 in the first 4 bands."
            ),
        )

    if img.shape[0] != 4:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected 4 selected bands (B2, B3, B4, B8), but got "
                f"{img.shape[0]} bands."
            ),
        )

    h, w = img.shape[1], img.shape[2]

    if n_features == 5:
        # Optional 5-feature model: add NDVI. Band order B2, B3, B4, B8 -> NIR=index 3, red=index 2
        nir, red = img[3], img[2]
        ndvi = (nir - red) / (nir + red + 1e-10)
        # Stack to [B2, B3, B4, B8, NDVI]
        input_data = np.concatenate([img, ndvi[np.newaxis, :]], axis=0)
    else:
        input_data = img

    # Reshape: (Bands, H, W) -> (H, W, Bands) -> (n_pixels, n_features)
    img_reshaped = input_data.transpose(1, 2, 0).reshape(-1, n_features)
    pixels = np.nan_to_num(img_reshaped, nan=0.0, posinf=0.0, neginf=0.0)
    return pixels, h, w


def build_preview_base64(prediction_map: np.ndarray) -> str:
    """Build color-coded PNG from prediction map (integer class IDs) and return base64 string."""
    buf = io.BytesIO()
    plt.imsave(buf, prediction_map, cmap=CUSTOM_CMAP, format="png")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    smoothing_window: int = Query(
        DEFAULT_SMOOTHING_WINDOW,
        ge=0,
        le=11,
        description=(
            "Side length of the square majority filter applied after "
            "classification to clean up isolated misclassified pixels. "
            "Use 0 or 1 to disable smoothing."
        ),
    ),
):
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Terrae model is not loaded. Place the pickle at {MODEL_PATH} "
                "and restart the server."
            ),
        )
    contents = await file.read()
    filename = file.filename or "image.tif"

    n_features = getattr(model, "n_features_in_", 4)
    if n_features not in (4, 5):
        raise HTTPException(
            status_code=500,
            detail=f"Model expects {n_features} features; only 4-band or 5-band (4+NDVI) are supported.",
        )

    try:
        pixels, h, w = preprocess_geotiff(contents, n_features)
    except HTTPException:
        raise

    prediction = model.predict(pixels)
    if prediction.shape[0] != h * w:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction size {prediction.shape[0]} does not match image pixels {h * w}.",
        )
    prediction_map = prediction.reshape(h, w)
    prediction_map = majority_filter(prediction_map, window_size=smoothing_window)

    preview_image_base64 = build_preview_base64(prediction_map)

    # Return prediction_map as nested list for JSON (height x width)
    prediction_list = prediction_map.tolist()

    return {
        "height": h,
        "width": w,
        "prediction_map": prediction_list,
        "filename": filename,
        "preview_image_base64": preview_image_base64,
        "class_legend": CLASS_LABELS,
        "smoothing_window": int(smoothing_window),
    }


# ---------------------------------------------------------------------------
# Oscilla v1: harmonic time-series classification
# ---------------------------------------------------------------------------
# Independent of Terrae. Expects multiple 5-band (B2, B3, B4, B8, B11) GeoTIFFs
# of the same area across different dates. Filenames must start with
# YYYY_MM_DD so we can fit an annual sine/cosine to each pixel's index curve.

_OSCILLA_DATE_RE = re.compile(r"^(\d{4})_(\d{2})_(\d{2})")
# Oscilla only mathematically needs Green, Red, NIR, SWIR1. Two layouts are allowed:
#   4 bands: B3, B4, B8, B11
#   5 bands: B2, B3, B4, B8, B11 (Blue is ignored)
_OSCILLA_FEATURE_COUNT = 9   # 3 indices x (mean, amp, phase)
_OSCILLA_MIN_DATES = 3


def _oscilla_parse_date(name: str) -> datetime:
    """Parse YYYY_MM_DD prefix from filename, e.g. '2023_05_14_sentinel.tif'."""
    if not name:
        raise HTTPException(status_code=400, detail="Oscilla files must have filenames.")
    m = _OSCILLA_DATE_RE.match(name)
    if not m:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Filename '{name}' must start with YYYY_MM_DD (e.g. 2023_05_14.tif) "
                "so the harmonic fit knows each image's acquisition date."
            ),
        )
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Filename '{name}' has an invalid date prefix: {e}.",
        )


def _oscilla_select_required_bands(img: np.ndarray, name: str) -> np.ndarray:
    """Return a 4-band stack [B3, B4, B8, B11] from flexible input band counts.

    Accepted fallback layouts:
      - >=5 bands where the first 5 are [B2, B3, B4, B8, B11]
      - exactly 4 bands as [B3, B4, B8, B11]

    Any extra trailing bands are ignored.
    """
    if img.shape[0] >= 5:
        # Common Sentinel ordering includes blue first; drop blue and keep
        # [green, red, nir, swir1].
        return img[[1, 2, 3, 4], :, :]
    if img.shape[0] == 4:
        return img
    raise HTTPException(
        status_code=400,
        detail=(
            f"Oscilla requires at least 4 ordered bands to derive "
            f"(B3, B4, B8, B11), but '{name}' has {img.shape[0]}."
        ),
    )


def _oscilla_compute_indices(img: np.ndarray):
    """Compute (NDVI, NDBI, MNDWI) as (H, W) float32 arrays.

    Expects exactly 4 bands in order [B3 (Green), B4 (Red), B8 (NIR), B11 (SWIR1)].
    """
    if img.shape[0] != 4:
        raise ValueError(
            f"Unsupported band count {img.shape[0]}; expected 4."
        )
    green, red, nir, swir = img[0], img[1], img[2], img[3]
    eps = 1e-10
    ndvi = (nir - red) / (nir + red + eps)
    ndbi = (swir - nir) / (swir + nir + eps)
    mndwi = (green - swir) / (green + swir + eps)
    return ndvi, ndbi, mndwi


def _oscilla_harmonic_features(dates, series_stack):
    """Fit y = a + b*cos(2*pi*t) + c*sin(2*pi*t) per pixel, vectorized.

    series_stack: (T, P) float32, one row per date, one column per pixel.
    Returns (mean, amplitude, phase) each of shape (P,).
    """
    t = np.array(
        [(d - datetime(d.year, 1, 1)).days / 365.25 for d in dates],
        dtype=np.float64,
    )
    omega = 2 * np.pi * t
    X = np.column_stack([np.ones_like(omega), np.cos(omega), np.sin(omega)])  # (T, 3)
    coeffs, *_ = np.linalg.lstsq(X, series_stack, rcond=None)  # (3, P)
    a, b, c = coeffs
    amp = np.sqrt(b ** 2 + c ** 2)
    phase = np.arctan2(c, b)
    return a.astype(np.float32), amp.astype(np.float32), phase.astype(np.float32)


@app.post("/predict_oscilla")
async def predict_oscilla(
    files: List[UploadFile] = File(...),
    smoothing_window: int = Query(
        DEFAULT_SMOOTHING_WINDOW,
        ge=0,
        le=11,
        description=(
            "Side length of the square majority filter applied after "
            "classification to clean up isolated misclassified pixels. "
            "Use 0 or 1 to disable smoothing."
        ),
    ),
):
    if oscilla_model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Oscilla model is not loaded. Place the pickle at {OSCILLA_MODEL_PATH} "
                "and restart the server."
            ),
        )
    if len(files) < _OSCILLA_MIN_DATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Oscilla needs at least {_OSCILLA_MIN_DATES} dated images to fit "
                f"an annual harmonic (received {len(files)})."
            ),
        )

    dates = []
    ndvi_stack = []
    ndbi_stack = []
    mndwi_stack = []
    ref_shape = None

    for upload in files:
        name = upload.filename or ""
        date = _oscilla_parse_date(name)
        contents = await upload.read()

        try:
            with rasterio.open(io.BytesIO(contents)) as src:
                fallback_layout = [1, 2, 3, 4] if src.count == 4 else [2, 3, 4, 5]
                band_indices, _selection_mode = _resolve_required_band_indices(
                    src=src,
                    required_codes=["B3", "B4", "B8", "B11"],
                    context_name=f"Oscilla ({name})",
                    positional_fallback=fallback_layout,
                )
                img = src.read(indexes=[i + 1 for i in band_indices]).astype(np.float32)
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Failed to open GeoTIFF '{name}': {e}. "
                    "Expected a valid raster containing B3, B4, B8, B11 "
                    "(or B2, B3, B4, B8, B11 with optional extra trailing bands)."
                ),
            )
        img = _oscilla_select_required_bands(img, name)

        h, w = img.shape[1], img.shape[2]
        if ref_shape is None:
            ref_shape = (h, w)
        elif (h, w) != ref_shape:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"All Oscilla images must share the same dimensions. "
                    f"'{name}' is {h}x{w}, expected {ref_shape[0]}x{ref_shape[1]}."
                ),
            )

        ndvi, ndbi, mndwi = _oscilla_compute_indices(img)
        dates.append(date)
        ndvi_stack.append(ndvi)
        ndbi_stack.append(ndbi)
        mndwi_stack.append(mndwi)

    assert ref_shape is not None
    h, w = ref_shape
    n_pixels = h * w

    order = np.argsort([d.toordinal() for d in dates])
    dates_sorted = [dates[i] for i in order]

    def _stack_and_flatten(layers):
        arr = np.stack([layers[i] for i in order], axis=0)  # (T, H, W)
        arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
        return arr.reshape(arr.shape[0], -1).astype(np.float32)  # (T, P)

    ndvi_tp = _stack_and_flatten(ndvi_stack)
    ndbi_tp = _stack_and_flatten(ndbi_stack)
    mndwi_tp = _stack_and_flatten(mndwi_stack)

    ndvi_mean, ndvi_amp, ndvi_phase = _oscilla_harmonic_features(dates_sorted, ndvi_tp)
    ndbi_mean, ndbi_amp, ndbi_phase = _oscilla_harmonic_features(dates_sorted, ndbi_tp)
    mndwi_mean, mndwi_amp, mndwi_phase = _oscilla_harmonic_features(dates_sorted, mndwi_tp)

    feature_matrix = np.column_stack([
        ndvi_mean, ndvi_amp, ndvi_phase,
        ndbi_mean, ndbi_amp, ndbi_phase,
        mndwi_mean, mndwi_amp, mndwi_phase,
    ])  # (P, 9)

    if feature_matrix.shape[1] != _OSCILLA_FEATURE_COUNT:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Oscilla feature matrix has {feature_matrix.shape[1]} columns; "
                f"expected {_OSCILLA_FEATURE_COUNT}."
            ),
        )

    expected_model_features = getattr(oscilla_model, "n_features_in_", _OSCILLA_FEATURE_COUNT)
    if expected_model_features != _OSCILLA_FEATURE_COUNT:
        raise HTTPException(
            status_code=500,
            detail=(
                f"oscilla.pkl expects {expected_model_features} features, but the "
                f"Oscilla pipeline produces {_OSCILLA_FEATURE_COUNT}."
            ),
        )

    prediction = oscilla_model.predict(feature_matrix)
    if prediction.shape[0] != n_pixels:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Oscilla prediction size {prediction.shape[0]} does not match "
                f"image pixels {n_pixels}."
            ),
        )
    prediction_map = prediction.reshape(h, w)
    prediction_map = majority_filter(prediction_map, window_size=smoothing_window)

    preview_image_base64 = build_preview_base64(prediction_map)
    prediction_list = prediction_map.tolist()

    min_date = dates_sorted[0].strftime("%Y-%m-%d")
    max_date = dates_sorted[-1].strftime("%Y-%m-%d")
    synthetic_filename = f"oscilla_{min_date}_to_{max_date}.png"

    return {
        "height": h,
        "width": w,
        "prediction_map": prediction_list,
        "filename": synthetic_filename,
        "preview_image_base64": preview_image_base64,
        "class_legend": CLASS_LABELS,
        "n_dates": len(dates_sorted),
        "smoothing_window": int(smoothing_window),
    }
