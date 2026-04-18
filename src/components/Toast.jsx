import React, { useEffect } from 'react';

const TYPE_STYLES = {
  success: 'bg-tq-confirmed/15 border-tq-confirmed/40 text-tq-confirmed',
  error: 'bg-tq-error/15 border-tq-error/40 text-tq-error',
  info: 'bg-tq-accent/15 border-tq-accent/40 text-tq-accent',
};

// Error toasts stay longer so Mark can read them on-site
const DURATION = { success: 3000, info: 3000, error: 6000 };

export default function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DURATION[type] || 3000);
    return () => clearTimeout(timer);
  }, [message, type, onDismiss]);

  if (!message) return null;

  return (
    <div className={`fixed bottom-6 left-4 right-4 fq:left-auto fq:right-6 z-50 border px-4 py-3 shadow-lg max-w-sm text-sm font-body animate-[slideUp_0.3s_ease-out] flex items-center justify-between gap-2 ${TYPE_STYLES[type] || TYPE_STYLES.info}`}>
      <span>{message}</span>
      {type === 'error' && (
        <button onClick={onDismiss} className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}
