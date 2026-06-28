"""Outcome evaluator - TP/SL hit detection."""
import datetime
from ml.data_sources import fetch_current_price_mexc, fetch_current_price_coingecko


def get_current_price(pair):
    price = fetch_current_price_mexc(pair)
    if price is not None: return price
    return fetch_current_price_coingecko(pair.split("/")[0])


def check_signal_outcome(signal):
    pair = signal.get("pair")
    side = signal.get("type", "long")
    entry = signal.get("entry")
    targets = signal.get("targets", [])
    stop_loss = signal.get("stop_loss")
    created_at = signal.get("created_at")
    if not all([pair, entry, targets, stop_loss]): return None
    price = get_current_price(pair)
    if price is None: return None
    now = datetime.datetime.utcnow()
    created_dt = _to_datetime(created_at) if created_at else None
    if side == "long":
        for i, tp in enumerate(targets):
            if price >= tp:
                pnl_pct = (price - entry) / entry * 100
                return {"status": "closed", "result": _resolve_result(pnl_pct, True), "pnl_pct": pnl_pct, "rr_achieved": _rr(entry, price, stop_loss), "hit_target_index": i, "closed_at": now, "close_price": price, "close_reason": "tp{}_hit".format(i + 1)}
        if price <= stop_loss:
            pnl_pct = (stop_loss - entry) / entry * 100
            return {"status": "closed", "result": "loss", "pnl_pct": pnl_pct, "rr_achieved": -1.0, "hit_target_index": -1, "closed_at": now, "close_price": stop_loss, "close_reason": "sl_hit"}
    elif side == "short":
        for i, tp in enumerate(targets):
            if price <= tp:
                pnl_pct = (entry - price) / entry * 100
                return {"status": "closed", "result": _resolve_result(pnl_pct, True), "pnl_pct": pnl_pct, "rr_achieved": _rr_short(entry, price, stop_loss), "hit_target_index": i, "closed_at": now, "close_price": price, "close_reason": "tp{}_hit".format(i + 1)}
        if price >= stop_loss:
            pnl_pct = (entry - stop_loss) / entry * 100
            return {"status": "closed", "result": "loss", "pnl_pct": pnl_pct, "rr_achieved": -1.0, "hit_target_index": -1, "closed_at": now, "close_price": stop_loss, "close_reason": "sl_hit"}
    if created_dt and (now - created_dt).total_seconds() > 24 * 3600:
        if side == "long":
            pnl_pct = (price - entry) / entry * 100
            rr = _rr(entry, price, stop_loss)
        else:
            pnl_pct = (entry - price) / entry * 100
            rr = _rr_short(entry, price, stop_loss)
        return {"status": "closed", "result": _resolve_result(pnl_pct, False), "pnl_pct": pnl_pct, "rr_achieved": rr, "hit_target_index": -2, "closed_at": now, "close_price": price, "close_reason": "timeout_24h"}
    return None


def _resolve_result(pnl_pct, hit_target):
    if hit_target and pnl_pct > 0: return "full_win" if pnl_pct > 1.5 else "partial_win"
    if pnl_pct > 0.1: return "scratch_win"
    if pnl_pct < -0.1: return "loss"
    return "breakeven"


def _rr(entry, exit_price, stop_loss):
    risk = abs(entry - stop_loss)
    return float(abs(exit_price - entry) / risk) if risk else 0.0


def _rr_short(entry, exit_price, stop_loss):
    risk = abs(stop_loss - entry)
    return float(abs(entry - exit_price) / risk) if risk else 0.0


def _to_datetime(ts):
    if hasattr(ts, "timestamp"): return datetime.datetime.utcfromtimestamp(ts.timestamp())
    if isinstance(ts, str):
        try: return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
        except: return None
    if isinstance(ts, datetime.datetime): return ts if ts.tzinfo is None else ts.replace(tzinfo=None)
    return None