import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
from sklearn.metrics import (
    accuracy_score, 
    cohen_kappa_score, 
    confusion_matrix, 
    classification_report
)
import joblib

features = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B9', 'B11', 'B12', 'NDVI', 'entropy']


# 1. Load your data and model 
# Replace these with your actual local file paths
val_path = 'C:\\Users\\micoc\\OneDrive\\Documents\\GitHub\\land-use-classification\\val_v4_final.csv'


df_val = pd.read_csv(val_path)
X_val = df_val[features]

model = joblib.load('C:\\Users\\micoc\\OneDrive\\Documents\\GitHub\\land-use-classification\\optimized_model.pkl')

try:
    expected_features = model.feature_names_in_
    print("Model expects:", expected_features)
    
    # Reorder/subset X_val to match the model exactly
    X_val = df_val[expected_features]
except AttributeError:
    print("Model doesn't have feature_names_in_. Ensure your 'features' list is manually correct.")
    X_val = df_val[features]

y_true = df_val['lc']
y_pred = model.predict(X_val) 




# 2. Basic Accuracy & Kappa
overall_acc = accuracy_score(y_true, y_pred)
kappa = cohen_kappa_score(y_true, y_pred)

# 3. Confusion Matrix
labels = sorted(y_true.unique()) # Get unique class names
cm = confusion_matrix(y_true, y_pred, labels=labels)

# 4. Producer's and User's Accuracy (Adjusted Metrics)
# In Land Use, "Adjusted" often refers to class-specific accuracies
cm_diag = np.diag(cm)
producers_acc = cm_diag / np.sum(cm, axis=0) # Accuracy from map maker perspective
users_acc = cm_diag / np.sum(cm, axis=1)    # Accuracy from map user perspective

# --- Results Output ---
print(f"Overall Accuracy: {overall_acc:.4f}")
print(f"Kappa Coefficient: {kappa:.4f}")
print("\nClassification Report:")
print(classification_report(y_true, y_pred, target_names=[str(label) for label in labels]))

# Plotting the Confusion Matrix
plt.figure(figsize=(10, 7))
sns.heatmap(cm, annot=True, fmt='d', xticklabels=labels, yticklabels=labels, cmap='Blues')
plt.xlabel('Predicted Label')
plt.ylabel('True Label')
plt.title('Land Use Classification Confusion Matrix')
plt.show()



importances = model.feature_importances_
feature_names = X_val.columns
feature_importance_df = pd.DataFrame({'Feature': feature_names, 'Importance': importances})
feature_importance_df = feature_importance_df.sort_values(by='Importance', ascending=False)

# Plot
plt.figure(figsize=(10, 6))
sns.barplot(x='Importance', y='Feature', data=feature_importance_df)
plt.title('Which factors are actually helping?')
plt.show()