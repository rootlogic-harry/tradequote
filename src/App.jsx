import React, { useReducer, useState, useEffect, useRef, useCallback } from 'react';
import { reducer, getInitialState, loadState } from './reducer.js';
import { STEPS } from './constants.js';
import StepIndicator from './components/StepIndicator.jsx';
import ProfileSetup from './components/steps/ProfileSetup.jsx';
import JobDetails from './components/steps/JobDetails.jsx';
import AIAnalysis from './components/steps/AIAnalysis.jsx';
import ReviewEdit from './components/steps/ReviewEdit.jsx';
import QuoteOutput from './components/steps/QuoteOutput.jsx';
import SavedQuotes from './components/SavedQuotes.jsx';
import SavedQuoteViewer from './components/SavedQuoteViewer.jsx';
import RamsEditor from './components/rams/RamsEditor.jsx';
import RamsOutput from './components/rams/RamsOutput.jsx';
import Toast from './components/Toast.jsx';
import UserSelector from './components/UserSelector.jsx';
import UserSwitcher from './components/UserSwitcher.jsx';
import { getJob, saveDraft, loadDraft, clearDraft, getProfile, saveProfile, getQuoteSequence, getTheme, setTheme as setThemeDB, migrateFromLegacyDB } from './utils/userDB.js';
import { bootstrapUsers, listUsers } from './utils/userRegistry.js';

function getStoredTheme(userId) {
  try {
    if (userId) return localStorage.getItem('tq_theme_' + userId) || 'light';
    return localStorage.getItem('tq_theme') || 'light';
  } catch { return 'light'; }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, getInitialState);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [theme, setTheme] = useState(() => getStoredTheme(null));
  const [currentView, setCurrentView] = useState('editor');
  const [viewingQuote, setViewingQuote] = useState(null);
  const [ramsSubView, setRamsSubView] = useState('edit');
  const [activeJobId, setActiveJobId] = useState(null);

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

  // --- Init flow: bootstrap users → list → INIT_COMPLETE ---
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      await bootstrapUsers();
      const users = await listUsers();
      dispatch({ type: 'INIT_COMPLETE', users });
    })();
  }, []);

  // --- After INIT_COMPLETE with auto-selected user, load their data ---
  const autoLoadDone = useRef(false);
  useEffect(() => {
    if (!state.initComplete || !state.currentUserId || autoLoadDone.current) return;
    autoLoadDone.current = true;
    loadUserData(state.currentUserId);
  }, [state.initComplete, state.currentUserId]);

  async function loadUserData(userId) {
    // Migrate legacy data on first selection (idempotent)
    try { await migrateFromLegacyDB(userId); } catch {}

    // Load profile from DB
    const profile = await getProfile(userId);
    const quoteSequence = await getQuoteSequence(userId);

    // Load session state
    const sessionState = loadState(userId);

    // Load theme
    const userTheme = await getTheme(userId);
    if (userTheme) setTheme(userTheme);
    else setTheme(getStoredTheme(userId));

    // Dispatch SELECT_USER with loaded data
    const user = state.allUsers.find(u => u.id === userId);
    dispatch({
      type: 'SELECT_USER',
      userId,
      name: user?.name || userId,
      profile: sessionState?.profile || profile,
      quoteSequence: sessionState?.quoteSequence || quoteSequence,
    });

    // If session state exists, restore it
    if (sessionState && sessionState.step > 1) {
      dispatch({ type: 'RESTORE_DRAFT', draft: sessionState });
    }

    // Store last user
    try { sessionStorage.setItem('tq_last_user', userId); } catch {}

    // Check for drafts
    if (!draftChecked.current) {
      draftChecked.current = true;
      try {
        const draft = await loadDraft(userId);
        if (draft?.jobDetails?.clientName && (!sessionState || sessionState.step <= 1)) {
          setDraftPrompt(draft);
        }
      } catch {}
    }
  }

  // --- User selection handler ---
  const handleSelectUser = useCallback(async (userId) => {
    autoLoadDone.current = true;
    draftChecked.current = false;
    await loadUserData(userId);
  }, [state.allUsers]);

  // --- User switch handler ---
  const handleSwitchUser = useCallback(async (userId) => {
    // Save current profile before switching
    if (state.currentUserId) {
      try { await saveProfile(state.currentUserId, state.profile); } catch {}
    }

    // Reset local view state
    setCurrentView('editor');
    setViewingQuote(null);
    setRamsSubView('edit');
    setActiveJobId(null);
    setDraftPrompt(null);
    draftChecked.current = false;

    // Load new user's data
    const profile = await getProfile(userId);
    const quoteSequence = await getQuoteSequence(userId);
    const userTheme = await getTheme(userId);
    if (userTheme) setTheme(userTheme);
    else setTheme(getStoredTheme(userId));

    const user = state.allUsers.find(u => u.id === userId);
    dispatch({
      type: 'SWITCH_USER',
      userId,
      name: user?.name || userId,
      profile,
      quoteSequence,
    });

    // Load session state for the new user
    const sessionState = loadState(userId);
    if (sessionState && sessionState.step > 1) {
      dispatch({ type: 'RESTORE_DRAFT', draft: sessionState });
    }

    try { sessionStorage.setItem('tq_last_user', userId); } catch {}

    // Check for drafts
    try {
      const draft = await loadDraft(userId);
      if (draft?.jobDetails?.clientName && (!sessionState || sessionState.step <= 1)) {
        setDraftPrompt(draft);
      }
    } catch {}

    showToast(`Switched to ${user?.name || userId}`, 'info');
  }, [state.currentUserId, state.profile, state.allUsers, showToast]);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (state.currentUserId) {
      try { localStorage.setItem('tq_theme_' + state.currentUserId, theme); } catch {}
      setThemeDB(state.currentUserId, theme).catch(() => {});
    }
  }, [theme, state.currentUserId]);

  // WS5: Auto-save draft (debounced 5s, steps 2-4 only)
  useEffect(() => {
    if (!state.currentUserId) return;
    if (state.step < 2 || state.step > 4) {
      clearDraft(state.currentUserId).catch(() => {});
      return;
    }
    const timer = setTimeout(() => {
      saveDraft(state.currentUserId, state).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [state]);

  const handleResumeDraft = () => {
    dispatch({ type: 'RESTORE_DRAFT', draft: draftPrompt });
    setDraftPrompt(null);
    showToast('Draft restored', 'success');
  };

  const handleDiscardDraft = () => {
    if (state.currentUserId) {
      clearDraft(state.currentUserId).catch(() => {});
    }
    setDraftPrompt(null);
    showToast('Draft discarded', 'info');
  };

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const handleViewChange = (view) => {
    setCurrentView(view);
    if (view === 'editor') {
      setViewingQuote(null);
    }
  };

  const handleViewQuote = async (quoteSummary) => {
    try {
      const full = await getJob(state.currentUserId, quoteSummary.id);
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

  // RAMS: Create from current quote
  const handleCreateRams = (jobId) => {
    dispatch({ type: 'CREATE_RAMS' });
    setActiveJobId(jobId || null);
    setCurrentView('rams');
    setRamsSubView('edit');
    showToast('RAMS created from quote', 'success');
  };

  // RAMS: Create from saved job
  const handleCreateRamsFromSaved = (savedJob) => {
    const snapshot = savedJob.quoteSnapshot || savedJob.snapshot;
    if (snapshot) {
      dispatch({ type: 'RESTORE_DRAFT', draft: { ...snapshot, step: 5 } });
    }
    setTimeout(() => {
      dispatch({ type: 'CREATE_RAMS' });
      setActiveJobId(savedJob.id);
      setCurrentView('rams');
      setRamsSubView('edit');
      setViewingQuote(null);
      showToast('RAMS created from saved quote', 'success');
    }, 50);
  };

  // RAMS: View from saved job
  const handleViewRams = (savedJob) => {
    dispatch({ type: 'RESTORE_RAMS', rams: savedJob.ramsSnapshot });
    setActiveJobId(savedJob.id);
    setCurrentView('rams');
    setRamsSubView('edit');
    setViewingQuote(null);
  };

  // Back to quote from RAMS
  const handleBackToQuote = () => {
    setCurrentView('editor');
    setRamsSubView('edit');
  };

  // --- Show UserSelector if init complete but no user selected ---
  if (state.initComplete && !state.currentUserId) {
    return (
      <div className="min-h-screen bg-tq-bg text-tq-text font-body">
        <UserSelector users={state.allUsers} onSelectUser={handleSelectUser} />
        {toast && (
          <Toast key={toast.key} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
        )}
      </div>
    );
  }

  // --- Loading state before init ---
  if (!state.initComplete) {
    return (
      <div className="min-h-screen bg-tq-bg flex items-center justify-center">
        <div className="text-tq-muted text-sm font-heading">Loading...</div>
      </div>
    );
  }

  const renderContent = () => {
    // RAMS view
    if (currentView === 'rams' && state.rams) {
      if (ramsSubView === 'output') {
        return (
          <RamsOutput
            rams={state.rams}
            profile={state.profile}
            dispatch={dispatch}
            showToast={showToast}
            onBackToEditor={() => setRamsSubView('edit')}
            jobId={activeJobId}
            currentUserId={state.currentUserId}
          />
        );
      }
      return (
        <RamsEditor
          rams={state.rams}
          dispatch={dispatch}
          onPreview={() => setRamsSubView('output')}
        />
      );
    }

    // Saved quotes view
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
      return (
        <SavedQuotes
          onViewQuote={handleViewQuote}
          onCreateRams={handleCreateRamsFromSaved}
          onViewRams={handleViewRams}
          currentUserId={state.currentUserId}
        />
      );
    }

    // Editor view
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
        return (
          <QuoteOutput
            state={state}
            dispatch={dispatch}
            showToast={showToast}
            onCreateRams={handleCreateRams}
          />
        );
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
        onBackToQuote={handleBackToQuote}
        currentUser={state.currentUser}
        allUsers={state.allUsers}
        onSwitchUser={handleSwitchUser}
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
