import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { getMEXCKlines, getAvailablePairs } from "./mexc";
import { getMarketContext } from "./coingecko";
import { analyzePair } from "./analyzer";
import { broadcastMessage } from "./telegram";
import { getActiveSignals, saveSignal, updateSignalStatus, getRecentSignals, get24hPerformance, Signal, clearAllSignals, deleteSignal } from "./db";

async function startServer() {
  try {
    console.log("Starting server initialization...");
    const app = express();
    const PORT = 3000;

    app.use(express.json());

    // API Routes
    app.get("/api/health", (req, res) => {
      console.log("Health route hit");
      res.json({ status: "ok" });
    });
    console.log("Health route registered");

    // Cache for latest backtests
    const backtestCache = new Map<string, any>();

    // Scheduled backtest for popular pairs
    cron.schedule("0 */4 * * *", async () => { // Every 4 hours
      console.log("Running scheduled autonomous backtest...");
      const pairs = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'];
      const { runBacktestSuite } = await import('./backtest');
      
      for (const pair of pairs) {
        try {
          const marketContext = await getMarketContext();
          const result = await runBacktestSuite(pair, '1h', ['conservative'], marketContext);
          backtestCache.set(pair, result);
          console.log(`Autonomous backtest for ${pair} complete.`);
        } catch (e) {
          console.error(`Autonomous backtest failed for ${pair}:`, e);
        }
      }
    });

    app.get("/api/backtest-cache", async (req, res) => {
      res.json(Object.fromEntries(backtestCache));
    });

    app.post("/api/backtest", async (req, res) => {
      try {
        const { pair, pairs, timeframe = '15m', strategies = ['conservative'], marketTrend } = req.body;
        let pairsToRun = pairs || [pair || 'BTC_USDT'];
        
        const { runBacktestSuite } = await import('./backtest');
        
        if (pairsToRun.length === 1 && pairsToRun[0] === 'AUTO') {
          const { getAvailablePairs } = await import('./mexc');
          const allPairs = await getAvailablePairs();
          pairsToRun = allPairs.sort(() => 0.5 - Math.random()).slice(0, 10);
        } else if (pairsToRun.length === 1 && pairsToRun[0].includes(',')) {
          pairsToRun = pairsToRun[0].split(',').map((p: string) => p.trim()).filter(Boolean);
        }

        const marketContext = (marketTrend && marketTrend !== 'Neutral') ? marketTrend.toLowerCase() : await getMarketContext();
        const results = await Promise.all(pairsToRun.map(async (p) => {
          const result = await runBacktestSuite(p, timeframe, strategies, marketContext);
          return { p, result: Array.isArray(result) ? result : [] };
        }));

        const aggregated: Record<string, { wins: number, losses: number, totalTrades: number }> = {};
        for (const { result } of results) {
          for (const sRes of (result as any[])) {
            if (!aggregated[sRes.strategyName]) aggregated[sRes.strategyName] = { wins: 0, losses: 0, totalTrades: 0 };
            aggregated[sRes.strategyName].wins += (sRes.wins || 0);
            aggregated[sRes.strategyName].losses += (sRes.losses || 0);
            aggregated[sRes.strategyName].totalTrades += (sRes.totalTrades || 0);
          }
        }
        const finalAggregated = Object.entries(aggregated).map(([name, data]) => ({
          name,
          ...data,
          winRate: data.totalTrades > 0 ? ((data.wins / data.totalTrades) * 100).toFixed(1) + '%' : '0%'
        }));

        res.json({ results, aggregated: finalAggregated });
      } catch (error: any) {
        console.error('Backtest error:', error);
        res.status(500).json({ error: error.message || 'Failed to run backtest' });
      }
    });

    app.get("/api/signals", async (req, res) => {
      console.log("!!! /api/signals route reached !!!");
      try {
        const signals = await getRecentSignals(50);
        res.json(signals || []);
      } catch (error) {
        console.error("Error fetching signals:", error);
        res.status(500).json({ error: "Failed to fetch signals" });
      }
    });
    
    app.get("/api/active-signals", async (req, res) => {
      const active = await getActiveSignals();
      res.json(active);
    });

    app.get("/api/performance", async (req, res) => {
      const stats = await get24hPerformance();
      res.json(stats);
    });

    app.post("/api/clear-signals", async (req, res) => {
      console.log("Received request to clear signals");
      const success = await clearAllSignals();
      console.log("Clear signals result:", success);
      res.json({ success });
    });

    // ... other routes ...

  // Scheduled tasks for the bot
  const TIMEFRAMES = ["1h", "4h", "1d"];

  const runScan = async () => {
    console.log("Running scheduled market scan...");
    try {
      const PAIRS = await getAvailablePairs();
      console.log(`Scanning ${PAIRS.length} pairs...`);
      const marketContext = await getMarketContext();
      let foundSignals = 0;
      
      // Process in chunks to avoid rate limits
      const CHUNK_SIZE = 10;
      for (let i = 0; i < PAIRS.length; i += CHUNK_SIZE) {
        const chunk = PAIRS.slice(i, i + CHUNK_SIZE);
        
        await Promise.all(chunk.map(async (pair) => {
          for (const tf of TIMEFRAMES) {
            try {
              const klines = await getMEXCKlines(pair, tf);
              const result = await analyzePair(pair.replace('_', '/'), tf, klines, marketContext);
              
              if ('status' in result && result.status === 'rejected') {
                const rejResult = result as any;
                console.log(`[Analytics] Signal rejected for ${pair} (${tf}): prob ${rejResult.probability}% / reason ${rejResult.reason_score}% - ${rejResult.reason || 'below threshold'}`);
              } else if (!('status' in result) || result.status !== 'no valid signal') {
                foundSignals++;
                const signalResult = result as any;
                
                // Format nice message (more casual)
                let msg = '';
                if (signalResult.is_aggressive) {
                  const icon = signalResult.signal_type === 'long' ? '🚀' : '⚠️';
                  msg = `${icon} ${signalResult.signal_type === 'long' ? 'PRE-PUMP' : 'PRE-DUMP'} ALERT 
${signalResult.signal_type.toUpperCase()} ${signalResult.pair} (${signalResult.timeframe})
Prob: ~${signalResult.probability}%
Entry: ${signalResult.entry}
SL: ${signalResult.stop_loss}
TP: ${signalResult.targets.join(', ')}
Context: ${signalResult.note}`;
                } else {
                  msg = `🎯 SIGNAL: ${signalResult.signal_type.toUpperCase()} ${signalResult.pair} (${signalResult.timeframe})
Prob: ${signalResult.probability}% | Reason Score: ${signalResult.reason_score}%
Entry: ${signalResult.entry}
Targets: ${signalResult.targets.join(', ')}
SL: ${signalResult.stop_loss}
Note: ${signalResult.note}`;
                }
                
                broadcastMessage(msg);
                
                await saveSignal({
                  pair: signalResult.pair,
                  timeframe: signalResult.timeframe,
                  type: signalResult.signal_type,
                  entry: signalResult.entry,
                  targets: signalResult.targets,
                  stop_loss: signalResult.stop_loss,
                  note: signalResult.note,
                  status: 'OPEN',
                  is_aggressive: !!signalResult.is_aggressive,
                  strategyName: 'conservative',
                  pattern: signalResult.pattern,
                  market_structure: signalResult.market_structure
                });
              }
            } catch (err) {
              console.error(`Error scanning ${pair} ${tf}:`, err);
            }
          }
        }));
        
        // Small delay between chunks
        if (i + CHUNK_SIZE < PAIRS.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      return { success: true, signalsGenerated: foundSignals };
    } catch (e) {
      console.error("Error in scan loop:", e);
      return { success: false, error: String(e) };
    }
  };

  app.post("/api/scan", async (req, res) => {
    const result = await runScan();
    res.json(result);
  });

  app.post("/api/signals/clear", async (req, res) => {
    const success = await clearAllSignals();
    res.json({ success });
  });

  app.post("/api/signals/clear-recent", async (req, res) => {
    const success = await clearRecentSignals();
    res.json({ success });
  });

  // Scan for new signals every minute
  cron.schedule("* * * * *", runScan);
  
  // Strategy optimization daily
  cron.schedule("0 0 * * *", async () => {
    const { runOptimization } = await import('./optimizer');
    await runOptimization();
  });

  // Check active signals to see if target or stop loss hit (every 5 mins)
  cron.schedule("*/5 * * * *", async () => {
    console.log("Checking active signals...");
    try {
      const activeSignals = await getActiveSignals();
      for (const sig of activeSignals) {
        // Fetch latest price on short timeframe to check
        const klines = await getMEXCKlines(sig.pair.replace('/', '_'), '15m');
        if (klines.length === 0) continue;
        const currentPrice = klines[klines.length - 1].close;
        const highPrice = klines[klines.length - 1].high;
        const lowPrice = klines[klines.length - 1].low;

        let hitStatus: 'TARGET_HIT' | 'STOP_HIT' | null = null;
        let hitVal = 0;

        if (sig.type === 'long') {
          if (lowPrice <= sig.stop_loss) {
            hitStatus = 'STOP_HIT';
            hitVal = sig.stop_loss;
          } else if (highPrice >= sig.targets[0]) {
            hitStatus = 'TARGET_HIT';
            hitVal = sig.targets[0];
          }
        } else {
          // short
          if (highPrice >= sig.stop_loss) {
            hitStatus = 'STOP_HIT';
            hitVal = sig.stop_loss;
          } else if (lowPrice <= sig.targets[0]) {
            hitStatus = 'TARGET_HIT';
            hitVal = sig.targets[0];
          }
        }

        if (hitStatus) {
          await deleteSignal(sig.id!);
          const msg = hitStatus === 'TARGET_HIT' 
            ? `✅ Profit! ${sig.pair} hit ${hitVal} (${sig.timeframe} ${sig.type.toUpperCase()})`
            : `❌ Closed: ${sig.pair} hit stop loss at ${hitVal} (${sig.timeframe} ${sig.type.toUpperCase()})`;
          broadcastMessage(msg);
        }
      }
    } catch(e) {
      console.error("Error in check loop:", e);
    }
  });

  // Clear all signals every 24 hours
  cron.schedule("0 0 * * *", async () => {
    console.log("Running scheduled 24h signal cleanup...");
    await clearAllSignals();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite middleware...");
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware attached.");
    } catch (e) {
      console.error("Vite server setup failed:", e);
    }
  } else {
    console.log("Setting up production static serving...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
  

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully listening on 0.0.0.0:${PORT}`);
  });
  } catch (error) {
    console.error("CRITICAL: Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
