import os
import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
from sklearn.model_selection import train_test_split
import joblib
import glob

# 1. DATA LOADING & SIMULATED "DOWNLOAD"
# In a local VS Code env, 'downloading' usually means gathering the exported CSVs 
# from your project folder.
# Dynamic path — resolves to the project root regardless of machine
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = BASE_DIR + os.sep   # kept for output file references below

# Load the time-series-enriched dataset (includes NDVI_Q1-Q4 + phenological features)
# Run model_training/generate_timeseries_dataset.py first if this file does not exist.
TIMESERIES_CSV = os.path.join(BASE_DIR, 'final_combined_dataset_timeseries.csv')
if not os.path.exists(TIMESERIES_CSV):
    raise FileNotFoundError(
        f"Time series dataset not found: {TIMESERIES_CSV}\n"
        "Please run:  python model_training/generate_timeseries_dataset.py"
    )
df_master = pd.read_csv(TIMESERIES_CSV)
print(f"Loaded {len(df_master):,} rows from {TIMESERIES_CSV}")


# 2. DEFINE FEATURES BASED ON YOUR GEE EXPORT
# These must match the 'selectors' in your GEE JavaScript code

spectral_bands = ['B8','B11']
indices = ['entropy','NDVI', 'NDBI', 'MNDWI', 'BSI']

# -----------------------------------------------------------------------
# PLAN 1: PHENOLOGICAL FEATURE ENGINEERING (Option A)
# Requires quarterly NDVI columns exported from GEE:
#   NDVI_Q1 = Jan–Mar median, NDVI_Q2 = Apr–Jun, NDVI_Q3 = Jul–Sep, NDVI_Q4 = Oct–Dec
# -----------------------------------------------------------------------
quarterly_cols = ['NDVI_Q1', 'NDVI_Q2', 'NDVI_Q3', 'NDVI_Q4']
df_master['NDVI_amplitude']    = df_master['NDVI_Q3'] - df_master['NDVI_Q1']   # peak - winter: high for grassland
df_master['NDVI_greenup_rate'] = df_master['NDVI_Q2'] - df_master['NDVI_Q1']   # spring rise rate
df_master['NDVI_winter_green'] = df_master['NDVI_Q1']                           # evergreen proxy: high for shrubland
temporal_features = quarterly_cols + ['NDVI_amplitude', 'NDVI_greenup_rate', 'NDVI_winter_green']

# We are dropping 'entropy' here since we saw it was weak/high-VIF
all_features = spectral_bands + indices + temporal_features
target = 'lc'

y = df_master['lc']
X = df_master[all_features]
# 3. DIFFERENTIATE TRAIN/VAL USING THE GEE RANDOM SPLIT
# This replaces standard train_test_split to keep spatial consistency
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=0.20, stratify=y, random_state=42
)


rf_optimized = RandomForestClassifier(n_estimators=500, max_depth=15, min_samples_leaf=5, 
                                      max_features='sqrt',class_weight='balanced', random_state=42, n_jobs=-1)
rf_optimized.fit(X_train, y_train)

# 7. FINAL EVALUATION
y_pred = rf_optimized.predict(X_val)
print("\n--- Final Model Results ---")
print(f"Optimized Accuracy: {accuracy_score(y_val, y_pred):.4f}")
print(classification_report(y_val, y_pred))

# 8. SAVE OUTPUTS
# Export the enriched dataset with all temporal/phenological features included
output_csv = path + 'final_combined_dataset_temporal.csv'
df_master.to_csv(output_csv, index=False)
print(f"\nEnriched CSV exported to: {output_csv}")
print(f"New columns added: {['NDVI_amplitude', 'NDVI_greenup_rate', 'NDVI_winter_green']}")

joblib.dump(rf_optimized, path + 'optimized_model_temporal.pkl')

print(f"\nSuccess! Enriched CSV and updated model saved to {path}")