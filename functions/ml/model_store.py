"""Model store - XGBoost models in Firestore."""
import base64
import io
import joblib
from datetime import datetime


def model_doc_id():
    return "model_{}".format(datetime.utcnow().strftime("%Y%m%d_%H%M%S"))


async def save_model_to_firestore(db, model, metadata):
    buf = io.BytesIO()
    joblib.dump(model, buf)
    version_id = model_doc_id()
    await db.collection("model_versions").document(version_id).set({
        "created_at": datetime.utcnow(),
        "blob_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "metadata": metadata,
        "active": False,
    })
    return version_id


async def load_active_model(db):
    docs = [d async for d in db.collection("model_versions").where("active", "==", True).limit(1).stream()]
    if not docs: return None, None
    data = docs[0].to_dict()
    return joblib.load(io.BytesIO(base64.b64decode(data["blob_b64"]))), data.get("metadata", {})


async def set_active_model(db, version_id):
    async for d in db.collection("model_versions").stream():
        if d.to_dict().get("active"):
            await d.reference.update({"active": False})
    await db.collection("model_versions").document(version_id).update({"active": True})