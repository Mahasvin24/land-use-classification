import pandas as pd
import pickle
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score

# 1. Load the engineered dataset
df = pd.read_csv('terrae_data.csv')

# 2. Define Features and Target
features = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B11', 'NDVI', 'NDBI']
X = df[features]
y = df['lc']

# 3. Split the data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# 4. Initialize and Train the Random Forest Model
rf_model = RandomForestClassifier(n_estimators=500, random_state=42, n_jobs=-1)
rf_model.fit(X_train, y_train)

# 5. Evaluate
y_pred = rf_model.predict(X_test)
print(f"Overall Accuracy: {accuracy_score(y_test, y_pred):.4f}")

# 6. Save the model as a .pkl file
with open('terrae_model.pkl', 'wb') as f:
    pickle.dump(rf_model, f)

print("Model saved as 'terrae_model.pkl'")