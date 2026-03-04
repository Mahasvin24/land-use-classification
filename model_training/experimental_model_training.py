import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import joblib
import os
import glob
import os
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import classification_report, accuracy_score

#load the data
train_path = 'C:\\Users\\micoc\\OneDrive\\Documents\\GitHub\\land-use-classification\\train_v4_final.csv'
val_path = 'C:\\Users\\micoc\\OneDrive\\Documents\\GitHub\\land-use-classification\\val_v4_final.csv'

df_train = pd.read_csv(train_path)
df_val = pd.read_csv(val_path)

#rename columns to prevent errors
new_names = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B9', 'B11', 'B12', 'NDVI', 'entropy', 'lc']

if len(df_train.columns) == len(new_names):
    df_train.columns = new_names
    df_val.columns = new_names

#Features
features = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B9', 'B11', 'B12', 'NDVI', 'entropy']
target = 'lc'

#clean and train
df_train = df_train.dropna(subset=features + [target])
df_val = df_val.dropna(subset=features + [target])

X_train = df_train[features]
y_train = df_train[target]
X_val = df_val[features]
y_val = df_val[target]

rf_initial = RandomForestClassifier(n_estimators=500, random_state=42)
rf_initial.fit(X_train, y_train)

importances = rf_initial.feature_importances_
feature_importance_df = pd.DataFrame({
    'Feature': features,
    'Importance': importances
}).sort_values(by='Importance', ascending=False)

print("\n--- Feature Importance Ranking ---")
print(feature_importance_df)

# Visualize Importances
plt.figure(figsize=(10, 6))
sns.barplot(x='Importance', y='Feature', data=feature_importance_df)
plt.title('Initial Feature Importance')
plt.show()

# 5. AUTOMATIC FEATURE SELECTION
# Define a threshold (e.g., 0.01 means the feature must contribute at least 1%)
threshold = 0.02 
useful_features = feature_importance_df[feature_importance_df['Importance'] > threshold]['Feature'].tolist()
useless_features = [f for f in features if f not in useful_features]

print(f"\nDropping {len(useless_features)} weak features: {useless_features}")
print(f"Keeping {len(useful_features)} strong features: {useful_features}")

# 6. RETRAIN OPTIMIZED MODEL
print("\nRetraining optimized model...")
rf_optimized = RandomForestClassifier(n_estimators=500, random_state=42, n_jobs=-1)
rf_optimized.fit(X_train[useful_features], y_train)

# 7. FINAL EVALUATION
y_pred = rf_optimized.predict(X_val[useful_features])
final_acc = accuracy_score(y_val, y_pred)

print("\n--- Final Model Results ---")
print(f"Optimized Accuracy: {final_acc:.4f}")
print("\nClassification Report:")
print(classification_report(y_val, y_pred))

# 8. SAVE THE OPTIMIZED MODEL
model_filename = 'optimized_model.pkl'
joblib.dump(rf_optimized, model_filename)
# Save the list of features used (important for later prediction)
joblib.dump(useful_features, 'model_features.pkl')

print(f"\nSuccess! Optimized model saved as {model_filename}")