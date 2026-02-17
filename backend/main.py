# main.py
from fastapi import FastAPI, File, UploadFile
import joblib
import numpy as np
from PIL import Image
import io

app = FastAPI()
model = joblib.load("model.pkl")

def preprocess_image(image):
    image = image.resize((64, 64))
    image = np.array(image)
    image = image.flatten()
    return image.reshape(1, -1)

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents))
    processed = preprocess_image(image)
    prediction = model.predict(processed)
    return {"prediction": int(prediction[0])}
