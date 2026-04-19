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
path = 'C:\\Users\\micoc\\OneDrive\\Documents\\GitHub\\land-use-classification\\'
#all_files = glob.glob(path + "land_use_grid_*.csv")

# Stitching them into one dataframe
#df_master = pd.concat((pd.read_csv(f) for f in all_files), ignore_index=True)
df_master = pd.read_csv(path + 'final_combined_dataset.csv')


# 2. DEFINE FEATURES BASED ON YOUR GEE EXPORT
# These must match the 'selectors' in your GEE JavaScript code

spectral_bands = ['B8','B11']
indices = ['entropy','NDVI', 'NDBI', 'MNDWI', 'BSI']
# We are dropping 'entropy' here since we saw it was weak/high-VIF
all_features = spectral_bands + indices
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
# Saving the combined master CSV to your local environment as requested
#df_master.to_csv(path + 'final_combined_dataset.csv', index=False)
joblib.dump(rf_optimized, path + 'optimized_model.pkl')

print(f"\nSuccess! Master CSV saved and model stored in {path}")