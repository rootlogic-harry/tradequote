import React, { useState, useRef, useEffect } from 'react';

export default function UserSwitcher({ currentUser, allUsers, onSwitchUser, onSettingsClick, onLogout, showSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!currentUser) return null;

  const otherUsers = (allUsers || []).filter(u => u.id !== currentUser.id);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 transition-colors text-sm font-heading px-2 py-1.5 rounded-lg"
        style={{ color: 'var(--tq-nav-muted)', backgroundColor: open ? 'var(--tq-nav-active)' : 'transparent' }}
      >
        <span
          className="rounded-full flex items-center justify-center font-bold shrink-0"
          style={{ width: 28, height: 28, fontSize: 12, backgroundColor: 'var(--tq-accent)', color: 'var(--tq-nav-bg)' }}
        >
          {(currentUser.name || '').charAt(0).toUpperCase()}
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--tq-nav-text)', fontSize: 13 }}>{currentUser.name}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ color: 'var(--tq-nav-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 border rounded-lg shadow-lg py-1.5 min-w-[180px] z-50" style={{ backgroundColor: 'var(--tq-surface)', borderColor: 'var(--tq-border)' }}>
          {/* Current user header */}
          <div className="px-3.5 py-2 border-b" style={{ borderColor: 'var(--tq-border)' }}>
            <p className="font-heading font-bold text-sm" style={{ color: 'var(--tq-text)' }}>{currentUser.name}</p>
            {currentUser.email && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--tq-muted)' }}>{currentUser.email}</p>
            )}
          </div>

          {/* Other users */}
          {otherUsers.length > 0 && (
            <div className="py-1 border-b" style={{ borderColor: 'var(--tq-border)' }}>
              <p className="px-3.5 py-1 text-[10px] uppercase tracking-wider font-heading" style={{ color: 'var(--tq-muted)' }}>Switch account</p>
              {otherUsers.map(user => (
                <button
                  key={user.id}
                  onClick={() => { onSwitchUser(user.id); setOpen(false); }}
                  className="w-full px-3.5 py-2 text-left text-sm hover:bg-tq-card flex items-center gap-2.5 font-heading transition-colors"
                  style={{ color: 'var(--tq-text)' }}
                >
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: 'var(--tq-accent)', opacity: 0.3, color: 'var(--tq-nav-bg)' }}>
                    {(user.name || '').charAt(0).toUpperCase()}
                  </span>
                  {user.name}
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="py-1">
            {showSettings && onSettingsClick && (
              <button
                onClick={() => { onSettingsClick(); setOpen(false); }}
                className="w-full px-3.5 py-2 text-left text-sm flex items-center gap-2.5 font-heading transition-colors"
                style={{ color: 'var(--tq-text)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--tq-card)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Edit Profile
              </button>
            )}
            {onLogout && (
              <button
                onClick={() => { onLogout(); setOpen(false); }}
                className="w-full px-3.5 py-2 text-left text-sm flex items-center gap-2.5 font-heading transition-colors"
                style={{ color: 'var(--tq-text)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--tq-card)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
