"""Deep feature extraction for trade signals (50+ features)."""
import datetime
import numpy as np
from ml.data_sources import (
    fetch_klines_mexc, fetch_funding_rate_mexc, fetch_open_interest_mexc,
)


def compute_ema(values, period):
    if len(values) < period:
        return None
    arr = np.array(values[-period:], dtype=float)
    multiplier = 2.0 / (period + 1)
    ema = arr[0]
    for v in arr[1:]:
        ema = (v - ema) * multiplier + ema
    return float(ema)


def compute_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    deltas = np.diff(closes[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains)
    avg_loss = np.mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return float(100 - (100 / (1 + rs)))


def compute_macd(closes):
    if len(closes) < 26:
        return {"macd": None, "signal": None, "histogram": None}
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    if ema12 is None or ema26 is None:
        return {"macd": None, "signal": None, "histogram": None}
    macd_line = ema12 - ema26
    macd_values = []
    for i in range(len(closes) - 26, len(closes)):
        e12 = compute_ema(closes[:i + 1], 12) if i >= 12 else None
        e26 = compute_ema(closes[:i + 1], 26) if i >= 26 else None
        if e12 is not None and e26 is not None:
            macd_values.append(e12 - e26)
    if len(macd_values) < 9:
        return {"macd": macd_line, "signal": None, "histogram": None}
    signal = compute_ema(macd_values, 9)
    histogram = macd_line - signal if signal else None
    return {"macd": macd_line, "signal": signal, "histogram": histogram}


def compute_bollinger_bands(closes, period=20):
    if len(closes) < period:
        return {"upper": None, "middle": None, "lower": None, "bandwidth": None, "percent_b": None}
    arr = np.array(closes[-period:], dtype=float)
    sma = np.mean(arr)
    std = np.std(arr, ddof=1)
    upper = sma + 2 * std
    lower = sma - 2 * std
    bandwidth = (upper - lower) / sma if sma != 0 else 0
    percent_b = (closes[-1] - lower) / (upper - lower) if (upper - lower) != 0 else 0.5
    return {"upper": float(upper), "middle": float(sma), "lower": float(lower),
            "bandwidth": float(bandwidth), "percent_b": float(percent_b)}


def compute_atr(highs, lows, closes, period=14):
    if len(highs) < period + 1:
        return None
    trs = [max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])) for i in range(-period, 0)]
    return float(np.mean(trs))


def compute_adx(highs, lows, closes, period=14):
    if len(highs) < period + 1:
        return None
    plus_dm, minus_dm, tr = [], [], []
    for i in range(-period, 0):
        h, l, ph, pl = highs[i], lows[i], highs[i - 1], lows[i - 1]
        up_move = h - ph
        down_move = pl - l
        tr.append(max(h - l, abs(h - ph), abs(l - pl)))
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0)
    if sum(tr) == 0:
        return None
    atr_val = np.mean(tr)
    pdi = 100 * np.mean(plus_dm) / atr_val if atr_val > 0 else 0
    ndi = 100 * np.mean(minus_dm) / atr_val if atr_val > 0 else 0
    return float(100 * abs(pdi - ndi) / (pdi + ndi)) if (pdi + ndi) > 0 else 0


def compute_obv(closes, volumes):
    if len(closes) < 2:
        return None
    obv = 0
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            obv += volumes[i]
        elif closes[i] < closes[i - 1]:
            obv -= volumes[i]
    return float(obv)


def compute_obv_slope(closes, volumes, period=14):
    if len(closes) < period + 1:
        return None
    obv = 0
    for i in range(1, len(closes) - period):
        if closes[i] > closes[i - 1]: obv += volumes[i]
        elif closes[i] < closes[i - 1]: obv -= volumes[i]
    obv_values = []
    for i in range(len(closes) - period, len(closes)):
        if i == 0: continue
        if closes[i] > closes[i - 1]: obv += volumes[i]
        elif closes[i] < closes[i - 1]: obv -= volumes[i]
        obv_values.append(obv)
    if len(obv_values) < 2:
        return None
    return float(np.polyfit(np.arange(len(obv_values)), np.array(obv_values), 1)[0])


def compute_volume_ratio(volumes, short_period=5, long_period=20):
    if len(volumes) < long_period: return None
    long_avg = np.mean(volumes[-long_period:])
    return float(np.mean(volumes[-short_period:]) / long_avg) if long_avg > 0 else None


def compute_ema_slope(closes, period=20):
    if len(closes) < period + 3: return None
    ema_vals = [compute_ema(closes[:len(closes) + i], period) for i in range(-3, 0)]
    if any(v is None for v in ema_vals): return None
    return float((ema_vals[-1] - ema_vals[0]) / 3)


def compute_stochastic(highs, lows, closes, period=14):
    if len(highs) < period: return {"k": None, "d": None}
    recent_high, recent_low = max(highs[-period:]), min(lows[-period:])
    if recent_high == recent_low: return {"k": 50.0, "d": None}
    return {"k": float(100 * (closes[-1] - recent_low) / (recent_high - recent_low)), "d": None}


def compute_cci(highs, lows, closes, period=20):
    if len(highs) < period: return None
    tp = [(highs[i] + lows[i] + closes[i]) / 3 for i in range(-period, 0)]
    sma_tp = np.mean(tp)
    mad = np.mean([abs(t - sma_tp) for t in tp])
    if mad == 0: return 0.0
    return float((tp[-1] - sma_tp) / (0.015 * mad))


def compute_williams_r(highs, lows, closes, period=14):
    if len(highs) < period: return None
    recent_high, recent_low = max(highs[-period:]), min(lows[-period:])
    if recent_high == recent_low: return -50.0
    return float(-100 * (recent_high - closes[-1]) / (recent_high - recent_low))


def extract_deep_features(pair, timeframe, side="long",
                          entry_price=None, stop_loss=None, targets=None):
    klines = fetch_klines_mexc(pair, timeframe, limit=200)
    if not klines or len(klines) < 50:
        return {"error": "insufficient kline data"}
    closes = [k["close"] for k in klines]
    highs = [k["high"] for k in klines]
    lows = [k["low"] for k in klines]
    volumes = [k["volume"] for k in klines]
    current_price = closes[-1]
    features = {}
    ema20, ema50, ema200 = compute_ema(closes, 20), compute_ema(closes, 50), compute_ema(closes, 200)
    features["price"] = current_price
    features["price_vs_ema20"] = (current_price / ema20) - 1 if ema20 else None
    features["price_vs_ema50"] = (current_price / ema50) - 1 if ema50 else None
    features["price_vs_ema200"] = (current_price / ema200) - 1 if ema200 else None
    features["ema20_slope"] = compute_ema_slope(closes, 20)
    features["ema50_slope"] = compute_ema_slope(closes, 50)
    features["ema200_slope"] = compute_ema_slope(closes, 200)
    features["adx"] = compute_adx(highs, lows, closes, 14)
    features["ema20_above_ema50"] = float(ema20 > ema50) if ema20 and ema50 else None
    features["ema50_above_ema200"] = float(ema50 > ema200) if ema50 and ema200 else None
    features["rsi_14"] = compute_rsi(closes, 14)
    features["rsi_7"] = compute_rsi(closes, 7)
    macd = compute_macd(closes)
    features["macd"] = macd["macd"]
    features["macd_signal"] = macd["signal"]
    features["macd_histogram"] = macd["histogram"]
    features["macd_cross_above_signal"] = float(macd["macd"] > macd["signal"]) if macd["macd"] and macd["signal"] else None
    stoch = compute_stochastic(highs, lows, closes, 14)
    features["stoch_k"] = stoch["k"]
    features["cci_20"] = compute_cci(highs, lows, closes, 20)
    features["williams_r_14"] = compute_williams_r(highs, lows, closes, 14)
    bb = compute_bollinger_bands(closes, 20)
    features["bb_upper"], features["bb_middle"], features["bb_lower"] = bb["upper"], bb["middle"], bb["lower"]
    features["bb_bandwidth"], features["bb_percent_b"] = bb["bandwidth"], bb["percent_b"]
    features["bb_price_vs_upper"] = (current_price / bb["upper"]) - 1 if bb["upper"] else None
    features["bb_price_vs_lower"] = (current_price / bb["lower"]) - 1 if bb["lower"] else None
    features["atr_14"] = compute_atr(highs, lows, closes, 14)
    features["atr_pct"] = (features["atr_14"] / current_price * 100) if features["atr_14"] and current_price else None
    features["volume"] = volumes[-1]
    features["volume_ratio_5_20"] = compute_volume_ratio(volumes, 5, 20)
    features["volume_ratio_1_5"] = compute_volume_ratio(volumes, 1, 5)
    features["obv"] = compute_obv(closes, volumes)
    features["obv_slope_14"] = compute_obv_slope(closes, volumes, 14)
    for tf, label in [("15m", "m15"), ("1h", "h1"), ("4h", "h4")]:
        tf_klines = fetch_klines_mexc(pair, tf, limit=50)
        if tf_klines and len(tf_klines) > 20:
            tf_closes = [k["close"] for k in tf_klines]
            features["rsi_" + label] = compute_rsi(tf_closes, 14)
            features["ema20_slope_" + label] = compute_ema_slope(tf_closes, 20)
            features["adx_" + label] = compute_adx([k["high"] for k in tf_klines], [k["low"] for k in tf_klines], tf_closes, 14)
        else:
            features["rsi_" + label] = None
            features["ema20_slope_" + label] = None
            features["adx_" + label] = None
    features["funding_rate"] = fetch_funding_rate_mexc(pair)
    features["open_interest"] = fetch_open_interest_mexc(pair)
    now = datetime.datetime.utcnow()
    features["hour_of_day"] = now.hour
    features["day_of_week"] = now.weekday()
    features["is_asia_session"] = float(0 <= now.hour < 8)
    features["is_london_session"] = float(8 <= now.hour < 16)
    features["is_ny_session"] = float(13 <= now.hour < 22)
    features["side"] = 1.0 if side == "long" else 0.0
    if entry_price and current_price:
        features["entry_vs_current"] = (current_price / entry_price) - 1
    else:
        features["entry_vs_current"] = None
    if entry_price and stop_loss:
        features["risk_distance_pct"] = abs(entry_price - stop_loss) / entry_price * 100
    else:
        features["risk_distance_pct"] = None
    if entry_price and targets:
        features["reward_distance_pct"] = abs(targets[0] - entry_price) / entry_price * 100
        rd = features.get("reward_distance_pct")
        risk = features.get("risk_distance_pct")
        features["rr_ratio"] = rd / risk if risk and risk > 0 else None
    else:
        features["reward_distance_pct"] = None
        features["rr_ratio"] = None
    if len(closes) >= 6:
        features["candle_5_close_pct"] = (closes[-1] - closes[-6]) / closes[-6] * 100
        features["candle_3_close_pct"] = (closes[-1] - closes[-4]) / closes[-4] * 100
        features["candle_1_close_pct"] = (closes[-1] - closes[-2]) / closes[-2] * 100
    else:
        features["candle_5_close_pct"] = features["candle_3_close_pct"] = features["candle_1_close_pct"] = None
    if features.get("atr_pct") is not None:
        features["volatility_regime"] = 0.0 if features["atr_pct"] < 0.5 else (1.0 if features["atr_pct"] < 1.5 else 2.0)
    else:
        features["volatility_regime"] = None
    return features