import os
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
from sklearn.model_selection import train_test_split
import joblib

# 1. LOAD THE COMBINED DATASET
TIMESERIES_CSV = 'combined_land_use_temporal.csv'
df_master = pd.read_csv(TIMESERIES_CSV)
print(f"Loaded {len(df_master):,} rows from {TIMESERIES_CSV}")

# 2. FEATURE ENGINEERING
def engineer_flexible_features(df):
    """
    Uses temporal statistics that are independent of the specific 
    number of months provided.
    """
    # Relative Variation (Coefficient of Variation)
    # Useful if absolute brightness varies due to sensors/seasons
    df['NDVI_rel_var'] = df['NDVI_stdDev'] / (df['NDVI_mean'] + 0.001)
    df['NDBI_rel_var'] = df['NDBI_stdDev'] / (df['NDBI_mean'].abs() + 0.001)
    
    return df

df_master = engineer_flexible_features(df_master)

# 3. SELECT FEATURES & TARGET
# Base features plus the new engineered columns
all_features = [
    'NDVI_mean', 'NDVI_stdDev', 'NDBI_mean', 'NDBI_stdDev', 
    'MNDWI_mean', 'MNDWI_stdDev', 'BSI_mean', 'BSI_stdDev', 
    'EVI_mean', 'EVI_stdDev', 'NDVI_slope', 'NDVI_rel_var', 'NDBI_rel_var'
]
target = 'lc'

y = df_master[target]
X = df_master[all_features]

# 4. TRAIN/VAL SPLIT
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=0.20, stratify=y, random_state=42
)

# 5. INITIALIZE & TRAIN RANDOM FOREST
rf_optimized = RandomForestClassifier(
    n_estimators=500, 
    max_depth=15, 
    min_samples_leaf=5, 
    max_features='sqrt',
    class_weight='balanced', 
    random_state=42, 
    n_jobs=-1
)
rf_optimized.fit(X_train, y_train)

# 6. FINAL EVALUATION
y_pred = rf_optimized.predict(X_val)
print("\n--- Final Model Results ---")
print(f"Optimized Accuracy: {accuracy_score(y_val, y_pred):.4f}")
print(classification_report(y_val, y_pred))

output_csv = 'final_combined_dataset_temporal_trained.csv'
df_master.to_csv(output_csv, index=False)
joblib.dump(rf_optimized, 'optimized_model_temporal.pkl')

print(f"\nEnriched CSV exported to: {output_csv}")
print(f"Model saved to: optimized_model_temporal.pkl")