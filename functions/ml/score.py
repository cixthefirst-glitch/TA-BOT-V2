"""Live confidence scoring for new signals."""
import pandas as pd
import numpy as np
from ml.features import extract_deep_features


async def score_signal_setup(db, pair, timeframe, side, entry_price, stop_loss, targets):
    from ml.model_store import load_active_model
    model, metadata = await load_active_model(db)
    if model is None:
        return {"confidence": None, "model_version": None, "top_features": [], "should_send": True, "reason": "no active model yet"}
    features = extract_deep_features(pair=pair, timeframe=timeframe, side=side, entry_price=entry_price, stop_loss=stop_loss, targets=targets)
    if "error" in features:
        return {"confidence": None, "model_version": metadata.get("version_id"), "top_features": [], "should_send": True, "reason": "feature extraction failed"}
    feature_cols = metadata.get("feature_list", []) or [k for k in features.keys() if k != "error"]
    X = pd.DataFrame([{k: features.get(k) for k in feature_cols}]).apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(-999.0)
    try:
        proba = float(model.predict_proba(X)[0, 1])
    except Exception as e:
        return {"confidence": None, "model_version": metadata.get("version_id"), "top_features": [], "should_send": True, "reason": "predict failed: {}".format(e)}
    importances = sorted(zip(feature_cols, model.feature_importances_), key=lambda x: x[1], reverse=True)[:8]
    threshold = float(metadata.get("confidence_threshold", 0.55))
    return {"confidence": proba, "model_version": metadata.get("version_id"), "top_features": [(n, float(v)) for n, v in importances], "should_send": proba >= threshold, "reason": "conf {:.2f} vs thr {:.2f}".format(proba, threshold)}