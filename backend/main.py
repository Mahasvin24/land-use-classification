# main.py
from pathlib import Path
import io
import base64

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

# Load model once at startup; path relative to this file so CWD doesn't matter
MODEL_PATH = Path(__file__).resolve().parent / "optimized_model_temporal.pkl"
if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Model file not found at {MODEL_PATH}. "
        "Place a 4-band (or 5-band with NDVI) RandomForest model.pkl in the backend directory."
    )
model = joblib.load(MODEL_PATH)

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
