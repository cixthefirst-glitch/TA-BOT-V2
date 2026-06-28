"""Every 5 min: closes signals when TP/SL hit."""
from firebase_functions import scheduler_fn
from firebase_admin import initialize_app, firestore

initialize_app()


@scheduler_fn.on_schedule(schedule="every 5 minutes", timezone="UTC")
async def check_outcomes(event):
    from ml.outcomes import check_signal_outcome
    db = firestore.client()
    checked = closed = 0
    async for doc in db.collection("signals").where("status", "in", ["open", "active", "pending"]).stream():
        data = doc.to_dict()
        if not (data.get("entry") and data.get("targets") and data.get("stop_loss")): continue
        outcome = check_signal_outcome(data)
        checked += 1
        if outcome is not None:
            await doc.reference.update(outcome)
            closed += 1
    print("[check_outcomes] checked={} closed={}".format(checked, closed))