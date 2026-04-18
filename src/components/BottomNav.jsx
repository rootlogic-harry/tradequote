import React from 'react';

export default function BottomNav({
  currentView,
  onGoToDashboard,
  onStartNewQuote,
  onGoToSaved,
  onSettingsClick,
  isAdminPlan = false,
  className = '',
}) {
  const items = [
    { key: 'dashboard', label: 'Home', icon: HomeIcon, action: onGoToDashboard },
    { key: 'new', label: 'New', icon: PlusIcon, action: onStartNewQuote },
    { key: 'saved', label: 'Quotes', icon: FolderIcon, action: onGoToSaved },
    { key: 'profile', label: 'Profile', icon: UserIcon, action: onSettingsClick },
  ];

  const isActive = (key) =>
    (key === 'dashboard' && currentView === 'dashboard') ||
    (key === 'saved' && currentView === 'saved') ||
    (key === 'new' && currentView === 'editor');

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 ${className}`}
      style={{
        height: 64,
        backgroundColor: 'var(--tq-nav-bg)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center justify-around h-full px-2">
        {items.map(({ key, label, icon: Icon, action }) => {
          const active = isActive(key);
          return (
            <button
              key={key}
              onClick={action}
              className="flex flex-col items-center justify-center gap-1 flex-1 h-full"
              style={{ color: active ? 'var(--tq-accent)' : 'var(--tq-nav-muted)' }}
            >
              <Icon size={20} />
              <span className="text-[10px]" style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, letterSpacing: '0.03em' }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function HomeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function PlusIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function FolderIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function UserIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
