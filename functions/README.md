# TA-BOT ML Pipeline

Firebase Cloud Functions (Python) for ML feedback loop on trade signals.

## Files
- main.py - entry point
- ml/data_sources.py - MEXC + CoinGecko price/funding/OI fetchers
- ml/features.py - 50+ deep feature extractor
- ml/outcomes.py - TP/SL/timeout evaluator
- ml/train.py - XGBoost classifier training
- ml/model_store.py - Firestore model versioning
- ml/score.py - Live confidence scoring
- triggers/on_signal_create.py - Firestore trigger
- scheduled/check_outcomes.py - 5-min job
- scheduled/retrain_weekly.py - Monday 03:00 UTC job

## Deploy
cd functions
pip install -r requirements.txt
firebase deploy --only functions