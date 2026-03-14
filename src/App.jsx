import React, { useReducer, useState, useEffect } from 'react';
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
import { getSavedQuote } from './utils/savedQuotesDB.js';

function getStoredTheme() {
  try { return localStorage.getItem('tq_theme') || 'light'; } catch { return 'light'; }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, getInitialState);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme);
  const [currentView, setCurrentView] = useState('editor');
  const [viewingQuote, setViewingQuote] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('tq_theme', theme); } catch {}
  }, [theme]);

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

  const renderContent = () => {
    if (currentView === 'saved') {
      if (viewingQuote) {
        return (
          <SavedQuoteViewer
            quote={viewingQuote}
            onBack={() => setViewingQuote(null)}
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
        return <JobDetails state={state} dispatch={dispatch} />;
      case 3:
        return <AIAnalysis state={state} dispatch={dispatch} />;
      case 4:
        return <ReviewEdit state={state} dispatch={dispatch} />;
      case 5:
        return <QuoteOutput state={state} dispatch={dispatch} />;
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
    </div>
  );
}
