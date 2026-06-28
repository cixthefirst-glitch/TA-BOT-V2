"""Price data fetcher: MEXC + CoinGecko fallback."""
import os
import requests

MEXC_BASE = "https://api.mexc.com"
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
_CG_ID_CACHE = {}


def to_mexc_symbol(pair):
    return pair.replace("/", "").replace("-", "").upper()


def get_coingecko_id(symbol):
    sym = symbol.upper()
    if sym in _CG_ID_CACHE:
        return _CG_ID_CACHE[sym]
    try:
        r = requests.get(
            f"{COINGECKO_BASE}/coins/list",
            headers={"x-cg-demo-api-key": os.environ.get("COINGECKO_API_KEY", "")},
            timeout=10,
        )
        r.raise_for_status()
        for coin in r.json():
            if coin.get("symbol", "").upper() == sym:
                _CG_ID_CACHE[sym] = coin["id"]
                return coin["id"]
    except Exception:
        return None
    return None


def fetch_klines_mexc(pair, interval, limit=200):
    symbol = to_mexc_symbol(pair)
    try:
        r = requests.get(
            f"{MEXC_BASE}/api/v3/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            timeout=10,
        )
        r.raise_for_status()
        raw = r.json()
        return [{
            "timestamp": k[0],
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        } for k in raw]
    except Exception as e:
        print(f"[mexc] klines failed {symbol} {interval}: {e}")
        return None


def fetch_current_price_mexc(pair):
    symbol = to_mexc_symbol(pair)
    try:
        r = requests.get(
            f"{MEXC_BASE}/api/v3/ticker/price",
            params={"symbol": symbol}, timeout=5,
        )
        r.raise_for_status()
        return float(r.json()["price"])
    except Exception:
        return None


def fetch_current_price_coingecko(symbol):
    cg_id = get_coingecko_id(symbol.split("/")[0])
    if not cg_id:
        return None
    try:
        r = requests.get(
            f"{COINGECKO_BASE}/simple/price",
            params={"ids": cg_id, "vs_currencies": "usd"},
            headers={"x-cg-demo-api-key": os.environ.get("COINGECKO_API_KEY", "")},
            timeout=10,
        )
        r.raise_for_status()
        return float(r.json()[cg_id]["usd"])
    except Exception:
        return None


def fetch_funding_rate_mexc(pair):
    symbol = to_mexc_symbol(pair)
    try:
        r = requests.get(
            f"{MEXC_BASE}/api/v1/contract/funding_rate",
            params={"symbol": symbol}, timeout=5,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        if isinstance(data, dict):
            return float(data.get("fundingRate", 0))
        if isinstance(data, list) and data:
            return float(data[0].get("fundingRate", 0))
    except Exception:
        return None
    return None


def fetch_open_interest_mexc(pair):
    symbol = to_mexc_symbol(pair)
    try:
        r = requests.get(
            f"{MEXC_BASE}/api/v1/contract/open_interest",
            params={"symbol": symbol}, timeout=5,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        if isinstance(data, dict):
            vol = float(data.get("holdVol", 0))
            price = fetch_current_price_mexc(pair) or 1.0
            return vol * price
    except Exception:
        return None
    return None