import React from 'react';
import { STEPS } from '../constants.js';

export default function StepIndicator({
  currentStep,
  dispatch,
  currentView,
  quoteMode,
  isAdminPlan = false,
  // Accept but ignore legacy props so existing call sites don't break
  onSettingsClick,
  theme,
  toggleTheme,
  onViewChange,
  onBackToQuote,
  currentUser,
  allUsers,
  onSwitchUser,
  onGoToDashboard,
  onStartNewQuote,
  onGoToSaved,
  onGoToLearning,
  onGoToAgents,
  onLogout,
}) {
  const isEditor = currentView === 'editor';
  const isRams = currentView === 'rams';
  const showSteps = isEditor && currentStep > 1;
  const currentStepData = showSteps ? STEPS.find(s => s.number === currentStep) : null;

  // Don't render anything if not in editor or RAMS
  if (!showSteps && !isRams) return null;

  return (
    <div className="sticky top-0 z-30">
      {/* Step progress bar (editor only, step > 1) */}
      {showSteps && currentStepData && (
        <div
          style={{ backgroundColor: 'var(--tq-surface)', borderBottom: '1px solid var(--tq-border)' }}
        >
          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2">
          {STEPS.map((step) => {
            const isCompleted = step.number < currentStep;
            const isCurrent = step.number === currentStep;
            const canNavigate = isCompleted && step.number !== 3;
            return (
              <div key={step.number} className="flex items-center">
                <div
                  onClick={canNavigate ? () => dispatch({ type: 'SET_STEP', step: step.number }) : undefined}
                  className={`flex items-center justify-center rounded-full font-mono${canNavigate ? ' cursor-pointer hover:ring-1 hover:ring-tq-accent' : ''}`}
                  style={{
                    width: 20,
                    height: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                    ...(isCurrent
                      ? { backgroundColor: 'var(--tq-accent)', color: '#ffffff' }
                      : isCompleted
                        ? { backgroundColor: 'transparent', color: '#6dbf8a' }
                        : { backgroundColor: 'transparent', border: '1.5px solid var(--tq-border)', color: 'var(--tq-muted)' }
                    ),
                  }}
                  title={canNavigate ? `Go back to ${step.label}` : undefined}
                >
                  {isCompleted ? '\u2713' : step.number}
                </div>
                <span
                  onClick={canNavigate ? () => dispatch({ type: 'SET_STEP', step: step.number }) : undefined}
                  className={`hidden fq:inline ml-1.5 text-xs${canNavigate ? ' cursor-pointer hover:text-tq-accent' : ''}`}
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    color: isCurrent ? 'var(--tq-text)' : 'var(--tq-muted)',
                    fontWeight: isCurrent ? 500 : 400,
                  }}
                >
                  {step.label}
                </span>
                {step.number < STEPS.length && (
                  <div
                    className="mx-1.5"
                    style={{ width: 16, height: 1, backgroundColor: 'var(--tq-border)' }}
                  />
                )}
              </div>
            );
          })}
          {quoteMode === 'quick' && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ml-2"
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
            className="text-xs ml-auto fq:hidden truncate"
            style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'var(--tq-text)' }}
          >
            Step {currentStepData.number}: {currentStepData.label}
          </span>
          </div>
        </div>
      )}

      {/* RAMS breadcrumb */}
      {isRams && (
        <div
          style={{ backgroundColor: 'var(--tq-surface)', borderBottom: '1px solid var(--tq-border)' }}
        >
          <div className="max-w-5xl mx-auto px-4 py-2">
          <span
            className="text-xs uppercase tracking-wide"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-accent)' }}
          >
            RAMS
          </span>
          </div>
        </div>
      )}
    </div>
  );
}
