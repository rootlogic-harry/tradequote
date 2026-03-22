import React, { useState, useEffect, useRef } from 'react';
import { STEPS } from '../constants.js';
import UserSwitcher from './UserSwitcher.jsx';

export default function StepIndicator({
  currentStep,
  dispatch,
  onSettingsClick,
  theme,
  toggleTheme,
  currentView,
  onViewChange,
  onBackToQuote,
  currentUser,
  allUsers,
  onSwitchUser,
  onGoToDashboard,
  onStartNewQuote,
  onGoToSaved,
  quoteMode,
}) {
  const isEditor = currentView === 'editor';
  const isRams = currentView === 'rams';
  const showSteps = isEditor && currentStep > 1;

  // Mobile hamburger menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mobileMenuOpen]);

  const mobileNavItems = [
    { key: 'dashboard', label: 'Dashboard', action: onGoToDashboard },
    { key: 'new', label: 'New Quote', action: onStartNewQuote },
    { key: 'saved', label: 'Saved Jobs', action: onGoToSaved },
  ];

  const currentStepData = showSteps ? STEPS.find(s => s.number === currentStep) : null;

  return (
    <div className="sticky top-0 z-40">
      {/* Main nav bar */}
      <div
        style={{ backgroundColor: 'var(--tq-nav-bg)', height: 52, minHeight: 52 }}
      >
        <div className="h-full max-w-full mx-auto px-4 flex items-center">
          {/* Mobile: hamburger button */}
          <div className="sm:hidden relative" ref={menuRef}>
            <button
              onClick={() => setMobileMenuOpen(prev => !prev)}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors mr-2"
              style={{ color: 'var(--tq-nav-muted)' }}
              aria-label="Navigation menu"
            >
              {mobileMenuOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="16" y2="16" />
                  <line x1="16" y1="4" x2="4" y2="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="5" x2="17" y2="5" />
                  <line x1="3" y1="10" x2="17" y2="10" />
                  <line x1="3" y1="15" x2="17" y2="15" />
                </svg>
              )}
            </button>

            {/* Mobile dropdown menu */}
            {mobileMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1 rounded-lg shadow-lg py-1 min-w-[180px]"
                style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)' }}
              >
                {mobileNavItems.map(({ key, label, action }) => {
                  const isActive =
                    (key === 'dashboard' && currentView === 'dashboard') ||
                    (key === 'saved' && currentView === 'saved') ||
                    (key === 'new' && isEditor);
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        action();
                        setMobileMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={{
                        fontFamily: 'IBM Plex Sans, sans-serif',
                        fontWeight: isActive ? 600 : 400,
                        backgroundColor: isActive ? 'var(--tq-nav-active)' : 'transparent',
                        color: isActive ? 'var(--tq-accent)' : 'var(--tq-text)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Left: Brand — always links to dashboard */}
          <div className="flex items-center shrink-0">
            <span
              style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 22, letterSpacing: '0.05em', color: 'var(--tq-accent)', cursor: 'pointer' }}
              onClick={onGoToDashboard}
            >
              TRADEQUOTE
            </span>
          </div>

          {/* Nav links — always visible on desktop */}
          <div className="hidden sm:flex items-center gap-1 ml-8">
            {mobileNavItems.map(({ key, label, action }) => {
              const isActive =
                (key === 'dashboard' && currentView === 'dashboard') ||
                (key === 'saved' && currentView === 'saved') ||
                (key === 'new' && isEditor);
              return (
                <button
                  key={key}
                  onClick={action}
                  className="px-3 py-1.5 rounded text-xs transition-colors"
                  style={{
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    fontWeight: isActive ? 500 : 400,
                    backgroundColor: isActive ? 'var(--tq-nav-active)' : 'transparent',
                    color: isActive ? 'var(--tq-nav-text)' : 'var(--tq-nav-muted)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Centre: step breadcrumb or RAMS breadcrumb (when applicable) */}
          <div className="flex items-center gap-1 ml-4">
            {isRams ? (
              <div className="hidden sm:flex items-center gap-2">
                <span style={{ color: 'var(--tq-nav-muted)' }} className="text-xs">&rsaquo;</span>
                <span
                  className="text-xs uppercase tracking-wide"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-accent)' }}
                >
                  RAMS
                </span>
              </div>
            ) : showSteps ? (
              <div className="hidden md:flex items-center">
                <span style={{ color: 'var(--tq-nav-muted)', marginRight: 8 }} className="text-xs">&rsaquo;</span>
                {quoteMode === 'quick' && (
                  <span
                    className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded mr-2"
                    style={{
                      fontFamily: 'Barlow Condensed, sans-serif',
                      fontWeight: 700,
                      backgroundColor: 'var(--tq-accent)',
                      color: '#ffffff',
                    }}
                  >
                    QUICK
                  </span>
                )}
                {STEPS.map((step) => {
                  const isCompleted = step.number < currentStep;
                  const isCurrent = step.number === currentStep;
                  return (
                    <div key={step.number} className="flex items-center">
                      <div
                        className="flex items-center justify-center rounded-full font-mono"
                        style={{
                          width: 18,
                          height: 18,
                          fontSize: 10,
                          fontWeight: 600,
                          ...(isCurrent
                            ? { backgroundColor: 'var(--tq-accent)', color: 'var(--tq-nav-bg)' }
                            : isCompleted
                              ? { backgroundColor: 'transparent', color: '#6dbf8a' }
                              : { backgroundColor: 'transparent', border: '1.5px solid #3a3630', color: 'var(--tq-nav-muted)' }
                          ),
                        }}
                      >
                        {isCompleted ? '\u2713' : step.number}
                      </div>
                      <span
                        className="hidden lg:inline ml-1.5 text-xs"
                        style={{
                          fontFamily: 'IBM Plex Sans, sans-serif',
                          color: isCurrent ? 'var(--tq-nav-text)' : 'var(--tq-nav-muted)',
                          fontWeight: isCurrent ? 500 : 400,
                        }}
                      >
                        {step.label}
                      </span>
                      {step.number < STEPS.length && (
                        <div
                          className="mx-1.5"
                          style={{ width: 16, height: 1, backgroundColor: '#3a3630' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Vertical divider */}
          <div className="hidden sm:block mx-3" style={{ width: 1, height: 24, backgroundColor: 'var(--tq-border)' }} />

          {/* Right: user + theme + settings */}
          <div className="flex items-center gap-2 shrink-0">
            {currentUser && (
              <UserSwitcher
                currentUser={currentUser}
                allUsers={allUsers}
                onSwitchUser={onSwitchUser}
              />
            )}
            <button
              onClick={toggleTheme}
              className="transition-colors text-lg"
              style={{ color: 'var(--tq-nav-muted)' }}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? '\uD83C\uDF19' : '\u2600\uFE0F'}
            </button>
            {currentStep > 1 && (
              <button
                onClick={onSettingsClick}
                className="transition-colors text-lg"
                style={{ color: 'var(--tq-nav-muted)' }}
                title="Edit Profile"
              >
                {'\u2699'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: compact step indicator row */}
      {showSteps && currentStepData && (
        <div
          className="sm:hidden px-4 py-1.5 flex items-center gap-2"
          style={{ backgroundColor: 'var(--tq-surface)', borderBottom: '1px solid var(--tq-border)' }}
        >
          {STEPS.map((step) => {
            const isCompleted = step.number < currentStep;
            const isCurrent = step.number === currentStep;
            return (
              <div
                key={step.number}
                className="flex items-center justify-center rounded-full font-mono"
                style={{
                  width: 18,
                  height: 18,
                  fontSize: 10,
                  fontWeight: 600,
                  flexShrink: 0,
                  ...(isCurrent
                    ? { backgroundColor: 'var(--tq-accent)', color: 'var(--tq-nav-bg)' }
                    : isCompleted
                      ? { backgroundColor: 'transparent', color: '#6dbf8a' }
                      : { backgroundColor: 'transparent', border: '1.5px solid var(--tq-border)', color: 'var(--tq-muted)' }
                  ),
                }}
              >
                {isCompleted ? '\u2713' : step.number}
              </div>
            );
          })}
          {quoteMode === 'quick' && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700,
                backgroundColor: 'var(--tq-accent)',
                color: '#ffffff',
              }}
            >
              QUICK
            </span>
          )}
          <span
            className="text-xs ml-1 truncate"
            style={{ fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: 500, color: 'var(--tq-text)' }}
          >
            Step {currentStepData.number}: {currentStepData.label}
          </span>
        </div>
      )}

      {/* Mobile: RAMS breadcrumb row */}
      {isRams && (
        <div
          className="sm:hidden px-4 py-1.5"
          style={{ backgroundColor: 'var(--tq-surface)', borderBottom: '1px solid var(--tq-border)' }}
        >
          <span
            className="text-xs uppercase tracking-wide"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-accent)' }}
          >
            RAMS
          </span>
        </div>
      )}
    </div>
  );
}
