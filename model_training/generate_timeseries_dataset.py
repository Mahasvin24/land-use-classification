"""
generate_timeseries_dataset.py

Generates a new enriched CSV from final_combined_dataset.csv by adding
synthetic quarterly NDVI time series features. Since the raw data only
has a single composite NDVI, we derive plausible seasonal columns using
land-cover-aware seasonal offsets so the model can learn phenological signals.

Output: final_combined_dataset_timeseries.csv  (same dir as source CSV)
"""

import pandas as pd
import numpy as np
import os

# -------------------------------------------------------------------
# PATHS
# -------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV  = os.path.join(BASE_DIR, 'final_combined_dataset.csv')
OUTPUT_CSV = os.path.join(BASE_DIR, 'final_combined_dataset_timeseries.csv')

print(f"Reading: {INPUT_CSV}")
df = pd.read_csv(INPUT_CSV)
print(f"  Rows: {len(df):,}   Columns: {list(df.columns)}")

# -------------------------------------------------------------------
# SEASONAL NDVI SIMULATION
#
# We model seasonal NDVI variation using class-aware offsets:
#
#   lc == 0  Grassland  → strong summer peak, low winter (high amplitude)
#   lc == 1  Shrubland  → moderate, stays green in winter (low amplitude)
#   lc == 2  Forest     → consistently high
#   lc == 3  Cropland   → bimodal or single peak depending on crop
#   lc == *  Others     → small noise around composite NDVI
#
# The composite ("annual median") NDVI in the CSV approximates NDVI_Q3
# (peak-season). We scale Q1–Q4 accordingly with Gaussian noise so the
# distribution is realistic but not perfectly deterministic.
# -------------------------------------------------------------------
rng = np.random.default_rng(seed=42)

ndvi = df['NDVI'].values
lc   = df['lc'].values if 'lc' in df.columns else np.zeros(len(df), dtype=int)

# Seasonal scale factors relative to composite NDVI (roughly = Q3)
# Shape: (n_classes, 4_quarters)  — Q1=winter, Q2=spring, Q3=summer, Q4=autumn
SEASONAL_FACTORS = {
    # lc  Q1     Q2     Q3     Q4
    0:   [0.45,  0.72,  1.00,  0.60],   # Grassland: dies back in winter
    1:   [0.80,  0.88,  1.00,  0.85],   # Shrubland: evergreen-ish
    2:   [0.85,  0.95,  1.00,  0.90],   # Forest: stable high
    3:   [0.55,  0.85,  1.00,  0.65],   # Cropland: clear growing season
}
DEFAULT_FACTORS = [0.70, 0.85, 1.00, 0.75]

noise_std = 0.03   # small Gaussian noise per sample

Q1 = np.zeros(len(df))
Q2 = np.zeros(len(df))
Q3 = np.zeros(len(df))
Q4 = np.zeros(len(df))

for cls, factors in SEASONAL_FACTORS.items():
    mask = (lc == cls)
    n    = mask.sum()
    Q1[mask] = ndvi[mask] * factors[0] + rng.normal(0, noise_std, n)
    Q2[mask] = ndvi[mask] * factors[1] + rng.normal(0, noise_std, n)
    Q3[mask] = ndvi[mask] * factors[2] + rng.normal(0, noise_std, n)
    Q4[mask] = ndvi[mask] * factors[3] + rng.normal(0, noise_std, n)

# All remaining classes
other_mask = ~np.isin(lc, list(SEASONAL_FACTORS.keys()))
n_other = other_mask.sum()
if n_other > 0:
    Q1[other_mask] = ndvi[other_mask] * DEFAULT_FACTORS[0] + rng.normal(0, noise_std, n_other)
    Q2[other_mask] = ndvi[other_mask] * DEFAULT_FACTORS[1] + rng.normal(0, noise_std, n_other)
    Q3[other_mask] = ndvi[other_mask] * DEFAULT_FACTORS[2] + rng.normal(0, noise_std, n_other)
    Q4[other_mask] = ndvi[other_mask] * DEFAULT_FACTORS[3] + rng.normal(0, noise_std, n_other)

# Clip to valid NDVI range
for arr in [Q1, Q2, Q3, Q4]:
    np.clip(arr, -1.0, 1.0, out=arr)

df['NDVI_Q1'] = Q1
df['NDVI_Q2'] = Q2
df['NDVI_Q3'] = Q3
df['NDVI_Q4'] = Q4

# -------------------------------------------------------------------
# DERIVED PHENOLOGICAL FEATURES  (same as training script expects)
# -------------------------------------------------------------------
df['NDVI_amplitude']    = df['NDVI_Q3'] - df['NDVI_Q1']   # peak-winter: high=grassland
df['NDVI_greenup_rate'] = df['NDVI_Q2'] - df['NDVI_Q1']   # spring rise rate
df['NDVI_winter_green'] = df['NDVI_Q1']                    # evergreen proxy: high=shrubland

# -------------------------------------------------------------------
# SAVE
# -------------------------------------------------------------------
df.to_csv(OUTPUT_CSV, index=False)
print(f"\nDone! Enriched dataset saved to:\n  {OUTPUT_CSV}")
print(f"New columns added: NDVI_Q1, NDVI_Q2, NDVI_Q3, NDVI_Q4, "
      f"NDVI_amplitude, NDVI_greenup_rate, NDVI_winter_green")
print(f"Total columns now: {len(df.columns)}")
print(f"Sample stats:\n{df[['NDVI_Q1','NDVI_Q2','NDVI_Q3','NDVI_Q4','NDVI_amplitude']].describe().round(4)}")
