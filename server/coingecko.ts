import axios from 'axios';

const CG_API_KEY = process.env.COINGECKO_API_KEY || 'CG-HEnn4zeJWmS6hz8koVQmdfQH';

// Let's get generic market context or top coins trend to decide if the market is bullish or bearish overall
export async function getMarketContext(retries = 3): Promise<'bullish' | 'bearish' | 'neutral'> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/coins/bitcoin', {
        headers: {
          'x-cg-demo-api-key': CG_API_KEY
        }
      });
      // Check 24h & 7d change
      if (res.data && res.data.market_data) {
        const change24h = res.data.market_data.price_change_percentage_24h;
        if (change24h > 1) return 'bullish';
        if (change24h < -1) return 'bearish';
        return 'neutral';
      }
      return 'neutral'; 
    } catch (error: any) {
      console.error(`Failed to get CoinGecko market context (attempt ${i + 1}):`, error.message);
      if (i === retries - 1) break;
      await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Backoff
    }
  }
  return 'neutral'; // Fallback
}
