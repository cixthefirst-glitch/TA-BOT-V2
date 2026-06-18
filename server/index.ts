import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { getMEXCKlines, getAvailablePairs } from "./mexc";
import { getMarketContext } from "./coingecko";
import { analyzePair } from "./analyzer";
import { broadcastMessage } from "./telegram";
import { getActiveSignals, saveSignal, updateSignalStatus, getRecentSignals, get24hPerformance, Signal } from "./db";

async function startServer() {
  try {
    console.log("Starting server initialization...");
    const app = express();
    const PORT = 3000;

    app.use(express.json());

    console.log("Registering routes...");
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/signals", async (req, res) => {
    const signals = await getRecentSignals(50);
    res.json(signals);
  });
  
  app.get("/api/active-signals", async (req, res) => {
    const active = await getActiveSignals();
    res.json(active);
  });

  app.get("/api/performance", async (req, res) => {
    const stats = await get24hPerformance();
    res.json(stats);
  });

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
              const result = analyzePair(pair.replace('_', '/'), tf, klines, marketContext);
              
              if (!('status' in result) || result.status !== 'no valid signal') {
                foundSignals++;
                const signalResult = result as any;
                
                // Format nice message
                let msg = '';
                if (signalResult.is_aggressive) {
                  if (signalResult.signal_type === 'long') {
                    msg = `🚀 PRE-PUMP ALERT 🚀\nLONG ${signalResult.pair} (${signalResult.timeframe})\nProbability: ≤ 60%\nEntry: ${signalResult.entry}\nSL: ${signalResult.stop_loss}\nTP: ${signalResult.targets.join(', ')}\nIndicators: ${signalResult.note}`;
                  } else {
                    msg = `⚠️ PRE-DUMP ALERT ⚠️\nSHORT ${signalResult.pair} (${signalResult.timeframe})\nProbability: ≤ 60%\nEntry: ${signalResult.entry}\nSL: ${signalResult.stop_loss}\nTP: ${signalResult.targets.join(', ')}\nIndicators: ${signalResult.note}`;
                  }
                } else {
                  msg = `🎯 CONFIRMED SIGNAL 🎯\n${signalResult.signal_type.toUpperCase()} ${signalResult.pair} (${signalResult.timeframe})\nProbability: ≥ 70%\nEntry: ${signalResult.entry}\nSL: ${signalResult.stop_loss}\nTP: ${signalResult.targets.join(', ')}\nReason: ${signalResult.note}`;
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
                  is_aggressive: !!signalResult.is_aggressive
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

  // Scan for new signals every hour
  cron.schedule("0 * * * *", runScan);

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
          await updateSignalStatus(sig.id!, hitStatus);
          const msg = hitStatus === 'TARGET_HIT' 
            ? `✅ Target Hit: ${sig.pair} reached ${hitVal} (${sig.timeframe} ${sig.type.toUpperCase()})`
            : `❌ Stop Loss Hit: ${sig.pair} stopped at ${hitVal} (${sig.timeframe} ${sig.type.toUpperCase()})`;
          broadcastMessage(msg);
        }
      }
    } catch(e) {
      console.error("Error in check loop:", e);
    }
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
