import React from 'react';
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
}) {
  const isEditor = currentView === 'editor';
  const isRams = currentView === 'rams';
  const showSteps = isEditor && currentStep > 1;

  return (
    <div
      className="sticky top-0 z-40"
      style={{ backgroundColor: 'var(--tq-nav-bg)', height: 52, minHeight: 52 }}
    >
      <div className="h-full max-w-full mx-auto px-4 flex items-center">
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
          {[
            { key: 'dashboard', label: 'Dashboard', action: onGoToDashboard },
            { key: 'new', label: 'New Quote', action: onStartNewQuote },
            { key: 'saved', label: 'Saved Jobs', action: onGoToSaved },
          ].map(({ key, label, action }) => {
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
  );
}
