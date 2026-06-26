import { KlineInput } from './mexc';
import { GoogleGenAI, Type } from '@google/genai';

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
}

export interface StrategyConfig {
  name: string;
  probabilityThreshold: number;
  reasonScoreThreshold: number;
  slMultiplierScalp: number;
  slMultiplierSwing: number;
}

export const STRATEGIES: Record<string, StrategyConfig> = {
  conservative: { name: 'conservative', probabilityThreshold: 52, reasonScoreThreshold: 60, slMultiplierScalp: 1.5, slMultiplierSwing: 2.5 },
  aggressive: { name: 'aggressive', probabilityThreshold: 45, reasonScoreThreshold: 45, slMultiplierScalp: 1.0, slMultiplierSwing: 2.0 },
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function analyzePair(pair: string, timeframe: string, klines: KlineInput[], marketContext: string, strategy: StrategyConfig = STRATEGIES.conservative): Promise<AnalysisResult | { status: string }> {
  if (!klines || klines.length < 200) return { status: 'no valid signal' };

  let retries = 3;
  let delay = 2000;
  
  while (retries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `
          Analyze this crypto pair: ${pair} (${timeframe}). Current market context: ${marketContext}.
          Recent Klines (last 100): ${JSON.stringify(klines.slice(-100))}
          
          RULES:
          1. Market Structure & Price Action (Priority 1): First, map the current market structure (HH/HL/LH/LL/BOS). You MUST identify the trend based on price action alone.
          2. Chart Pattern Recognition (Priority 2): Scan the last 100 klines for active chart patterns (e.g., Head and Shoulders, Double Top/Bottom, Triangles, Wedges, Channels, Flags, Pennants). Explicitly name the pattern and its significance (e.g., continuation or reversal).
          3. Contextual Confluence (Indicators): Use RSI (14), MACD, and EMA (50/200) ONLY to confirm the thesis derived from Price Action and Patterns. Do NOT signal based solely on indicators.
          4. Candlestick Confirmation: Require a clear trigger (Engulfing, Hammer, Morning/Evening Star, Doji) at a key structural level or pattern breakout point.
          5. Risk Management: Strictly ensure R:R >= 2.0. If entry and stop_loss do not support R:R >= 2.0, reject the trade.
          6. Analyst Narrative: Include a concise, professional justification for the trade setup based on the confluence of structure, pattern, and price action.
          7. Filters: Prob >= ${strategy.probabilityThreshold}%, Reason Score >= ${strategy.reasonScoreThreshold}%, ADX >= 20.
          
          If no valid trade found, return status "no valid signal".
        `,
        config: {
          systemInstruction: "You are an expert technical analyst. Strictly follow the provided rules. Output ONLY JSON.",
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
        note: `Pattern: ${result.pattern}, Structure: ${result.market_structure}`,
        is_scalp: ['1m', '5m', '15m', '1h'].includes(timeframe),
        probability: result.probability,
        reason_score: result.reason_score,
        rr: 2.0, // Placeholder
        pattern: result.pattern,
        market_structure: result.market_structure
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
