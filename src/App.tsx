import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle, Clock, Search, ExternalLink, ShieldAlert, LineChart, PlayCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Signal {
  id: number;
  pair: string;
  timeframe: string;
  type: string;
  entry: number;
  targets: number[];
  stop_loss: number;
  note: string;
  status: 'OPEN' | 'TARGET_HIT' | 'STOP_HIT' | 'CLOSED';
  is_aggressive?: boolean;
  created_at: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'live' | 'backtest'>('live');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [activeSignals, setActiveSignals] = useState<Signal[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backtest state
  const [btPair, setBtPair] = useState('BTC_USDT');
  const [btTimeframe, setBtTimeframe] = useState('1h');
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(['conservative']);
  const [btRunning, setBtRunning] = useState(false);
  const [btResults, setBtResults] = useState<any>(null); // renamed from btResult to btResults
  const [isContinuousLoop, setIsContinuousLoop] = useState(false);
  const continuousLoopRef = React.useRef(false);

  React.useEffect(() => {
    continuousLoopRef.current = isContinuousLoop;
  }, [isContinuousLoop]);

  const runBacktest = async (pairs: string[], timeframe: string, strategies: string[]) => {
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs, timeframe, strategies })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBtResults(data);
    } catch (e) {
      console.error(e);
      alert('Backtest failed');
      setIsContinuousLoop(false);
      continuousLoopRef.current = false;
    } finally {
      if (continuousLoopRef.current) {
        setTimeout(() => runBacktest(pairs, timeframe, strategies), 30000);
      } else {
        setBtRunning(false);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'backtest') {
      fetch('/api/backtest-cache')
        .then(r => r.json())
        .then(data => {
            if (Object.keys(data).length > 0) {
                // Set the first one arbitrarily if no result yet
                setBtResults(Object.values(data)[0]);
            }
        });
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [allRes, activeRes, perfRes] = await Promise.all([
        fetch('/api/signals'),
        fetch('/api/active-signals'),
        fetch('/api/performance')
      ]);
      
      if (!allRes.ok || !activeRes.ok || !perfRes.ok) {
        throw new Error(`Server returned error: ${allRes.status} ${activeRes.status} ${perfRes.status}`);
      }

      for (const res of [allRes, activeRes, perfRes]) {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
           throw new Error(`The server is still starting up (received ${contentType} from ${res.url}). Please wait a few seconds and try again.`);
        }
      }

      const allData = await allRes.json();
      const activeData = await activeRes.json();
      const perfData = await perfRes.json();
      setSignals(allData);
      setActiveSignals(activeData);
      setPerformance(perfData);
      setError(null);
    } catch (error: any) {
      if (error instanceof TypeError && (error.message === 'Failed to fetch' || error.message.includes('NetworkError'))) {
        setError('Connection lost... reconnecting');
      } else {
        console.error('Failed to fetch data', error);
        setError(error.message || 'Failed to sync with server');
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'OPEN': return <Clock className="w-5 h-5 text-[#00f2ff]" />;
      case 'TARGET_HIT': return <CheckCircle2 className="w-5 h-5 text-[#00ff8c]" />;
      case 'STOP_HIT': return <XCircle className="w-5 h-5 text-[#ff2b56]" />;
      case 'CLOSED': return <XCircle className="w-5 h-5 text-[#718096]" />;
      default: return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'OPEN': return 'Open';
      case 'TARGET_HIT': return 'Target Hit';
      case 'STOP_HIT': return 'Stopped Out';
      case 'CLOSED': return 'Closed';
      default: return status;
    }
  };

  return (
    <div className="min-h-screen bg-[#050608] text-[#e0e6ed] p-6 md:p-12 font-sans relative overflow-x-hidden">
      {/* Glow background */}
      <div className="absolute top-[-100px] right-[-100px] w-[600px] h-[600px] rounded-full pointer-events-none z-0" style={{ background: 'radial-gradient(circle, rgba(0, 242, 255, 0.08) 0%, transparent 70%)' }}></div>
      <div className="max-w-6xl mx-auto space-y-8 relative z-10">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#00f2ff]/15 pb-6 gap-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center">
              <div className="w-3 h-3 bg-[#00f2ff] rounded-full shadow-[0_0_10px_#00f2ff]"></div>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-[0.1em] text-white uppercase font-sans">Analysis.Bot</h1>
              <p className="text-[#718096] text-[0.65rem] font-mono tracking-[0.1em] mt-1 uppercase">MEXC Futures & CoinGecko</p>
            </div>
          </div>
          
          <div className="flex bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 rounded p-1">
            <button
              onClick={() => setActiveTab('live')}
              className={cn("px-4 py-1.5 text-xs font-mono tracking-widest uppercase rounded flex items-center gap-2 transition-colors", activeTab === 'live' ? "bg-[#00f2ff]/10 text-[#00f2ff]" : "text-[#718096] hover:text-[#e0e6ed]")}
            >
              <Activity className="w-3 h-3" /> Live Feed
            </button>
            <button
              onClick={() => setActiveTab('backtest')}
              className={cn("px-4 py-1.5 text-xs font-mono tracking-widest uppercase rounded flex items-center gap-2 transition-colors", activeTab === 'backtest' ? "bg-[#00f2ff]/10 text-[#00f2ff]" : "text-[#718096] hover:text-[#e0e6ed]")}
            >
              <LineChart className="w-3 h-3" /> Backtester
            </button>
          </div>

          {activeTab === 'live' && (
            <div className="flex gap-4">
              <button 
                onClick={async () => {
                  if (isScanning) return;
                  setIsScanning(true);
                  try {
                    const res = await fetch('/api/scan', { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      fetchData();
                      if (data.signalsGenerated === 0) {
                        alert('Scan complete. No new signals found.');
                      } else {
                        alert(`Scan complete. ${data.signalsGenerated} new signals found and broadcasted.`);
                      }
                    }
                  } catch (e) {
                    alert('Scan failed. ' + String(e));
                  } finally {
                    setIsScanning(false);
                  }
                }}
                className={cn("px-4 py-2 bg-[rgba(20,24,33,0.7)] border border-white/20 hover:border-[#00f2ff]/50 rounded flex items-center gap-2 cursor-pointer transition-colors", isScanning && "opacity-50 cursor-not-allowed")}
              >
                <Search className={cn("w-3 h-3 text-[#00f2ff]", isScanning && "animate-spin")} />
                <span className="text-xs font-mono tracking-widest text-[#e0e6ed] uppercase">{isScanning ? "Scanning..." : "Force Scan"}</span>
              </button>
              <div className="px-4 py-2 bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 rounded flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#00ff8c] shadow-[0_0_5px_#00ff8c] animate-pulse" />
                <span className="text-xs font-mono tracking-widest text-[#718096] uppercase">System Online</span>
              </div>
            </div>
          )}
        </header>

        {activeTab === 'live' ? (
          <div className="space-y-12 animate-in fade-in">
            {/* Error Banner */}
            {error && (
              <div className="bg-[#ff2b56]/10 border border-[#ff2b56]/30 p-4 rounded flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <ShieldAlert className="w-5 h-5 text-[#ff2b56]" />
                <span className="text-sm font-mono text-[#ff2b56] uppercase tracking-wider">{error}</span>
                <button onClick={() => fetchData()} className="ml-auto text-[0.65rem] bg-[#ff2b56]/20 px-2 py-1 rounded hover:bg-[#ff2b56]/30 text-white uppercase font-mono">Retry</button>
              </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="p-6 rounded bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 flex flex-col justify-center">
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-[#718096] border-l-2 border-[#00f2ff] pl-3 mb-2">Active Signals</span>
                <span className="text-3xl font-bold font-mono text-white mt-1 pl-3">{activeSignals.length}</span>
              </div>
              <div className="p-6 rounded bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 flex flex-col justify-center">
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-[#718096] border-l-2 border-[#00f2ff] pl-3 mb-2">Total Generated</span>
                <span className="text-3xl font-bold font-mono text-white mt-1 pl-3">{signals.length}</span>
              </div>
              <div className="col-span-1 md:col-span-2 p-6 rounded bg-[rgba(20,24,33,0.7)] border border-[#00ff8c]/15 flex flex-col justify-center space-y-2 relative overflow-hidden">
                <div className="absolute right-[-20px] top-[-20px] opacity-5">
                  <Activity className="w-48 h-48 text-[#00ff8c]" />
                </div>
                <span className="text-[0.7rem] uppercase tracking-[0.15em] text-[#00ff8c] border-l-2 border-[#00ff8c] pl-3 mb-1">📈 24h Performance</span>
                {performance?.status === 'no signals today' ? (
                   <span className="text-sm font-mono text-[#718096] pl-3">No signals closed today</span>
                ) : performance ? (
                   <div className="grid grid-cols-4 gap-4 pl-3 font-mono">
                      <div className="flex flex-col"><span className="text-[0.6rem] text-[#718096] uppercase">Wins</span><span className="text-lg font-bold text-[#00ff8c]">{performance.wins}</span></div>
                      <div className="flex flex-col"><span className="text-[0.6rem] text-[#718096] uppercase">Losses</span><span className="text-lg font-bold text-[#ff2b56]">{performance.losses}</span></div>
                      <div className="flex flex-col"><span className="text-[0.6rem] text-[#718096] uppercase">Total</span><span className="text-lg font-bold text-white">{performance.total}</span></div>
                      <div className="flex flex-col border-l border-[#00ff8c]/20 pl-4"><span className="text-[0.6rem] text-[#718096] uppercase">Winrate</span><span className="text-lg font-bold text-[#00f2ff]">{performance.winrate}</span></div>
                   </div>
                ) : (
                   <span className="text-sm font-mono text-[#718096] pl-3">Loading...</span>
                )}
              </div>
            </div>

            {/* Telegram Row */}
            <div className="p-4 rounded bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 flex items-center justify-between">
                 <span className="text-[0.7rem] uppercase tracking-[0.15em] text-[#718096] border-l-2 border-[#00f2ff] pl-3">Telegram Broadcast</span>
                 <a href="https://t.me/ta_botxyzbot" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[0.75rem] font-bold font-mono bg-transparent border border-[#00f2ff]/30 hover:border-[#00f2ff] hover:bg-[#00f2ff]/10 text-[#00f2ff] px-4 py-2 rounded transition-colors uppercase tracking-wider">
                   Bot Link <ExternalLink className="w-3 h-3" />
                 </a>
            </div>

            {/* Signals Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[0.7rem] uppercase tracking-[0.15em] text-[#718096] border-l-2 border-[#00f2ff] pl-3">Recent Signals</h2>
                <button
                  onClick={async () => {
                    if (confirm('Are you sure you want to clear all signals?')) {
                      try {
                        const res = await fetch('/api/clear-signals', { method: 'POST' });
                        console.log("Response status:", res.status);
                        const data = await res.json();
                        console.log("Response data:", data);
                        if (data.success) {
                          fetchData();
                        } else {
                          alert('Failed to clear signals.');
                        }
                      } catch (e) {
                        alert('Failed to clear signals: ' + e);
                      }
                    }
                  }}
                  className="text-[0.65rem] bg-[#ff2b56]/10 px-2 py-1 rounded hover:bg-[#ff2b56]/30 text-[#ff2b56] uppercase font-mono tracking-wider border border-[#ff2b56]/30"
                >
                  Clear All
                </button>
              </div>
              
              <div className="bg-[rgba(255,255,255,0.02)] border border-[#00f2ff]/15 rounded overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#050608] text-[#718096] font-mono text-xs uppercase tracking-wider">
                      <tr>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Asset</th>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Type</th>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Entry</th>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Target</th>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Stop Loss</th>
                        <th className="px-6 py-4 font-medium border-b border-[#00f2ff]/10">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#00f2ff]/5">
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-[#718096] font-mono uppercase">
                            Loading signals...
                          </td>
                        </tr>
                      ) : signals.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-[#718096] flex flex-col items-center gap-3 justify-center font-mono">
                            <Search className="w-8 h-8 opacity-50" />
                            No signals generated yet. The bot checks markets every hour.
                          </td>
                        </tr>
                      ) : (
                        signals.map((sig) => (
                          <tr key={sig.id} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <span className="font-bold font-mono text-white text-base">{sig.pair}</span>
                                <span className="text-[0.65rem] px-2 py-1 rounded border border-[#00f2ff]/20 bg-[rgba(20,24,33,0.8)] text-[#718096] uppercase font-mono">TF: {sig.timeframe}</span>
                                {sig.is_aggressive && (
                                  <span className="text-[0.6rem] px-2 py-0.5 rounded border border-[#ffb800]/40 bg-[#ffb800]/10 text-[#ffb800] uppercase font-mono tracking-tighter">Aggressive</span>
                                )}
                              </div>
                              <div className="text-[0.75rem] text-[#ffb800] mt-2 max-w-[250px] truncate border-l-2 border-[#ffb800] pl-2 bg-[#ffb800]/10 py-1" title={sig.note}>
                                {sig.note}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 flex items-center justify-center w-min rounded text-[0.65rem] font-bold uppercase tracking-wider font-mono border",
                                sig.type === 'long' ? "bg-[#00ff8c]/10 text-[#00ff8c] border-[#00ff8c]/30" : "bg-[#ff2b56]/10 text-[#ff2b56] border-[#ff2b56]/30"
                              )}>
                                {sig.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-mono font-bold text-white">
                              {sig.entry}
                            </td>
                            <td className="px-6 py-4 font-mono font-bold text-[#00ff8c]">
                              {sig.targets.join(', ')}
                            </td>
                            <td className="px-6 py-4 font-mono font-bold text-[#ff2b56]">
                              {sig.stop_loss}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                {getStatusIcon(sig.status)}
                                <span className={cn(
                                  "font-mono text-xs font-bold uppercase tracking-wider",
                                  sig.status === 'OPEN' && 'text-[#00f2ff]',
                                  sig.status === 'TARGET_HIT' && 'text-[#00ff8c]',
                                  sig.status === 'STOP_HIT' && 'text-[#ff2b56]',
                                  sig.status === 'CLOSED' && 'text-[#718096]'
                                )}>{getStatusText(sig.status)}</span>
                              </div>
                              <div className="text-[0.65rem] text-[#718096] font-mono mt-2 uppercase tracking-tighter">
                                {(() => {
                                  const dateStr = sig.created_at.includes(' ') ? sig.created_at.replace(' ', 'T') + 'Z' : sig.created_at;
                                  return new Date(dateStr).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  });
                                })()}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in">
            <div className="bg-[rgba(20,24,33,0.7)] border border-[#00f2ff]/15 rounded p-6">
              <h2 className="text-[0.7rem] uppercase tracking-[0.15em] text-[#718096] border-l-2 border-[#00f2ff] pl-3 mb-6">Historical Backtester</h2>
              
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-[#718096]">Timeframe</label>
                  <select
                    value={btTimeframe}
                    onChange={(e) => setBtTimeframe(e.target.value)}
                    className="w-full bg-[#050608] border border-[#00f2ff]/20 rounded px-4 py-2 text-white font-mono uppercase focus:outline-none focus:border-[#00f2ff]/50"
                  >
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (btRunning || selectedStrategies.length === 0) return;
                      setBtRunning(true);
                      setBtResults(null);
                      await runBacktest(['AUTO'], btTimeframe, selectedStrategies);
                    }}
                    className={cn("px-6 py-2 h-[42px] bg-[#ff2b56]/10 border border-[#ff2b56]/30 hover:bg-[#ff2b56]/20 rounded flex items-center gap-2 transition-colors uppercase tracking-widest font-mono text-sm text-[#ff2b56]", btRunning && "opacity-50 cursor-not-allowed")}
                  >
                    <Search className={cn("w-4 h-4", btRunning && "animate-spin")} />
                    {btRunning ? 'Running...' : 'Auto Scan Market'}
                  </button>
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  <span className="text-xs font-mono uppercase text-[#718096]">Strategies</span>
                  <div className="flex gap-4">
                    {['conservative', 'aggressive'].map(s => (
                      <label key={s} className="text-xs font-mono uppercase text-[#e0e6ed] flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedStrategies.includes(s)} onChange={(e) => {
                          if (e.target.checked) setSelectedStrategies([...selectedStrategies, s]);
                          else setSelectedStrategies(selectedStrategies.filter(i => i !== s));
                        }} className="accent-[#00f2ff]"/>
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <input
                    type="checkbox"
                    checked={isContinuousLoop}
                    onChange={(e) => setIsContinuousLoop(e.target.checked)}
                    className="accent-[#00f2ff]"
                  />
                  <label className="text-xs font-mono uppercase text-[#718096]">Continuous Loop</label>
                </div>
              </div>
            </div>

            {btResults && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4">
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {btResults.aggregated.map((agg: any) => (
                    <div key={agg.name} className="p-4 bg-[#050608] border border-[#00f2ff]/20 rounded">
                      <div className="text-xs font-mono text-[#00f2ff] uppercase">{agg.name}</div>
                      <div className="text-xl font-bold text-white">{agg.winRate}</div>
                    </div>
                  ))}
                </div>
                {btResults.results.map((pairResult: any, pIdx: number) => (
                  <div key={pIdx} className="bg-[rgba(20,24,33,0.5)] border border-[#00f2ff]/10 rounded p-6">
                      <h3 className="text-sm font-bold text-white mb-4">{pairResult.p} Comparison</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pairResult.result.map((sRes: any, sIdx: number) => (
                          <div key={sIdx} className="p-4 rounded bg-[rgba(20,24,33,0.7)] border border-white/5">
                            <span className="text-xs font-bold text-[#00f2ff] uppercase">{sRes.strategyName}</span>
                            <div className="grid grid-cols-2 gap-2 mt-2 text-xs font-mono">
                                <div>Winrate: <span className="text-white">{sRes.winRate}</span></div>
                                <div>AvgRR: <span className="text-white">{sRes.avgRr}</span></div>
                                <div>ProfitFactor: <span className="text-white">{sRes.profitFactor}</span></div>
                                <div>Trades: <span className="text-white">{sRes.totalTrades}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

