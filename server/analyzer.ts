import { KlineInput } from './mexc';
import { RSI, MACD, EMA, ATR } from 'technicalindicators';

export interface AnalysisResult {
  pair: string;
  timeframe: string;
  signal_type: 'long' | 'short';
  entry: number;
  targets: number[];
  stop_loss: number;
  note: string;
  is_scalp: boolean;
  score?: number;
  status?: string;
  is_aggressive?: boolean;
}

// Helpers
function isBullishReversalCandle(candle: KlineInput, prevCandle: KlineInput): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);

  // Pin bar / Hammer
  if (lowerWick > bodySize * 2 && upperWick < bodySize) return true;
  // Bullish engulfing
  if (prevCandle.close < prevCandle.open && candle.close > candle.open && candle.close > prevCandle.open && candle.open < prevCandle.close) return true;
  return false;
}

function isBearishReversalCandle(candle: KlineInput, prevCandle: KlineInput): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);

  // Shooting star
  if (upperWick > bodySize * 2 && lowerWick < bodySize) return true;
  // Bearish engulfing
  if (prevCandle.close > prevCandle.open && candle.close < candle.open && candle.close < prevCandle.open && candle.open > prevCandle.close) return true;
  return false;
}

export function analyzePair(pair: string, timeframe: string, klines: KlineInput[], marketContext: string): AnalysisResult | { status: string } {
  if (!klines || klines.length < 200) return { status: 'no valid signal' };

  const latest = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const closePrices = klines.map(k => k.close);
  const highPrices = klines.map(k => k.high);
  const lowPrices = klines.map(k => k.low);

  // Calculate Indicators
  const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
  const currentRSI = rsiValues[rsiValues.length - 1];

  const macdValues = MACD.calculate({ 
    values: closePrices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const currentMACD = macdValues[macdValues.length - 1];

  const ema50Values = EMA.calculate({ values: closePrices, period: 50 });
  const currentEMA50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : latest.close;
  const ema200Values = EMA.calculate({ values: closePrices, period: 200 });
  const currentEMA200 = ema200Values.length > 0 ? ema200Values[ema200Values.length - 1] : latest.close;

  const atrValues = ATR.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
  const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : (latest.high - latest.low);

  // Old SMA stuff for basic check
  let sum20 = 0;
  const smaPeriod = Math.min(20, klines.length);
  for (let i = klines.length - smaPeriod; i < klines.length; i++) {
    sum20 += klines[i].close;
  }
  const sma20 = sum20 / smaPeriod;

  // Volume averages
  const avgVol = klines.slice(-50, -1).reduce((acc, k) => acc + k.vol, 0) / 49;
  
  const isNearMA20 = Math.abs(latest.close - sma20) / sma20 < 0.02;

  // 1. Pre-Pump Detection (Aggressive Long)
  const isPrePumpBullishCandle = latest.close > latest.open;
  const isPrePumpMACD = currentMACD && currentMACD.MACD !== undefined && currentMACD.signal !== undefined && currentMACD.MACD > currentMACD.signal && (currentMACD.histogram || 0) > 0;

  if (currentRSI <= 35 && isPrePumpBullishCandle && isPrePumpMACD) {
    const entry = latest.close;
    const atrSL = entry - (2 * currentATR);
    const stop_loss = Number(Math.min(atrSL, sma20 * 0.99).toFixed(4));
    
    return {
      pair,
      timeframe,
      signal_type: 'long',
      entry,
      targets: [Number((entry + (entry - stop_loss) * 2).toFixed(4))],
      stop_loss,
      note: `RSI ≤ 35 (${currentRSI.toFixed(1)}), Bullish Candle, MACD Bullish`,
      is_scalp: ['1m', '5m', '15m', '1h'].includes(timeframe),
      score: 60,
      is_aggressive: true
    };
  }

  // 2. Pre-Dump Detection (Aggressive Short)
  const isPreDumpBearishCandle = latest.close < latest.open;
  const isPreDumpMACD = currentMACD && currentMACD.MACD !== undefined && currentMACD.signal !== undefined && currentMACD.MACD < currentMACD.signal && (currentMACD.histogram || 0) < 0;
  
  if (currentRSI >= 65 && isPreDumpBearishCandle && isPreDumpMACD) {
    const entry = latest.close;
    const atrSL = entry + (2 * currentATR);
    const stop_loss = Number(Math.max(atrSL, sma20 * 1.01).toFixed(4));

    return {
      pair,
      timeframe,
      signal_type: 'short',
      entry,
      targets: [Number((entry - (stop_loss - entry) * 2).toFixed(4))],
      stop_loss,
      note: `RSI ≥ 65 (${currentRSI.toFixed(1)}), Bearish Candle, MACD Bearish`,
      is_scalp: ['1m', '5m', '15m', '1h'].includes(timeframe),
      score: 60,
      is_aggressive: true
    };
  }

  // Standard signals...
  let longScore = 0;
  let shortScore = 0;
  let longReasons: string[] = [];
  let shortReasons: string[] = [];

  // Base setup: Trendline touch/MA proximity + Candlestick confirmation (40%)
  if (isNearMA20 && isBullishReversalCandle(latest, prev)) {
    longScore += 40;
    longReasons.push("Trendline Base + Bullish Reversal (40%)");
  } else if (isNearMA20 && latest.close > prev.close) {
    longScore += 30; // Partial score for non-reversal green candle
    longReasons.push("Trendline Base + Green Candle (30%)");
  }

  if (isNearMA20 && isBearishReversalCandle(latest, prev)) {
    shortScore += 40;
    shortReasons.push("Trendline Base + Bearish Reversal (40%)");
  } else if (isNearMA20 && latest.close < prev.close) {
    shortScore += 30;
    shortReasons.push("Trendline Base + Red Candle (30%)");
  }

  // RSI Confirmation (20%)
  if (currentRSI < 30) {
    longScore += 20;
    longReasons.push("RSI < 30 Oversold (20%)");
  } else if (currentRSI < 45) { // Partial leeway
    longScore += 10;
    longReasons.push(`RSI ${currentRSI.toFixed(1)} (10%)`);
  }

  if (currentRSI > 70) {
    shortScore += 20;
    shortReasons.push("RSI > 70 Overbought (20%)");
  } else if (currentRSI > 55) {
    shortScore += 10;
    shortReasons.push(`RSI ${currentRSI.toFixed(1)} (10%)`);
  }

  // MACD Alignment (20%)
  if (currentMACD && currentMACD.MACD !== undefined && currentMACD.signal !== undefined) {
    if (currentMACD.MACD > currentMACD.signal && currentMACD.histogram && currentMACD.histogram > 0) {
      longScore += 20;
      longReasons.push("MACD Bullish Alignment (20%)");
    } else if (currentMACD.MACD < currentMACD.signal && currentMACD.histogram && currentMACD.histogram < 0) {
      shortScore += 20;
      shortReasons.push("MACD Bearish Alignment (20%)");
    }
  }

  // EMA Trend Filter (10%)
  if (currentEMA50 > currentEMA200) {
    longScore += 10;
    longReasons.push("50 EMA > 200 EMA (10%)");
  } else if (currentEMA50 < currentEMA200) {
    shortScore += 10;
    shortReasons.push("50 EMA < 200 EMA (10%)");
  }

  // Volume Spike Check (10%)
  if (latest.vol > avgVol * 1.5) {
    const volMultiplier = (latest.vol / avgVol).toFixed(1);
    longScore += 10;
    shortScore += 10;
    longReasons.push(`Volume Spike ${volMultiplier}x (10%)`);
    shortReasons.push(`Volume Spike ${volMultiplier}x (10%)`);
  }

  const is_scalp = ['1m', '5m', '15m', '1h'].includes(timeframe);

  if (longScore >= 70 && longScore > shortScore) {
    if (currentRSI > 45) {
      return { status: 'no valid signal' };
    }

    const entry = latest.close;
    
    // Stop Loss Rules
    const atrSL = entry - (1.5 * currentATR);
    const recentLows = klines.slice(-10).map(k => k.low);
    const swingLow = Math.min(...recentLows) * 0.998; // Beyond swing low with tiny extra buffer
    const trendlineBuffer = is_scalp ? 0.005 : 0.01;
    const trendlineSL = sma20 * (1 - trendlineBuffer);
    
    // Most conservative (lowest) SL
    const stop_loss = Number(Math.min(atrSL, swingLow, trendlineSL).toFixed(4));

    const targets = [
      Number((entry + (entry - stop_loss) * 1.5).toFixed(4)), // TP1: 1.5 RR fallback
      Number((entry + (entry - stop_loss) * 2.5).toFixed(4))  // TP2: 2.5 RR
    ];

    // R:R Calculation
    const risk = entry - stop_loss;
    const reward1 = targets[0] - entry;
    const reward2 = targets[1] - entry;
    
    const rr1 = risk > 0 ? reward1 / risk : 0;
    const rr2 = risk > 0 ? reward2 / risk : 0;
    const maxRR = Math.max(rr1, rr2);

    if (maxRR < 2) {
      return { status: 'no valid signal' };
    }

    return {
      pair: pair,
      timeframe: timeframe,
      signal_type: 'long',
      entry: entry,
      targets: targets,
      stop_loss: stop_loss,
      note: `Score: ${longScore}% | R:R ${maxRR.toFixed(1)} | ` + longReasons.join(", "),
      is_scalp: is_scalp,
      score: longScore
    };
  }

  if (shortScore >= 70 && shortScore > longScore) {
    if (currentRSI < 55) {
      return { status: 'no valid signal' };
    }

    const entry = latest.close;

    // Stop Loss Rules
    const atrSL = entry + (1.5 * currentATR);
    const recentHighs = klines.slice(-10).map(k => k.high);
    const swingHigh = Math.max(...recentHighs) * 1.002;
    const trendlineBuffer = is_scalp ? 0.005 : 0.01;
    const trendlineSL = sma20 * (1 + trendlineBuffer);

    // Most conservative (highest) SL
    const stop_loss = Number(Math.max(atrSL, swingHigh, trendlineSL).toFixed(4));

    const targets = [
      Number((entry - (stop_loss - entry) * 1.5).toFixed(4)),
      Number((entry - (stop_loss - entry) * 2.5).toFixed(4))
    ];

    // R:R Calculation (Short)
    const risk = stop_loss - entry;
    const reward1 = entry - targets[0];
    const reward2 = entry - targets[1];
    
    const rr1 = risk > 0 ? reward1 / risk : 0;
    const rr2 = risk > 0 ? reward2 / risk : 0;
    const maxRR = Math.max(rr1, rr2);

    if (maxRR < 2) {
      return { status: 'no valid signal' };
    }

    return {
      pair: pair,
      timeframe: timeframe,
      signal_type: 'short',
      entry: entry,
      targets: targets,
      stop_loss: stop_loss,
      note: `Score: ${shortScore}% | R:R ${maxRR.toFixed(1)} | ` + shortReasons.join(", "),
      is_scalp: is_scalp,
      score: shortScore
    };
  }

  return { status: 'no valid signal' };
}
