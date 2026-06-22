import { KlineInput } from './mexc';
import { RSI, MACD, EMA, ATR, ADX, BollingerBands } from 'technicalindicators';

export interface AnalysisResult {
  pair: string;
  timeframe: string;
  signal_type: 'long' | 'short';
  entry: number;
  targets: number[];
  stop_loss: number;
  note: string;
  is_scalp: boolean;
  score?: number; // legacy
  probability?: number;
  reason_score?: number;
  reason?: string;
  status?: string;
  is_aggressive?: boolean;
  rr?: number;
}

export interface StrategyConfig {
  name: string;
  probabilityThreshold: number;
  reasonScoreThreshold: number;
  slMultiplierScalp: number;
  slMultiplierSwing: number;
}

export const STRATEGIES: Record<string, StrategyConfig> = {
  conservative: { name: 'conservative', probabilityThreshold: 70, reasonScoreThreshold: 80, slMultiplierScalp: 1.5, slMultiplierSwing: 2.5 },
  aggressive: { name: 'aggressive', probabilityThreshold: 60, reasonScoreThreshold: 60, slMultiplierScalp: 1.0, slMultiplierSwing: 2.0 },
};

function isBullishReversalCandle(candle: KlineInput, prevCandle: KlineInput): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  if (lowerWick > bodySize * 2 && upperWick < bodySize) return true;
  if (prevCandle.close < prevCandle.open && candle.close > candle.open && candle.close > prevCandle.open && candle.open < prevCandle.close) return true;
  return false;
}

function isBearishReversalCandle(candle: KlineInput, prevCandle: KlineInput): boolean {
  const bodySize = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  if (upperWick > bodySize * 2 && lowerWick < bodySize) return true;
  if (prevCandle.close > prevCandle.open && candle.close < candle.open && candle.close < prevCandle.open && candle.open > prevCandle.close) return true;
  return false;
}

export function analyzePair(pair: string, timeframe: string, klines: KlineInput[], marketContext: string, strategy: StrategyConfig = STRATEGIES.conservative): AnalysisResult | { status: string } {
  if (!klines || klines.length < 200) return { status: 'no valid signal' };

  const latest = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const closePrices = klines.map(k => k.close);
  const highPrices = klines.map(k => k.high);
  const lowPrices = klines.map(k => k.low);

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

  const adxValues = ADX.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
  const currentADX = adxValues.length > 0 ? adxValues[adxValues.length - 1] : { adx: 20, pdi: 0, mdi: 0 };

  let sum20 = 0;
  const smaPeriod = Math.min(20, klines.length);
  for (let i = klines.length - smaPeriod; i < klines.length; i++) {
    sum20 += klines[i].close;
  }
  const sma20 = sum20 / smaPeriod;

  const bbValues = BollingerBands.calculate({ period: 20, stdDev: 2, values: closePrices });
  const currentBB = bbValues[bbValues.length - 1] || { middle: sma20, upper: sma20 * 1.05, lower: sma20 * 0.95 };

  const avgVol = klines.slice(-50, -1).reduce((acc, k) => acc + k.vol, 0) / 49;
  const isNearMA20 = Math.abs(latest.close - sma20) / sma20 < 0.02;

  if (currentADX.adx < 20) return { status: 'rejected', reason: 'sideways market (ADX < 20)' };

  let longReasonScore = 0;
  let shortReasonScore = 0;
  let longProbability = 50;
  let shortProbability = 50;
  let longReasons: string[] = [];
  let shortReasons: string[] = [];

  // Trend Strength Filter
  if (currentADX.adx > 25) {
    if (currentADX.pdi > currentADX.mdi) {
      longReasonScore += 15;
      longProbability += 10;
      longReasons.push("Strong Bullish Trend (ADX > 25)");
    } else if (currentADX.mdi > currentADX.pdi) {
      shortReasonScore += 15;
      shortProbability += 10;
      shortReasons.push("Strong Bearish Trend (ADX > 25)");
    }
  }

  // Volume Confirmation
  const volumeMA = avgVol; 
  const volumeMultiplier = latest.vol / volumeMA;
  if (volumeMultiplier > 1.5) {
      longReasonScore += 10;
      shortReasonScore += 10;
      longReasons.push("High Volume (1.5x)");
      shortReasons.push("High Volume (1.5x)");
  }

  if (isNearMA20 && isBullishReversalCandle(latest, prev)) {
    longReasonScore += 40;
    longProbability += 15;
    longReasons.push("Trendline Base + Bullish Reversal");
  } else if (isNearMA20 && latest.close > prev.close) {
    longReasonScore += 30;
    longProbability += 10;
    longReasons.push("Trendline Base + Green Candle");
  }

  if (isNearMA20 && isBearishReversalCandle(latest, prev)) {
    shortReasonScore += 40;
    shortProbability += 15;
    shortReasons.push("Trendline Base + Bearish Reversal");
  } else if (isNearMA20 && latest.close < prev.close) {
    shortReasonScore += 30;
    shortProbability += 10;
    shortReasons.push("Trendline Base + Red Candle");
  }

  if (currentRSI < 30) {
    longReasonScore += 20;
    longProbability += (40 - currentRSI);
    longReasons.push("RSI < 30 Oversold");
  } else if (currentRSI < 45) {
    longReasonScore += 10;
    longProbability += Math.max(0, 45 - currentRSI);
    longReasons.push(`RSI ${currentRSI.toFixed(1)}`);
  }

  if (currentRSI > 70) {
    shortReasonScore += 20;
    shortProbability += (currentRSI - 60);
    shortReasons.push("RSI > 70 Overbought");
  } else if (currentRSI > 55) {
    shortReasonScore += 10;
    shortProbability += Math.max(0, currentRSI - 55);
    shortReasons.push(`RSI ${currentRSI.toFixed(1)}`);
  }

  // BB Filter
  if (latest.close > currentBB.upper) {
    longProbability -= 10;
    longReasons.push("Price above Upper BB");
  } else if (latest.close < currentBB.lower) {
    shortProbability -= 10;
    shortReasons.push("Price below Lower BB");
  }

  if (currentMACD && currentMACD.MACD !== undefined && currentMACD.signal !== undefined) {
    if (currentMACD.MACD > currentMACD.signal && currentMACD.histogram && currentMACD.histogram > 0) {
      longReasonScore += 20;
      longProbability += 10;
      longReasons.push("MACD Bullish Alignment");
    } else if (currentMACD.MACD < currentMACD.signal && currentMACD.histogram && currentMACD.histogram < 0) {
      shortReasonScore += 20;
      shortProbability += 10;
      shortReasons.push("MACD Bearish Alignment");
    }
  }

  if (currentEMA50 > currentEMA200) {
    longReasonScore += 10;
    longProbability += 10;
    longReasons.push("50 EMA > 200 EMA");
  } else if (currentEMA50 < currentEMA200) {
    shortReasonScore += 10;
    shortProbability += 10;
    shortReasons.push("50 EMA < 200 EMA");
  }

  if (latest.vol > avgVol * 1.5) {
    longReasonScore += 10;
    shortReasonScore += 10;
    longProbability += 5;
    shortProbability += 5;
    longReasons.push("Volume Spike");
    shortReasons.push("Volume Spike");
  }

  longProbability = Math.min(99, Math.round(longProbability));
  shortProbability = Math.min(99, Math.round(shortProbability));

  if (strategy.name === 'conservative') {
    if (marketContext === 'bullish' && shortReasonScore > longReasonScore) return { status: 'no valid signal' };
    if (marketContext === 'bearish' && longReasonScore > shortReasonScore) return { status: 'no valid signal' };
  }

  const is_scalp = ['1m', '5m', '15m', '1h'].includes(timeframe);

  if (longReasonScore > shortReasonScore) {
    if (longProbability < strategy.probabilityThreshold || longReasonScore < strategy.reasonScoreThreshold) {
      return { status: 'rejected', reason: `score below thresholds (prob: ${longProbability}%, reason: ${longReasonScore}%)`, probability: longProbability, reason_score: longReasonScore };
    }

    if (currentRSI > 45) return { status: 'no valid signal' };

    const entry = latest.close;
    const slMultiplier = is_scalp ? strategy.slMultiplierScalp : strategy.slMultiplierSwing;
    const atrSL = entry - (slMultiplier * currentATR);
    const recentLows = klines.slice(-10).map(k => k.low);
    const swingLow = Math.min(...recentLows) * 0.995;
    const trendlineBuffer = is_scalp ? 0.005 : 0.01;
    const trendlineSL = sma20 * (1 - trendlineBuffer);
    
    const stop_loss = Number(Math.min(atrSL, swingLow, trendlineSL).toFixed(4));
    const targets = [
      Number((entry + (entry - stop_loss) * 1.5).toFixed(4)),
      Number((entry + (entry - stop_loss) * 2.5).toFixed(4))
    ];

    const risk = entry - stop_loss;
    const reward1 = targets[0] - entry;
    const reward2 = targets[1] - entry;
    const maxRR = risk > 0 ? Math.max(reward1, reward2) / risk : 0;

    if (maxRR < 1.5) return { status: 'no valid signal' };

    return { pair, timeframe, signal_type: 'long', entry, targets, stop_loss, note: `R:R ${maxRR.toFixed(1)} | ` + longReasons.join(", "), is_scalp, probability: longProbability, reason_score: longReasonScore, rr: Number(maxRR.toFixed(2)) };
  }

  if (shortReasonScore > longReasonScore) {
    if (shortProbability < strategy.probabilityThreshold || shortReasonScore < strategy.reasonScoreThreshold) {
      return { status: 'rejected', reason: `score below thresholds (prob: ${shortProbability}%, reason: ${shortReasonScore}%)`, probability: shortProbability, reason_score: shortReasonScore };
    }

    if (currentRSI < 55) return { status: 'no valid signal' };

    const entry = latest.close;
    const slMultiplier = is_scalp ? strategy.slMultiplierScalp : strategy.slMultiplierSwing;
    const atrSL = entry + (slMultiplier * currentATR);
    const recentHighs = klines.slice(-10).map(k => k.high);
    const swingHigh = Math.max(...recentHighs) * 1.005;
    const trendlineBuffer = is_scalp ? 0.005 : 0.01;
    const trendlineSL = sma20 * (1 + trendlineBuffer);

    const stop_loss = Number(Math.max(atrSL, swingHigh, trendlineSL).toFixed(4));
    const targets = [
      Number((entry - (stop_loss - entry) * 1.5).toFixed(4)),
      Number((entry - (stop_loss - entry) * 2.5).toFixed(4))
    ];

    const risk = stop_loss - entry;
    const reward1 = entry - targets[0];
    const reward2 = entry - targets[1];
    const maxRR = risk > 0 ? Math.max(reward1, reward2) / risk : 0;

    if (maxRR < 1.5) return { status: 'no valid signal' };

    return { pair, timeframe, signal_type: 'short', entry, targets, stop_loss, note: `R:R ${maxRR.toFixed(1)} | ` + shortReasons.join(", "), is_scalp, probability: shortProbability, reason_score: shortReasonScore, rr: Number(maxRR.toFixed(2)) };
  }

  return { status: 'no valid signal' };
}
