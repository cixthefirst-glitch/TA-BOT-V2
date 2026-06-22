import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { sendTelegramMessage } from './telegram';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const USER_CHAT_ID = process.env.USER_PERSONAL_CHAT_ID || '8184244632';

export async function runOptimization() {
  console.log("Running strategic analysis...");
  try {
    const signalsRef = collection(db, 'signals');
    const snapshot = await getDocs(signalsRef);
    
    const performance: Record<string, { wins: number, losses: number }> = {};
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (['TARGET_HIT', 'STOP_HIT'].includes(data.status)) {
        const strategy = data.strategyName || (data.is_aggressive ? 'aggressive' : 'conservative');
        if (!performance[strategy]) performance[strategy] = { wins: 0, losses: 0 };
        if (data.status === 'TARGET_HIT') performance[strategy].wins++;
        if (data.status === 'STOP_HIT') performance[strategy].losses++;
      }
    });
    
    let report = "📈 Bot Performance Analysis:\n";
    for (const [strategy, stats] of Object.entries(performance)) {
      const total = stats.wins + stats.losses;
      const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) + '%' : '0%';
      report += `- ${strategy}: ${winRate} Win Rate (${stats.wins}W / ${stats.losses}L)\n`;
    }
    
    console.log(report);

    // AI-Driven Improvement Insight
    const prompt = `Based on these bot performance statistics:
    ${report}
    
    Act as a professional algorithmic trading mentor. Analyze the performance and provide:
    1. A short analysis of how the strategies are performing.
    2. Suggest ONE specific, actionable adjustment to the strategy parameters (e.g., risk levels, profit targets, indicators) to improve the win rate.
    
    Keep the response concise for Telegram.`;
    
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
    });
    const insight = result.text;
    
    const finalMessage = `${report}\n\n🤖 AI Insight:\n${insight}`;
    
    console.log(finalMessage);
    await sendTelegramMessage(USER_CHAT_ID, finalMessage);

  } catch (e) {
    console.error("Optimization failed:", e);
  }
}
