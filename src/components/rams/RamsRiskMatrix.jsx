import React from 'react';
import { getRiskLevel } from '../../utils/ramsBuilder.js';

const LIKELIHOOD_LABELS = ['', 'Very Unlikely', 'Unlikely', 'Possible', 'Likely', 'Very Likely'];
const CONSEQUENCE_LABELS = ['', 'Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

export default function RamsRiskMatrix() {
  return (
    <div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="p-1 border border-gray-300 bg-gray-100 text-gray-600 text-[10px]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              L \ C
            </th>
            {[1,2,3,4,5].map(c => (
              <th key={c} className="p-1 border border-gray-300 bg-gray-100 text-gray-600 text-[10px] text-center" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                {c}<br /><span className="font-normal">{CONSEQUENCE_LABELS[c]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[5,4,3,2,1].map(l => (
            <tr key={l}>
              <td className="p-1 border border-gray-300 bg-gray-100 text-gray-600 text-[10px] font-bold text-center" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                {l}<br /><span className="font-normal">{LIKELIHOOD_LABELS[l]}</span>
              </td>
              {[1,2,3,4,5].map(c => {
                const rating = l * c;
                const level = getRiskLevel(rating);
                return (
                  <td
                    key={c}
                    className="p-1 border border-gray-300 text-center font-mono font-bold text-white text-xs"
                    style={{ backgroundColor: level.color }}
                  >
                    {rating}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 text-[10px]">
        {[
          { label: 'Low (1-6)', color: '#4ade80' },
          { label: 'Medium (7-12)', color: '#fbbf24' },
          { label: 'High (13-19)', color: '#fb923c' },
          { label: 'Extreme (20-25)', color: '#f87171' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: l.color }} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
