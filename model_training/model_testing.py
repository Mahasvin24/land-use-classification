import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, 
    cohen_kappa_score, 
    confusion_matrix, 
    classification_report
)

# --- 1. SETUP ---
# Update these paths to your local file locations
csv_path = 'land_use_harmonic_all.csv'
model_path = 'harmonic_rf_model.pkl'

df = pd.read_csv(csv_path)
model = joblib.load(model_path)

# --- 2. FEATURE ALIGNMENT ---
# We extract the exact features the model was built to use
try:
    features = model.feature_names_in_.tolist()
    print(f"Model loaded. Testing on the following {len(features)} features:")
    print(features)
except AttributeError:
    # Fallback if the model doesn't store feature names
    features = ['NDVI_mean', 'NDVI_stdDev', 'NDBI_mean', 'NDBI_stdDev', 
                'MNDWI_mean', 'MNDWI_stdDev', 'BSI_mean', 'BSI_stdDev', 
                'EVI_mean', 'EVI_stdDev', 'NDVI_slope', 'NDVI_rel_var', 'NDBI_rel_var']
    print("Warning: Model feature names not found. Using default spectral list.")

# --- 3. THE "HONEST" SPLIT ---
# To get an accurate report, we must isolate the 20% of data 
# that the model did NOT use during training.
X = df[features]
y = df['lc']

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, stratify=y, random_state=42
)

# --- 4. RUN PREDICTIONS ---
# We predict ONLY on the Test Set (Unseen Data)
y_pred = model.predict(X_test)

# --- 5. CALCULATE ACCURACIES ---
overall_acc = accuracy_score(y_test, y_pred)
kappa = cohen_kappa_score(y_test, y_pred)

# Confusion Matrix
labels = sorted(y.unique())
cm = confusion_matrix(y_test, y_pred, labels=labels)

# Producer's Accuracy (How well the model maps the real world)
producers_acc = np.diag(cm) / np.sum(cm, axis=1) 
# User's Accuracy (How reliable the map is for a person on the ground)
users_acc = np.diag(cm) / np.sum(cm, axis=0)

# --- 6. PRINT ACCURATE REPORT ---
print("\n" + "="*45)
print("      FINAL VALIDATION REPORT (UNSEEN DATA)")
print("="*45)
print(f"TRUE OVERALL ACCURACY: {overall_acc:.4f}")
print(f"KAPPA COEFFICIENT:     {kappa:.4f}")
print("-" * 45)

# Class Metrics Table
accuracy_table = pd.DataFrame({
    'Class_ID': labels,
    'Producer_Accuracy': producers_acc,
    'User_Accuracy': users_acc
})
print("\nClass-Specific Performance:")
print(accuracy_table.to_string(index=False))

print("\nFull Classification Report:")
print(classification_report(y_test, y_pred))

# --- 7. VISUALIZE ---
plt.figure(figsize=(10, 7))
sns.heatmap(cm, annot=True, fmt='d', xticklabels=labels, yticklabels=labels, cmap='Blues')
plt.title('Validation Confusion Matrix (Testing on 20% Unseen Data)')
plt.ylabel('True Ground Truth')
plt.xlabel('Model Prediction')
plt.show()