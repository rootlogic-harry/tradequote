import React, { useEffect } from 'react';

const TYPE_STYLES = {
  success: 'bg-tq-confirmed/15 border-tq-confirmed/40 text-tq-confirmed',
  error: 'bg-tq-error/15 border-tq-error/40 text-tq-error',
  info: 'bg-tq-accent/15 border-tq-accent/40 text-tq-accent',
};

export default function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [message, type, onDismiss]);

  if (!message) return null;

  return (
    <div className={`fixed bottom-6 right-6 z-50 border rounded-lg px-4 py-3 shadow-lg max-w-sm text-sm font-body animate-[slideUp_0.3s_ease-out] ${TYPE_STYLES[type] || TYPE_STYLES.info}`}>
      {message}
    </div>
  );
}
