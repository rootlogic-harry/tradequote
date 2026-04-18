import React from 'react';

export default function Sidebar({
  currentView,
  onNavigate,
  onStartNewQuote,
  onGoToDashboard,
  onGoToSaved,
  onGoToLearning,
  onGoToAgents,
  theme,
  toggleTheme,
  currentUser,
  onSettingsClick,
  onLogout,
  isAdminPlan = false,
  className = '',
}) {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon, action: onGoToDashboard },
    { key: 'new', label: 'New Quote', icon: PlusIcon, action: onStartNewQuote },
    { key: 'saved', label: 'My Quotes', icon: FolderIcon, action: onGoToSaved },
    ...(isAdminPlan && onGoToLearning ? [{ key: 'learning', label: 'Learning', icon: ChartIcon, action: onGoToLearning }] : []),
    ...(isAdminPlan && onGoToAgents ? [{ key: 'agents', label: 'Agents', icon: CpuIcon, action: onGoToAgents }] : []),
  ];

  const isActive = (key) =>
    (key === 'dashboard' && currentView === 'dashboard') ||
    (key === 'saved' && currentView === 'saved') ||
    (key === 'new' && currentView === 'editor') ||
    (key === 'learning' && currentView === 'learning') ||
    (key === 'agents' && currentView === 'agents');

  return (
    <aside
      className={`w-60 flex-shrink-0 flex flex-col h-screen sticky top-0 ${className}`}
      style={{ backgroundColor: 'var(--tq-rail-bg)' }}
    >
      {/* Brand lockup */}
      <div className="px-5 pt-6 pb-4">
        <span
          className="cursor-pointer"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: '0.05em',
            color: 'var(--tq-accent)',
          }}
          onClick={onGoToDashboard}
        >
          FASTQUOTE
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map(({ key, label, icon: Icon, action }) => {
          const active = isActive(key);
          return (
            <button
              key={key}
              onClick={action}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-left transition-colors"
              style={{
                backgroundColor: active ? 'var(--tq-nav-active)' : 'transparent',
                color: active ? 'var(--tq-nav-text)' : 'var(--tq-nav-muted)',
              }}
            >
              <Icon size={18} />
              <span
                className="text-sm"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Bottom section: theme toggle + user */}
      <div className="px-3 pb-4 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="pt-3 flex items-center justify-between">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded transition-colors"
            style={{ color: 'var(--tq-nav-muted)' }}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <MoonIcon size={16} /> : <SunIcon size={16} />}
          </button>
          {onSettingsClick && (
            <button
              onClick={onSettingsClick}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors"
              style={{ color: 'var(--tq-nav-muted)' }}
              title="Settings"
            >
              <GearIcon size={16} />
            </button>
          )}
        </div>
        {currentUser && (
          <div className="flex items-center gap-2 px-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
              style={{ backgroundColor: 'var(--tq-nav-active)', color: 'var(--tq-nav-text)' }}
            >
              {(currentUser.name || currentUser.email || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate" style={{ color: 'var(--tq-nav-text)' }}>
                {currentUser.name || currentUser.email}
              </div>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-xs transition-colors flex-shrink-0"
                style={{ color: 'var(--tq-nav-muted)' }}
                title="Log out"
              >
                <LogoutIcon size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ── Inline SVG icons ── */
function DashboardIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
function PlusIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function FolderIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function ChartIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
function CpuIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}
function MoonIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function SunIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function GearIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function LogoutIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
