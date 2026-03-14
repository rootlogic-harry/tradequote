import React, { useReducer, useState, useEffect, useRef, useCallback } from 'react';
import { reducer, getInitialState } from './reducer.js';
import { STEPS } from './constants.js';
import StepIndicator from './components/StepIndicator.jsx';
import ProfileSetup from './components/steps/ProfileSetup.jsx';
import JobDetails from './components/steps/JobDetails.jsx';
import AIAnalysis from './components/steps/AIAnalysis.jsx';
import ReviewEdit from './components/steps/ReviewEdit.jsx';
import QuoteOutput from './components/steps/QuoteOutput.jsx';
import SavedQuotes from './components/SavedQuotes.jsx';
import SavedQuoteViewer from './components/SavedQuoteViewer.jsx';
import Toast from './components/Toast.jsx';
import { getSavedQuote, saveDraft, loadDraft, clearDraft } from './utils/savedQuotesDB.js';

function getStoredTheme() {
  try { return localStorage.getItem('tq_theme') || 'light'; } catch { return 'light'; }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, getInitialState);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme);
  const [currentView, setCurrentView] = useState('editor');
  const [viewingQuote, setViewingQuote] = useState(null);

  // WS6: Toast state
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  // WS4: Abort ref for AI call
  const abortRef = useRef(null);
  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // WS5: Draft resume modal
  const [draftPrompt, setDraftPrompt] = useState(null);
  const draftChecked = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('tq_theme', theme); } catch {}
  }, [theme]);

  // WS5: Check for draft on mount
  useEffect(() => {
    if (draftChecked.current) return;
    draftChecked.current = true;
    if (state.step !== 1) return;
    loadDraft().then(draft => {
      if (draft?.jobDetails?.clientName) {
        setDraftPrompt(draft);
      }
    }).catch(() => {});
  }, []);

  // WS5: Auto-save draft (debounced 5s, steps 2-4 only)
  useEffect(() => {
    if (state.step < 2 || state.step > 4) {
      // Clear draft on step 1 or 5
      clearDraft().catch(() => {});
      return;
    }
    const timer = setTimeout(() => {
      saveDraft(state).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [state]);

  const handleResumeDraft = () => {
    dispatch({ type: 'RESTORE_DRAFT', draft: draftPrompt });
    setDraftPrompt(null);
    showToast('Draft restored', 'success');
  };

  const handleDiscardDraft = () => {
    clearDraft().catch(() => {});
    setDraftPrompt(null);
    showToast('Draft discarded', 'info');
  };

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const handleViewChange = (view) => {
    setCurrentView(view);
    if (view === 'editor') setViewingQuote(null);
  };

  const handleViewQuote = async (quoteSummary) => {
    try {
      const full = await getSavedQuote(quoteSummary.id);
      setViewingQuote(full);
    } catch (err) {
      console.error('Failed to load quote:', err);
    }
  };

  const handleEditQuote = (virtualState) => {
    dispatch({ type: 'RESTORE_DRAFT', draft: { ...virtualState, step: 4 } });
    setViewingQuote(null);
    setCurrentView('editor');
    showToast('Quote loaded for editing', 'success');
  };

  const renderContent = () => {
    if (currentView === 'saved') {
      if (viewingQuote) {
        return (
          <SavedQuoteViewer
            quote={viewingQuote}
            onBack={() => setViewingQuote(null)}
            onEditQuote={handleEditQuote}
          />
        );
      }
      return <SavedQuotes onViewQuote={handleViewQuote} />;
    }
    return renderStep();
  };

  const renderStep = () => {
    switch (state.step) {
      case 1:
        return <ProfileSetup state={state} dispatch={dispatch} />;
      case 2:
        return <JobDetails state={state} dispatch={dispatch} abortRef={abortRef} />;
      case 3:
        return <AIAnalysis state={state} dispatch={dispatch} cancelAnalysis={cancelAnalysis} />;
      case 4:
        return <ReviewEdit state={state} dispatch={dispatch} />;
      case 5:
        return <QuoteOutput state={state} dispatch={dispatch} showToast={showToast} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-tq-bg text-tq-text font-body">
      <StepIndicator
        currentStep={state.step}
        dispatch={dispatch}
        onSettingsClick={() => setShowProfileModal(true)}
        theme={theme}
        toggleTheme={toggleTheme}
        currentView={currentView}
        onViewChange={handleViewChange}
      />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {renderContent()}
      </div>

      {/* Profile modal */}
      {showProfileModal && state.step > 1 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-tq-surface rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 border border-tq-border">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-heading font-bold text-tq-accent">Edit Profile</h2>
              <button
                onClick={() => setShowProfileModal(false)}
                className="text-tq-muted hover:text-tq-text text-2xl"
              >
                &times;
              </button>
            </div>
            <ProfileSetup
              state={state}
              dispatch={dispatch}
              isModal
              onClose={() => setShowProfileModal(false)}
            />
          </div>
        </div>
      )}

      {/* WS5: Draft resume modal */}
      {draftPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-tq-surface rounded-lg max-w-md w-full p-6 border border-tq-border">
            <h2 className="text-lg font-heading font-bold text-tq-accent mb-3">
              Resume Draft?
            </h2>
            <p className="text-tq-text text-sm mb-6">
              Resume your in-progress quote for <strong>{draftPrompt.jobDetails.clientName}</strong>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDiscardDraft}
                className="px-5 py-2 rounded border border-tq-border text-tq-text font-heading uppercase text-sm hover:bg-tq-card"
              >
                Discard
              </button>
              <button
                onClick={handleResumeDraft}
                className="px-5 py-2 rounded bg-tq-accent text-tq-bg font-heading uppercase text-sm font-bold hover:bg-tq-accent-dark"
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WS6: Toast */}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
