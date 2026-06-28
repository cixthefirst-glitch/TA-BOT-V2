"""Training pipeline - XGBoost classifier."""
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, log_loss
from xgboost import XGBClassifier

WIN_CLASSES = {"full_win", "partial_win", "scratch_win"}


def signals_to_dataframe(signals):
    rows = []
    for s in signals:
        snap = s.get("features_snapshot", {})
        if not snap: continue
        row = dict(snap)
        row["result"] = s.get("result", "")
        row["pnl_pct"] = s.get("pnl_pct", 0.0)
        row["rr_achieved"] = s.get("rr_achieved", 0.0)
        row["hit_target_index"] = s.get("hit_target_index", -99)
        row["timeframe"] = s.get("timeframe", "")
        row["pair"] = s.get("pair", "")
        rows.append(row)
    return pd.DataFrame(rows) if rows else pd.DataFrame()


def prepare_training_data(df):
    if df.empty: return pd.DataFrame(), np.array([]), []
    df = df.copy()
    y = df["result"].apply(lambda r: 1 if r in WIN_CLASSES else 0).values
    drop_cols = {"result", "pnl_pct", "rr_achieved", "hit_target_index", "timeframe", "pair", "price", "error"}
    feature_cols = [c for c in df.columns if c not in drop_cols]
    X = df[feature_cols].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(-999.0)
    return X, y, feature_cols


def train_model(X, y):
    if len(X) < 30: return None, {"error": "not enough data", "size": len(X)}
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y if len(set(y)) > 1 else None)
    n_pos, n_neg = int(sum(y_train == 1)), int(sum(y_train == 0))
    spw = (n_neg / n_pos) if n_pos > 0 else 1.0
    model = XGBClassifier(n_estimators=300, max_depth=5, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, scale_pos_weight=spw, eval_metric="logloss", random_state=42, use_label_encoder=False)
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1] if len(set(y_test)) > 1 else y_pred
    return model, {"accuracy": float(accuracy_score(y_test, y_pred)), "log_loss": float(log_loss(y_test, y_proba, labels=[0, 1])) if len(set(y_test)) > 1 else None, "train_size": int(len(X_train)), "test_size": int(len(X_test)), "n_features": int(X.shape[1]), "win_rate_train": float(n_pos / max(len(y_train), 1)), "win_rate_test": float(sum(y_test) / max(len(y_test), 1))}