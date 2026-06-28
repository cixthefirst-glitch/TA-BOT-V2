"""Weekly Monday 03:00 UTC: retrain XGBoost, promote if better."""
from firebase_functions import scheduler_fn
from firebase_admin import initialize_app, firestore

initialize_app()


@scheduler_fn.on_schedule(schedule="every monday 03:00", timezone="UTC")
async def retrain_weekly(event):
    from ml.train import signals_to_dataframe, prepare_training_data, train_model
    from ml.model_store import save_model_to_firestore, load_active_model, set_active_model
    db = firestore.client()
    signals = [doc.to_dict() async for doc in db.collection("signals").where("status", "==", "closed").stream()]
    df = signals_to_dataframe(signals)
    if df.empty:
        print("[retrain_weekly] no signals with features_snapshot")
        return
    X, y, feature_cols = prepare_training_data(df)
    if len(X) < 30:
        print("[retrain_weekly] only {} rows - need >= 30".format(len(X)))
        return
    model, metrics = train_model(X, y)
    if model is None: return
    new_id = await save_model_to_firestore(db, model, {"accuracy": metrics["accuracy"], "log_loss": metrics.get("log_loss"), "train_size": metrics["train_size"], "test_size": metrics["test_size"], "n_features": metrics["n_features"], "feature_list": feature_cols, "win_rate_train": metrics["win_rate_train"], "win_rate_test": metrics["win_rate_test"], "confidence_threshold": 0.55})
    _, active_meta = await load_active_model(db)
    new_acc, old_acc = metrics["accuracy"], (active_meta or {}).get("accuracy", 0.0)
    if new_acc >= old_acc:
        await set_active_model(db, new_id)
        print("[retrain_weekly] promoted {} (acc {:.3f} >= {:.3f})".format(new_id, new_acc, old_acc))
    else:
        print("[retrain_weekly] kept old (new {:.3f} < old {:.3f})".format(new_acc, old_acc))