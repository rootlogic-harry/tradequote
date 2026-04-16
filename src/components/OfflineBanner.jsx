import React, { useState, useEffect } from 'react';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => {
      setIsOffline(true);
      setWasOffline(true);
    };
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Show "back online" confirmation briefly after reconnecting
  useEffect(() => {
    if (!isOffline && wasOffline) {
      const timer = setTimeout(() => setWasOffline(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isOffline, wasOffline]);

  if (!isOffline && !wasOffline) return null;

  if (!isOffline && wasOffline) {
    return (
      <div
        className="rounded-lg px-4 py-3 mb-4 flex items-center gap-3 text-sm"
        style={{
          backgroundColor: 'rgba(74, 222, 128, 0.1)',
          border: '1px solid rgba(74, 222, 128, 0.3)',
          color: '#4ade80',
        }}
      >
        <span>Back online. You can save your work now.</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg px-4 py-3 mb-4 flex items-center gap-3 text-sm"
      style={{
        backgroundColor: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid rgba(251, 191, 36, 0.3)',
        color: '#fbbf24',
      }}
    >
      <span>No signal. You can keep working, but saving and loading jobs needs an internet connection.</span>
    </div>
  );
}
