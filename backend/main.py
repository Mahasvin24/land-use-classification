# main.py
from pathlib import Path
from datetime import datetime
from typing import List
import io
import base64
import re

import joblib
import numpy as np
import rasterio
from fastapi import FastAPI, File, UploadFile, HTTPException
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


def preprocess_geotiff(contents: bytes, n_features: int):
    """
    Mirror training script: load GeoTIFF, validate 4 bands, optionally add NDVI for 5-feature model.
    Returns (pixels array shape (n_pixels, n_features), height, width).
    """
    try:
        with rasterio.open(io.BytesIO(contents)) as src:
            img = src.read().astype(np.float32)  # shape: [Bands, Height, Width]
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to open GeoTIFF: {str(e)}. Expected a valid 4-band (B2, B3, B4, B8) raster.",
        )

    if img.shape[0] != 4:
        raise HTTPException(
            status_code=400,
            detail=f"Expected 4 bands (B2, B3, B4, B8), but got {img.shape[0]} bands.",
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
async def predict(file: UploadFile = File(...)):
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
_OSCILLA_ALLOWED_BAND_COUNTS = (4, 5)
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


def _oscilla_compute_indices(img: np.ndarray):
    """Compute (NDVI, NDBI, MNDWI) as (H, W) float32 arrays.

    Supports two band layouts:
      - 4 bands in order [B3 (Green), B4 (Red), B8 (NIR), B11 (SWIR1)]
      - 5 bands in order [B2 (Blue), B3 (Green), B4 (Red), B8 (NIR), B11 (SWIR1)]
    Blue is not used in any of the three indices; it is accepted but ignored in
    the 5-band case because that ordering matches common Sentinel-2 exports.
    """
    if img.shape[0] == 5:
        green, red, nir, swir = img[1], img[2], img[3], img[4]
    elif img.shape[0] == 4:
        green, red, nir, swir = img[0], img[1], img[2], img[3]
    else:
        raise ValueError(
            f"Unsupported band count {img.shape[0]}; expected 4 or 5."
        )
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
async def predict_oscilla(files: List[UploadFile] = File(...)):
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
                img = src.read().astype(np.float32)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Failed to open GeoTIFF '{name}': {e}. "
                    "Expected a valid 4-band (B3, B4, B8, B11) or "
                    "5-band (B2, B3, B4, B8, B11) raster."
                ),
            )

        if img.shape[0] not in _OSCILLA_ALLOWED_BAND_COUNTS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Oscilla expects 4 bands (B3, B4, B8, B11) or "
                    f"5 bands (B2, B3, B4, B8, B11) per image; "
                    f"'{name}' has {img.shape[0]} bands."
                ),
            )

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
    }
