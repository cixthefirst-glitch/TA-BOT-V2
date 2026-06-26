import React from 'react';

interface PatternVisualizerProps {
  pattern?: string;
  marketStructure?: string;
}

export const PatternVisualizer: React.FC<PatternVisualizerProps> = ({ pattern, marketStructure }) => {
  if (!pattern && !marketStructure) return null;

  return (
    <div className="bg-[#050608] border border-[#00f2ff]/20 p-4 rounded-lg space-y-3">
      <h3 className="text-sm font-mono uppercase tracking-widest text-[#00f2ff]">Pattern Insights</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pattern && (
          <div>
            <label className="text-xs font-mono text-[#718096]">Identified Pattern</label>
            <div className="text-white font-mono">{pattern}</div>
          </div>
        )}
        {marketStructure && (
          <div>
            <label className="text-xs font-mono text-[#718096]">Market Structure</label>
            <div className="text-white font-mono">{marketStructure}</div>
          </div>
        )}
      </div>
      
      {/* Visual placeholder for pattern */}
      <div className="h-24 bg-black/50 border border-white/5 rounded flex items-center justify-center text-xs text-[#718096] italic">
        Visual representation of {pattern || 'structure'} would appear here.
      </div>
    </div>
  );
};
