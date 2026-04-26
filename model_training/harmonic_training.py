import os
import numpy as np
import pandas as pd
import rasterio
import glob
from datetime import datetime
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
import joblib

# --- 1. HARMONIC MATHEMATICS ---
def get_harmonic_coefficients(times, values):
    """
    Fits a sine/cosine wave to a series of values.
    Returns: Mean, Amplitude, Phase
    """
    # Convert dates to a scale of 0 to 2*pi (annual cycle)
    t = np.array([(d - datetime(d.year, 1, 1)).days / 365.25 for d in times])
    omega = 2 * np.pi * t
    
    # Create the design matrix [1, cos, sin]
    X = np.column_stack([np.ones_like(omega), np.cos(omega), np.sin(omega)])
    
    # Solve via Least Squares: y = a + b*cos + c*sin
    try:
        # Using pseudo-inverse to handle potential singular matrices (sparse data)
        coeffs, _, _, _ = np.linalg.lstsq(X, values, rcond=None)
        a, b, c = coeffs
        
        amplitude = np.sqrt(b**2 + c**2)
        phase = np.arctan2(c, b)
        return a, amplitude, phase
    except:
        return 0, 0, 0

# --- 2. TRAINING THE MODEL ---
def train_harmonic_model(csv_data_path):
    """
    Trains the RF model using harmonic features.
    Assumes CSV has: NDVI_mean, NDVI_amp, NDVI_phase, NDBI_mean... etc.
    """
    df = pd.read_csv(csv_data_path)
    
    # Define features based on harmonic outputs
    features = [
        'NDVI_mean', 'NDVI_amp', 'NDVI_phase',
        'NDBI_mean', 'NDBI_amp', 'NDBI_phase',
        'MNDWI_mean', 'MNDWI_amp', 'MNDWI_phase'
    ]
    
    X = df[features]
    y = df['lc']
    
    # 80/20 Random Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    
    rf = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    
    print(f"Model Trained. Test Accuracy: {accuracy_score(y_test, rf.predict(X_test)):.4f}")
    joblib.dump(rf, 'harmonic_rf_model.pkl')
    return rf

# --- 3. INFERENCE ON .TIFF STACK ---
def classify_geotiff_stack(image_folder, model_path):
    """
    Reads a folder of TIFFs, fits harmonics per pixel, and classifies.
    """
    model = joblib.load(model_path)
    tif_files = sorted(glob.glob(os.path.join(image_folder, "*.tif")))
    
    # Extract dates from filenames (Assumes format: YYYY_MM_DD.tif)
    dates = [datetime.strptime(os.path.basename(f)[:10], "%Y_%m_%d") for f in tif_files]
    
    # Load all images into a 3D stack (Time, Height, Width)
    with rasterio.open(tif_files[0]) as src:
        meta = src.meta
        height, width = src.shape
        
    stack = []
    for f in tif_files:
        with rasterio.open(f) as src:
            # Placeholder: In reality, you'd calculate NDVI/NDBI from bands here
            stack.append(src.read(1)) 
    
    full_stack = np.array(stack) # Shape (Time, H, W)
    
    # Reshape to (Pixels, Time) to process in bulk
    pixels_time = full_stack.reshape(len(tif_files), -1).T
    
    # Calculate harmonic features for every pixel
    harmonic_features = []
    for pixel_series in pixels_time:
        mean, amp, phase = get_harmonic_coefficients(dates, pixel_series)
        harmonic_features.append([mean, amp, phase])
    
    # Convert to feature matrix for prediction
    # (Note: You would repeat this for NDBI/MNDWI and concat them)
    X_pred = np.array(harmonic_features)
    
    predictions = model.predict(X_pred)
    
    # Reshape back to image dimensions
    output_map = predictions.reshape(height, width)
    
    # Save result
    meta.update(count=1, dtype='int16')
    with rasterio.open('classified_harmonic_output.tif', 'w', **meta) as dst:
        dst.write(output_map.astype('int16'), 1)
    
    print("Classification complete. Saved to: classified_harmonic_output.tif")

# --- EXECUTION ---
# 1. Train (requires a CSV prepared with harmonic features)
model = train_harmonic_model('land_use_harmonic_all.csv')

joblib.dump(model, 'harmonic_model.pkl')