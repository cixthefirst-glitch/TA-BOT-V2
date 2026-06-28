import { KlineInput } from './mexc';
import { GoogleGenAI, Type } from '@google/genai';
import { get24hPerformance } from './db';
import { SYSTEM_INSTRUCTION, TRADING_MODULES } from './ai_instructions';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export interface AnalysisResult {
  pair: string;
  timeframe: string;
  signal_type: 'long' | 'short';
  entry: number;
  targets: number[];
  stop_loss: number;
  note: string;
  is_scalp: boolean;
  probability?: number;
  reason_score?: number;
  status?: string;
  rr?: number;
  pattern?: string;
  market_structure?: string;
  market_condition?: 'bullish' | 'sideways' | 'bearish';
}

export interface StrategyConfig {
  name: string;
  probabilityThreshold: number;
  reasonScoreThreshold: number;
  slMultiplierScalp: number;
  slMultiplierSwing: number;
}

export const STRATEGIES: Record<string, StrategyConfig> = {
  conservative: { name: 'conservative', probabilityThreshold: 45, reasonScoreThreshold: 50, slMultiplierScalp: 1.5, slMultiplierSwing: 2.5 },
  aggressive: { name: 'aggressive', probabilityThreshold: 35, reasonScoreThreshold: 35, slMultiplierScalp: 1.0, slMultiplierSwing: 2.0 },
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function analyzePair(pair: string, timeframe: string, klines: KlineInput[], marketContext: string, strategy: StrategyConfig = STRATEGIES.conservative): Promise<AnalysisResult | { status: string }> {
  if (!klines || klines.length < 200) return { status: 'no valid signal' };

  const performance = await get24hPerformance();
  let retries = 3;
  let delay = 2000;
  
  while (retries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `
          Analyze this crypto pair: ${pair} (${timeframe}). Current market context: ${marketContext}.
          Recent Klines (last 100): ${JSON.stringify(klines.slice(-100))}
          Performance in last 24h: ${JSON.stringify(performance)}
          
          RULES:
          1. Market Structure & Price Action (Priority 1): First, map the current market structure (HH/HL/LH/LL/BOS). You MUST identify the trend based on price action alone.
          2. Trend Classification (Priority 2): Classify the market trend as "bullish", "sideways", or "bearish".
          3. Chart Pattern Recognition (Priority 3): Scan the last 100 klines for active chart patterns (e.g., Head and Shoulders, Double Top/Bottom, Triangles, Wedges, Channels, Flags, Pennants). Explicitly name the pattern and its significance (e.g., continuation or reversal).
          4. Volume Confirmation (Priority 4): YOU MUST confirm any breakout or structural reversal with significant volume. Compare recent volume with previous periods to ensure the move is supported by active buying or selling.
          5. Candlestick Confirmation: Require a clear trigger (Engulfing, Hammer, Morning/Evening Star, Doji) at a key structural level or pattern breakout point.
          6. Risk Management: Strictly ensure R:R >= 2.0. If entry and stop_loss do not support R:R >= 2.0, reject the trade.
          7. Analyst Narrative: Include a concise, professional justification for the trade setup based on the confluence of structure, pattern, trend, price action, and volume support.
          8. Filters: Prob >= ${strategy.probabilityThreshold}%, Reason Score >= ${strategy.reasonScoreThreshold}%.
          
          If performance is poor (e.g., high losses, low winrate), be MORE conservative in trade selection.
          If no valid trade found, return status "no valid signal".
        `,
        config: {
          systemInstruction: `${SYSTEM_INSTRUCTION}\n${TRADING_MODULES}`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pair: { type: Type.STRING },
              direction: { type: Type.STRING },
              entry: { type: Type.NUMBER },
              stop_loss: { type: Type.NUMBER },
              take_profit: { type: Type.ARRAY, items: { type: Type.NUMBER } },
              probability: { type: Type.NUMBER },
              reason_score: { type: Type.NUMBER },
              pattern: { type: Type.STRING },
              market_structure: { type: Type.STRING },
              market_condition: { type: Type.STRING, enum: ['bullish', 'sideways', 'bearish'] },
              status: { type: Type.STRING }
            }
          }
        }
      });

      if (!response.text) return { status: 'no valid signal' };
      
      const result = JSON.parse(response.text.trim());
      if (result.status === 'no valid signal') return result;

      return {
        pair: result.pair,
        timeframe,
        signal_type: result.direction.toLowerCase() === 'long' ? 'long' : 'short',
        entry: result.entry,
        targets: result.take_profit,
        stop_loss: result.stop_loss,
        note: `Pattern: ${result.pattern}, Structure: ${result.market_structure}, Condition: ${result.market_condition}`,
        is_scalp: ['1m', '5m', '15m', '1h'].includes(timeframe),
        probability: result.probability,
        reason_score: result.reason_score,
        rr: 2.0, // Placeholder
        pattern: result.pattern,
        market_structure: result.market_structure,
        market_condition: result.market_condition as 'bullish' | 'sideways' | 'bearish'
      };
    } catch (e: any) {
      if (retries > 1 && (e.status === 429 || e.status === 503)) {
         console.warn(`Retry due to error: ${e.status}. Retries left: ${retries - 1}`);
         await sleep(delay);
         delay *= 2;
         retries--;
         continue;
      }
      return { status: 'no valid signal' };
    }
  }
  return { status: 'no valid signal' };
}
