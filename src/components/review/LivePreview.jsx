import React from 'react';
import QuoteDocument from '../QuoteDocument.jsx';

export default function LivePreview({ state }) {
  return (
    <div className="mt-8">
      <h3 className="text-lg font-heading font-bold text-tq-text mb-3">
        Live Preview
      </h3>
      <div className="bg-white rounded-lg shadow-lg max-h-[600px] overflow-y-auto">
        <QuoteDocument state={state} />
      </div>
    </div>
  );
}
