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
  showStepper = true,
  onToggleSidebar,
}) {
  return (
    <div className="bg-tq-surface border-b border-tq-border sticky top-0 z-40">
      <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Hamburger for mobile sidebar */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="md:hidden text-tq-muted hover:text-tq-accent text-xl transition-colors"
              title="Toggle navigation"
            >
              &#9776;
            </button>
          )}
          <h1 className="text-xl font-heading font-bold text-tq-accent tracking-wide">
            TRADEQUOTE
          </h1>
          <span className="text-xs text-tq-muted font-mono">v0.1.1</span>
        </div>

        {/* RAMS breadcrumb, step circles, or nothing (dashboard) */}
        {!showStepper ? (
          <div />
        ) : currentView === 'rams' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onBackToQuote}
              className="text-tq-muted hover:text-tq-accent text-xs font-heading uppercase tracking-wide"
            >
              TRADEQUOTE
            </button>
            <span className="text-tq-muted text-xs">&rsaquo;</span>
            <span className="text-tq-accent text-xs font-heading font-bold uppercase tracking-wide">
              RAMS
            </span>
          </div>
        ) : (
          <div className={`flex items-center gap-1 sm:gap-2 ${currentView === 'saved' ? 'opacity-40' : ''}`}>
            {STEPS.map((step) => {
              const isCompleted = step.number < currentStep;
              const isCurrent = step.number === currentStep;
              return (
                <div key={step.number} className="flex items-center">
                  <div
                    className={`
                      w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-medium
                      ${isCurrent
                        ? 'bg-tq-accent text-tq-bg'
                        : isCompleted
                          ? 'bg-tq-confirmed/20 text-tq-confirmed'
                          : 'bg-tq-card text-tq-muted border border-tq-border'
                      }
                    `}
                  >
                    {isCompleted ? '\u2713' : step.number}
                  </div>
                  <span
                    className={`hidden sm:inline ml-1.5 text-xs font-body ${
                      isCurrent ? 'text-tq-text' : 'text-tq-muted'
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.number < STEPS.length && (
                    <div className="w-4 sm:w-8 h-px bg-tq-border mx-1" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          {currentUser && (
            <UserSwitcher
              currentUser={currentUser}
              allUsers={allUsers}
              onSwitchUser={onSwitchUser}
            />
          )}
          <button
            onClick={toggleTheme}
            className="text-tq-muted hover:text-tq-accent transition-colors text-lg"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? '\uD83C\uDF19' : '\u2600\uFE0F'}
          </button>
          {currentStep > 1 && (
            <button
              onClick={onSettingsClick}
              className="text-tq-muted hover:text-tq-accent transition-colors text-lg"
              title="Edit Profile"
            >
              {'\u2699'}
            </button>
          )}
          {currentStep === 1 && <div className="w-8" />}
        </div>
      </div>
    </div>
  );
}
