"""Firestore trigger: attaches features_snapshot when a signal is created."""
import datetime
from firebase_functions import firestore_fn
from firebase_admin import initialize_app
from ml.features import extract_deep_features

initialize_app()


@firestore_fn.on_document_created(document="signals/{signalId}")
async def on_signal_create(event):
    snap = event.data
    if snap is None: return
    data = snap.to_dict() or {}
    if data.get("features_snapshot"): return
    pair = data.get("pair")
    timeframe = data.get("timeframe", "1h")
    side = data.get("type", "long")
    entry = data.get("entry")
    stop_loss = data.get("stop_loss")
    targets = data.get("targets", [])
    if not pair or entry is None: return
    features = extract_deep_features(pair=pair, timeframe=timeframe, side=side, entry_price=entry, stop_loss=stop_loss, targets=targets)
    await snap.reference.update({"features_snapshot": features, "features_extracted_at": datetime.datetime.utcnow(), "ml_ready": "error" not in features})