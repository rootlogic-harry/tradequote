import React, { useState, useRef, useEffect } from 'react';

export default function UserSwitcher({ currentUser, allUsers, onSwitchUser }) {
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

  const otherUsers = allUsers.filter(u => u.id !== currentUser.id);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 transition-colors text-sm font-heading"
        style={{ color: 'var(--tq-nav-muted)' }}
      >
        <span
          className="rounded-full flex items-center justify-center font-bold"
          style={{ width: 28, height: 28, fontSize: 12, backgroundColor: 'var(--tq-accent)', color: 'var(--tq-nav-bg)' }}
        >
          {currentUser.name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--tq-nav-text)', fontSize: 13 }}>{currentUser.name}</span>
        <span className="text-xs" style={{ color: 'var(--tq-nav-muted)' }}>{open ? '\u25B2' : '\u25BE'}</span>
      </button>

      {open && otherUsers.length > 0 && (
        <div className="absolute right-0 top-full mt-1 bg-tq-surface border border-tq-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
          {otherUsers.map(user => (
            <button
              key={user.id}
              onClick={() => { onSwitchUser(user.id); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-sm text-tq-text hover:bg-tq-card flex items-center gap-2 font-heading"
            >
              <span className="w-5 h-5 rounded-full bg-tq-accent/20 text-tq-accent flex items-center justify-center text-[10px] font-bold">
                {user.name.charAt(0).toUpperCase()}
              </span>
              {user.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
