import { getMEXCKlines } from './mexc.js';
import { analyzePair, STRATEGIES, StrategyConfig } from './analyzer.js';
import { KlineInput } from './mexc.js';
import { getMarketContext } from './coingecko.js';

function runSingleStrategyBacktest(klines: KlineInput[], pair: string, timeframe: string, strategy: StrategyConfig, marketContext: string) {
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalRr = 0;
  let sumProfits = 0;
  let sumLosses = 0;
  const trades = [];
  let openTrade: any = null;

  for (let i = 200; i < klines.length; i++) {
    const currentHigh = klines[i].high;
    const currentLow = klines[i].low;

    if (openTrade) {
      if (openTrade.signal_type === 'long') {
        if (currentLow <= openTrade.stop_loss) {
          const loss = Math.abs((openTrade.entry - openTrade.stop_loss) / openTrade.entry);
          losses++; sumLosses += loss; openTrade.result = 'loss'; openTrade.exit_price = openTrade.stop_loss;
          openTrade.rr = Math.abs(openTrade.exit_price - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stop_loss);
          totalRr += openTrade.rr; openTrade = null;
        } else if (currentHigh >= openTrade.targets[0]) {
          const profit = Math.abs((openTrade.targets[0] - openTrade.entry) / openTrade.entry);
          wins++; sumProfits += profit; openTrade.result = 'win'; openTrade.exit_price = openTrade.targets[0];
          openTrade.rr = Math.abs(openTrade.exit_price - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stop_loss);
          totalRr += openTrade.rr; openTrade = null;
        }
      } else if (openTrade.signal_type === 'short') {
        if (currentHigh >= openTrade.stop_loss) {
          const loss = Math.abs((openTrade.stop_loss - openTrade.entry) / openTrade.entry);
          losses++; sumLosses += loss; openTrade.result = 'loss'; openTrade.exit_price = openTrade.stop_loss;
          openTrade.rr = Math.abs(openTrade.exit_price - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stop_loss);
          totalRr += openTrade.rr; openTrade = null;
        } else if (currentLow <= openTrade.targets[0]) {
            const profit = Math.abs((openTrade.entry - openTrade.targets[0]) / openTrade.entry);
            wins++; sumProfits += profit; openTrade.result = 'win'; openTrade.exit_price = openTrade.targets[0];
            openTrade.rr = Math.abs(openTrade.exit_price - openTrade.entry) / Math.abs(openTrade.entry - openTrade.stop_loss);
            totalRr += openTrade.rr; openTrade = null;
        }
      }
      continue;
    }

    const historicalSlice = klines.slice(0, i + 1);
    const result = analyzePair(pair, timeframe, historicalSlice, marketContext, strategy);

    if ('status' in result) continue;
    
    openTrade = {
      ...result,
      entryIndex: i,
      entryTime: new Date(klines[i].time).toISOString()
    };
    trades.push(openTrade);
    totalTrades++;
  }

  const total = wins + losses;
  return {
    strategyName: strategy.name,
    pair,
    timeframe,
    wins,
    losses,
    totalTrades: total,
    winRate: total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0%',
    avgRr: total > 0 ? (totalRr / total).toFixed(1) : '0.0',
    profitFactor: sumLosses > 0 ? (sumProfits / sumLosses).toFixed(1) : (sumProfits > 0 ? 'inf' : '0.0'),
  };
}

export async function runBacktestSuite(pair: string, timeframe: string, strategyNames: string[] = ['conservative'], marketContext: string) {
  const klines = await getMEXCKlines(pair, timeframe);
  if (klines.length < 250) return { error: `Not enough data for ${pair}` };

  return strategyNames.map(name => {
    const strategy = STRATEGIES[name] || STRATEGIES.conservative;
    return runSingleStrategyBacktest(klines, pair, timeframe, strategy, marketContext);
  });
}
