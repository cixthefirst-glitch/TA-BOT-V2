import axios from 'axios';

const MEXC_FUTURES_URL = 'https://contract.mexc.com/api/v1/contract/kline';
// Mexc API limits: use efficiently

export interface KlineInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

export async function getAvailablePairs(): Promise<string[]> {
  try {
    const res = await axios.get('https://contract.mexc.com/api/v1/contract/ticker');
    if (res.data && res.data.success && res.data.data) {
      // Filter for USDT pairs, sort by volume (descending), take top 250
      const activePairs = res.data.data
        .filter((p: any) => p.symbol.endsWith('_USDT'))
        .sort((a: any, b: any) => b.amount24 - a.amount24)
        .slice(0, 250)
        .map((p: any) => p.symbol);
      return activePairs;
    }
    return ["BTC_USDT", "ETH_USDT", "SOL_USDT"];
  } catch (error) {
    console.error("Failed to fetch available pairs from MEXC", error);
    return ["BTC_USDT", "ETH_USDT", "SOL_USDT"]; // Fallback
  }
}

export async function getMEXCKlines(symbol: string, interval: string): Promise<KlineInput[]> {
  try {
    // interval formats mapping suitable for MEXC Futures
    // 1h = Min60, 4h = Min240, 1d = Day1
    let intervalParam = 'Min60';
    if (interval === '1h') intervalParam = 'Min60';
    else if (interval === '4h') intervalParam = 'Min240';
    else if (interval === '1d') intervalParam = 'Day1';
    else if (interval === '15m') intervalParam = 'Min15';

    // In MEXC V1 contract API, endpoint is /api/v1/contract/kline/{symbol}
    // query: ?interval=Min60&end=... or just no end to get latest
    const res = await axios.get(MEXC_FUTURES_URL + "/" + symbol, {
      params: {
        interval: intervalParam
      }
    });

    if (res.data && res.data.success && res.data.data) {
      const data = res.data.data;
      // Depending on actual response structure from POST / GET
      // Usually it's arrays of [time, open, close, high, low, vol, ...]
      // Wait, Mexc V1 contract kline usually returns {"success":true,"data":{"time":[...],"open":[...],"close":[...],"high":[...],"low":[...],"vol":[...]}}
      
      const timeArr = data.time || [];
      const openArr = data.open || [];
      const closeArr = data.close || [];
      const highArr = data.high || [];
      const lowArr = data.low || [];
      const volArr = data.vol || [];

      const klines: KlineInput[] = [];
      for (let i = 0; i < timeArr.length; i++) {
        klines.push({
          time: timeArr[i] * 1000,
          open: openArr[i],
          high: highArr[i],
          low: lowArr[i],
          close: closeArr[i],
          vol: volArr[i],
        });
      }
      return klines;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch klines for " + symbol + " " + interval);
    return [];
  }
}
