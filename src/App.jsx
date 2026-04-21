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
import UserSwitcher from './components/UserSwitcher.jsx';
import Dashboard from './components/Dashboard.jsx';
import StatusModal from './components/StatusModal.jsx';
import LearningDashboard from './components/LearningDashboard.jsx';
import AgentActivity from './components/AgentActivity.jsx';
import SaveErrorBanner from './components/SaveErrorBanner.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import Sidebar from './components/Sidebar.jsx';
import BottomNav from './components/BottomNav.jsx';
import { runAnalysis } from './utils/analyseJob.js';
import { getJob, listJobs, saveJob, updateJob, saveDraft, loadDraft, clearDraft, getProfile, saveProfile, getQuoteSequence, getSetting, getTheme, setTheme as setThemeDB, setRamsNotRequired, updateJobStatus, migrateFromLegacyDB, loadPhotos, deletePhotos, saveDiffs, SessionExpiredError } from './utils/userDB.js';
import { calculateExpiresAt } from './utils/quoteBuilder.js';
import { isAdminPlan as checkAdminPlan } from './utils/isAdminPlan.js';

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
  const [currentView, setCurrentView] = useState('dashboard');
  const [viewingQuote, setViewingQuote] = useState(null);
  const [ramsSubView, setRamsSubView] = useState('edit');
  const [activeJobId, setActiveJobId] = useState(null);

  // Incomplete jobs state
  const [incompleteJobs, setIncompleteJobs] = useState([]);
  const [savedJobCount, setSavedJobCount] = useState(0);
  const [savedJobs, setSavedJobs] = useState([]);

  // Pending draft for dashboard (replaces draftPrompt modal)
  const [pendingDraft, setPendingDraft] = useState(null);

  // Save error banner dismiss state — matches against a key that increments per failure
  const [dismissedSaveErrorKey, setDismissedSaveErrorKey] = useState(0);

  // Feature flag: voice dictation (per-user setting, not coupled to plan)
  const [voiceDictationEnabled, setVoiceDictationEnabled] = useState(true);

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

  const draftChecked = useRef(false);

  // --- Init flow: fetch /auth/me → INIT_COMPLETE or redirect to /login ---
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    (async () => {
      try {
        const res = await fetch('/auth/me');
        const data = await res.json();
        if (!data?.user) {
          window.location.href = '/login';
          return;
        }
        dispatch({ type: 'INIT_COMPLETE', user: data.user });
      } catch {
        window.location.href = '/login';
      }
    })();
  }, []);

  // --- After INIT_COMPLETE with auto-selected user, load their data ---
  const autoLoadDone = useRef(false);
  useEffect(() => {
    if (!state.initComplete || !state.currentUserId || autoLoadDone.current) return;
    autoLoadDone.current = true;
    loadUserData(state.currentUserId);
  }, [state.initComplete, state.currentUserId]);

  // --- bfcache resilience ---
  // Safari (and Firefox) restore entire pages from the back-forward cache.
  // When that happens, JS state is frozen but the world around it may have
  // moved on: session cookie evicted by ITP, Railway service restarted,
  // OAuth state stale. Any API call from the restored page would 401
  // while the UI confidently shows "logged in" — exactly Paul's "pressed
  // the forward arrow and it kicked me back to login" regression.
  //
  // Cheap fix: on pageshow with event.persisted === true, force a full
  // reload. The browser re-requests the page, the server re-validates
  // the session, and whatever happens next is coherent.
  useEffect(() => {
    const onShow = (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // --- Fetch incomplete jobs whenever user or view changes ---
  const fetchIncompleteJobs = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const jobs = await listJobs(userId);
      setSavedJobCount(jobs.length);
      setSavedJobs(jobs);
      dispatch({ type: 'JOBS_UPDATED', jobs });
      const incomplete = jobs.filter(j => !j.hasRams && !j.ramsNotRequired);
      setIncompleteJobs(incomplete);
    } catch (err) {
      // Session expired (ITP eviction, 7-day cookie cap, server restart):
      // surface it as a login redirect rather than silently flattening to
      // an empty list. Paul's "nothing in My Quotes" scare was exactly
      // this masking a 401.
      if (err instanceof SessionExpiredError) {
        window.location.href = '/login?error=session_expired';
        return;
      }
      console.warn('[Dashboard] Failed to load jobs:', err.message);
      setIncompleteJobs([]);
      setSavedJobs([]);
    }
  }, []);

  useEffect(() => {
    if (state.currentUserId && (currentView === 'dashboard' || currentView === 'saved')) {
      fetchIncompleteJobs(state.currentUserId);
    }
  }, [state.currentUserId, currentView, fetchIncompleteJobs]);

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

    // Load feature flags
    const voiceFlag = await getSetting(userId, 'voice_dictation');
    setVoiceDictationEnabled(voiceFlag !== false);

    // Dispatch SELECT_USER — always use DB profile (source of truth)
    const user = state.allUsers.find(u => u.id === userId);
    dispatch({
      type: 'SELECT_USER',
      userId,
      name: user?.name || userId,
      profile: profile,
      quoteSequence: sessionState?.quoteSequence || quoteSequence,
    });

    // If session state exists with active work, restore it and return to editor
    // This handles mid-workflow page reloads (e.g. mobile mic permission prompt
    // causing browser to reload the tab) — the user lands back in the editor
    // instead of being dumped on the dashboard.
    if (sessionState && sessionState.step > 1) {
      dispatch({ type: 'RESTORE_DRAFT', draft: sessionState });
      setCurrentView('editor');
    } else {
      setCurrentView('dashboard');
    }

    // Store last user
    try { sessionStorage.setItem('tq_last_user', userId); } catch {}

    // Check for drafts — store as pendingDraft for dashboard display
    if (!draftChecked.current) {
      draftChecked.current = true;
      try {
        const draft = await loadDraft(userId);
        if (draft?.jobDetails?.clientName && (!sessionState || sessionState.step <= 1)) {
          setPendingDraft(draft);
        }
      } catch {}
    }

    // Fetch jobs for dashboard
    fetchIncompleteJobs(userId);
  }

  // --- User switch handler ---
  const handleSwitchUser = useCallback(async (userId) => {
    // Save current profile before switching
    if (state.currentUserId) {
      try { await saveProfile(state.currentUserId, state.profile); } catch {}
    }

    // Reset local view state
    setCurrentView('dashboard');
    setViewingQuote(null);
    setRamsSubView('edit');
    setActiveJobId(null);
    setPendingDraft(null);
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
        setPendingDraft(draft);
      }
    } catch {}

    // Always land on dashboard first
    setCurrentView('dashboard');

    fetchIncompleteJobs(userId);
    showToast(`Switched to ${user?.name || userId}`, 'info');
  }, [state.currentUserId, state.profile, state.allUsers, showToast, fetchIncompleteJobs]);

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

  // Auto-save job + diffs at Generate Quote (Step 4 → Step 5)
  // Also fires on re-generate after BACK_TO_REVIEW → edit → GENERATE_QUOTE
  const autoSaveTriggered = useRef(false);
  useEffect(() => {
    if (state.step !== 5 || !state.quotePayload || !state.currentUserId) {
      autoSaveTriggered.current = false;
      return;
    }
    if (autoSaveTriggered.current) return;
    autoSaveTriggered.current = true;

    (async () => {
      try {
        let jobId = state.savedJobId;
        if (jobId) {
          // Re-generate: update existing job snapshot
          await updateJob(state.currentUserId, jobId, state);
        } else {
          // First save: create new job
          jobId = await saveJob(state.currentUserId, state);
          dispatch({ type: 'QUOTE_SAVED', jobId });
        }
        // Always save/replace diffs
        try {
          await saveDiffs(state.currentUserId, jobId, state.diffs, state.quotePayload?.aiAccuracyScore ?? null);
        } catch (err) {
          console.warn('[AutoSave] Diffs save failed:', err.message);
        }
      } catch (err) {
        console.error('[AutoSave] Job save failed:', err.message);
        dispatch({ type: 'QUOTE_SAVE_FAILED', error: err.message });
      }
    })();
  }, [state.step, state.quotePayload, state.currentUserId]);

  // Auto-save profile to DB (debounced 3s) whenever profile changes
  // Skip the first change after user load to avoid writing stale/initial profile back to DB
  const profileJSON = JSON.stringify(state.profile);
  const profileLoadedRef = useRef(false);
  const prevProfileJSON = useRef(profileJSON);
  useEffect(() => {
    // When user changes, reset the guard
    profileLoadedRef.current = false;
    prevProfileJSON.current = null;
  }, [state.currentUserId]);
  useEffect(() => {
    if (!state.currentUserId) return;
    // Skip the first render after user load (the DB profile arriving via SELECT_USER)
    if (!profileLoadedRef.current) {
      profileLoadedRef.current = true;
      prevProfileJSON.current = profileJSON;
      return;
    }
    // Only save if the profile actually changed from what we last saw
    if (profileJSON === prevProfileJSON.current) return;
    prevProfileJSON.current = profileJSON;
    const timer = setTimeout(() => {
      saveProfile(state.currentUserId, state.profile).catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [state.currentUserId, profileJSON]);

  // Document title: show quote reference on Steps 4 and 5
  useEffect(() => {
    if ((state.step === 4 || state.step === 5) && state.jobDetails?.quoteReference) {
      document.title = `FastQuote \u2014 ${state.jobDetails.quoteReference}`;
    } else {
      document.title = 'FastQuote';
    }
    return () => { document.title = 'FastQuote'; };
  }, [state.step, state.jobDetails?.quoteReference]);

  // Warn before closing tab on Step 4 (unsaved work)
  useEffect(() => {
    if (state.step !== 4) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.step]);

  // Retry analysis: watch for retryCount increments (set by RETRY_ANALYSIS)
  const lastRetryCount = useRef(state.retryCount || 0);
  useEffect(() => {
    const currentRetry = state.retryCount || 0;
    if (currentRetry > lastRetryCount.current && state.isAnalysing) {
      lastRetryCount.current = currentRetry;
      runAnalysis({
        photos: state.photos,
        extraPhotos: state.extraPhotos,
        jobDetails: state.jobDetails,
        profile: state.profile,
        abortRef,
        dispatch,
        userId: state.currentUserId,
      });
    }
  }, [state.retryCount]);

  // No useEffect needed — key-based comparison handles repeated errors

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  // --- Dashboard handlers ---
  const handleGoToDashboard = () => {
    setCurrentView('dashboard');
    setViewingQuote(null);
    fetchIncompleteJobs(state.currentUserId);
  };

  const handleStartNewQuote = () => {
    // Save current work as draft first if in-progress
    if (state.currentUserId && state.step >= 2 && state.step <= 4) {
      saveDraft(state.currentUserId, state).catch(() => {});
    }
    // Clear draft photos for fresh start
    if (state.currentUserId) deletePhotos(state.currentUserId, 'draft').catch(() => {});
    dispatch({ type: 'NEW_QUOTE' });
    setCurrentView('editor');
  };

  const handleStartQuickQuote = () => {
    if (state.currentUserId && state.step >= 2 && state.step <= 4) {
      saveDraft(state.currentUserId, state).catch(() => {});
    }
    if (state.currentUserId) deletePhotos(state.currentUserId, 'draft').catch(() => {});
    dispatch({ type: 'NEW_QUOTE', mode: 'quick' });
    setCurrentView('editor');
  };

  const handleResumeDraft = async () => {
    if (pendingDraft) {
      dispatch({ type: 'RESTORE_DRAFT', draft: pendingDraft });
      setPendingDraft(null);
    }
    setCurrentView('editor');
    // Load photos from server
    if (state.currentUserId) {
      try {
        const { photos, extraPhotos } = await loadPhotos(state.currentUserId, 'draft');
        if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
          dispatch({ type: 'RESTORE_PHOTOS', photos, extraPhotos });
        }
      } catch {}
    }
    showToast('Draft restored', 'success');
  };

  const handleResumeJob = async (job) => {
    const snapshot = job.quoteSnapshot || job.snapshot;
    if (snapshot) {
      dispatch({ type: 'RESTORE_DRAFT', draft: { ...snapshot, step: 4 } });
    }
    setActiveJobId(job.id);
    setCurrentView('editor');
    // Load photos from the job context
    if (state.currentUserId) {
      try {
        const { photos, extraPhotos } = await loadPhotos(state.currentUserId, job.id);
        if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
          dispatch({ type: 'RESTORE_PHOTOS', photos, extraPhotos });
        }
      } catch {}
    }
    showToast(`Resumed: ${job.clientName || 'Job'}`, 'success');
  };

  const handleMarkRamsNotRequired = async (jobId) => {
    try {
      await setRamsNotRequired(state.currentUserId, jobId, true);
      setIncompleteJobs(prev => prev.filter(j => j.id !== jobId));
      showToast('Marked as complete (no RAMS needed)', 'success');
    } catch (err) {
      showToast('Failed to update job', 'error');
    }
  };

  // --- Status lifecycle handler ---
  const handleStatusConfirm = async (jobId, targetStatus, meta) => {
    try {
      await updateJobStatus(state.currentUserId, jobId, targetStatus, meta);
      const jobs = await listJobs(state.currentUserId);
      dispatch({ type: 'JOBS_UPDATED', jobs });
      setSavedJobs(jobs);
      dispatch({ type: 'CLOSE_STATUS_MODAL' });
      if (targetStatus === 'sent') {
        const expiry = new Date(meta.expiresAt);
        const formatted = expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        showToast(`Quote marked as sent \u00b7 expires ${formatted}`, 'success');
      } else if (targetStatus === 'accepted') {
        showToast("Quote accepted \u2014 don\u2019t forget to create a RAMS", 'success');
      } else if (targetStatus === 'declined') {
        showToast('Quote recorded as declined', 'info');
      } else if (targetStatus === 'completed') {
        showToast('Job marked as completed', 'success');
      }
      fetchIncompleteJobs(state.currentUserId);
    } catch (err) {
      showToast('Failed to update status', 'error');
    }
  };

  // --- View handlers ---
  const handleViewChange = (view) => {
    setCurrentView(view);
    if (view === 'editor') {
      setViewingQuote(null);
    }
  };

  const handleViewQuote = async (quoteSummary) => {
    try {
      const full = await getJob(state.currentUserId, quoteSummary.id);
      if (!full) {
        showToast('Could not load this quote. It may have been deleted.', 'error');
        return;
      }
      setViewingQuote(full);
    } catch (err) {
      console.error('Failed to load quote:', err);
      showToast('Failed to load quote. Check your connection and try again.', 'error');
    }
  };

  const handleEditQuote = async (virtualState) => {
    dispatch({ type: 'RESTORE_DRAFT', draft: { ...virtualState, step: 4 } });
    setViewingQuote(null);
    setCurrentView('editor');
    // Load photos from the saved job context
    if (state.currentUserId && viewingQuote?.id) {
      try {
        const { photos, extraPhotos } = await loadPhotos(state.currentUserId, viewingQuote.id);
        if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
          dispatch({ type: 'RESTORE_PHOTOS', photos, extraPhotos });
        }
      } catch {}
    }
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
  const handleCreateRamsFromSaved = async (savedJob) => {
    const snapshot = savedJob.quoteSnapshot || savedJob.snapshot;
    if (snapshot) {
      dispatch({ type: 'RESTORE_DRAFT', draft: { ...snapshot, step: 5 } });
    }
    // Load photos from the saved job context before creating RAMS
    if (state.currentUserId) {
      try {
        const { photos, extraPhotos } = await loadPhotos(state.currentUserId, savedJob.id);
        if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
          dispatch({ type: 'RESTORE_PHOTOS', photos, extraPhotos });
        }
      } catch {}
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

  // Profile complete callback (first-time setup -> dashboard)
  const handleProfileComplete = () => {
    if (state.currentUserId) {
      saveProfile(state.currentUserId, state.profile).catch(() => {});
    }
    setCurrentView('dashboard');
    showToast('Profile saved', 'success');
  };

  // --- Loading state before init (also covers redirect-to-login case) ---
  if (!state.initComplete || !state.currentUserId) {
    return (
      <div className="min-h-screen bg-tq-bg flex items-center justify-center">
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, fontSize: 32, letterSpacing: '0.05em', color: 'var(--tq-accent)', opacity: 0.7 }}>
          FASTQUOTE
        </span>
      </div>
    );
  }

  // --- Onboarding gate: new Google users land on profile setup before anything else ---
  if (state.currentUser && state.currentUser.profileComplete === false) {
    return (
      <div className="min-h-screen bg-tq-bg text-tq-text font-body">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <ProfileSetup
            state={state}
            dispatch={dispatch}
            onProfileComplete={async () => {
              if (state.currentUserId) {
                try {
                  await saveProfile(state.currentUserId, state.profile);
                  await fetch(`/api/users/${state.currentUserId}/settings/profile_complete`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: true }),
                  });
                } catch {}
              }
              dispatch({
                type: 'INIT_COMPLETE',
                user: { ...state.currentUser, profileComplete: true },
              });
              setCurrentView('dashboard');
              showToast('Profile saved \u2014 welcome to FastQuote', 'success');
            }}
          />
        </div>
        {toast && (
          <Toast key={toast.key} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
        )}
      </div>
    );
  }

  const handleGoToSaved = () => {
    setCurrentView('saved');
    setViewingQuote(null);
  };

  const handleLogout = async () => {
    try {
      if (state.currentUserId) {
        await saveProfile(state.currentUserId, state.profile).catch(() => {});
      }
    } catch {}
    window.location.href = '/auth/logout';
  };

  const isAdmin = checkAdminPlan(state.currentUser);

  const renderContent = () => {
    // Learning dashboard (admin only)
    if (currentView === 'learning' && isAdmin) {
      return <LearningDashboard currentUserId={state.currentUserId} />;
    }

    // Agent activity dashboard (admin only)
    if (currentView === 'agents' && isAdmin) {
      return <AgentActivity />;
    }

    // Dashboard view — if a quote is selected, show it directly (no detour through "View All")
    if (currentView === 'dashboard') {
      if (viewingQuote) {
        return (
          <SavedQuoteViewer
            quote={viewingQuote}
            onBack={() => setViewingQuote(null)}
            onEditQuote={handleEditQuote}
            currentUserId={state.currentUserId}
          />
        );
      }
      return (
        <Dashboard
          userName={state.currentUser?.name}
          onStartNewQuote={handleStartNewQuote}
          onStartQuickQuote={handleStartQuickQuote}
          onViewJobs={() => setCurrentView('saved')}
          incompleteJobs={incompleteJobs}
          currentDraft={pendingDraft || (state.step >= 2 && state.step <= 4 ? state : null)}
          onResumeDraft={pendingDraft ? handleResumeDraft : () => setCurrentView('editor')}
          onResumeJob={handleResumeJob}
          onMarkRamsNotRequired={handleMarkRamsNotRequired}
          onCreateRamsFromSaved={handleCreateRamsFromSaved}
          savedJobs={savedJobs}
          recentJobs={state.recentJobs}
          dispatch={dispatch}
          onViewJob={handleViewQuote}
          onViewRams={handleViewRams}
          isAdminPlan={isAdmin}
        />
      );
    }

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
            currentUserId={state.currentUserId}
          />
        );
      }
      return (
        <SavedQuotes
          onViewQuote={handleViewQuote}
          onCreateRams={handleCreateRamsFromSaved}
          onViewRams={handleViewRams}
          currentUserId={state.currentUserId}
          recentJobs={state.recentJobs}
          dispatch={dispatch}
          isAdminPlan={isAdmin}
          showToast={showToast}
        />
      );
    }

    // Editor view
    return renderStep();
  };

  const renderStep = () => {
    switch (state.step) {
      case 1:
        return (
          <ProfileSetup
            state={state}
            dispatch={dispatch}
            onProfileComplete={handleProfileComplete}
          />
        );
      case 2:
        return <JobDetails state={state} dispatch={dispatch} abortRef={abortRef} showToast={showToast} voiceDictationEnabled={voiceDictationEnabled} />;
      case 3:
        return <AIAnalysis state={state} dispatch={dispatch} cancelAnalysis={cancelAnalysis} />;
      case 4:
        return <ReviewEdit state={state} dispatch={dispatch} showToast={showToast} />;
      case 5:
        return (
          <QuoteOutput
            state={state}
            dispatch={dispatch}
            showToast={showToast}
            onCreateRams={handleCreateRams}
            onSaved={() => fetchIncompleteJobs(state.currentUserId)}
            isAdminPlan={isAdmin}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-tq-bg text-tq-text font-body flex flex-col fq:flex-row">
      {/* Desktop side rail */}
      <Sidebar
        className="hidden fq:flex"
        currentView={currentView}
        onNavigate={handleViewChange}
        onStartNewQuote={handleStartNewQuote}
        onGoToDashboard={handleGoToDashboard}
        onGoToSaved={handleGoToSaved}
        onGoToLearning={() => setCurrentView('learning')}
        onGoToAgents={() => setCurrentView('agents')}
        theme={theme}
        toggleTheme={toggleTheme}
        currentUser={state.currentUser}
        onSettingsClick={() => setShowProfileModal(true)}
        onLogout={handleLogout}
        isAdminPlan={isAdmin}
      />

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-16 fq:pb-0">
        <StepIndicator
          currentStep={state.step}
          dispatch={dispatch}
          currentView={currentView}
          quoteMode={state.quoteMode}
          isAdminPlan={isAdmin}
        />
        <div className="max-w-5xl mx-auto px-4 py-6">
          <OfflineBanner />
          <SaveErrorBanner
            error={state.quoteSaveError && (state.quoteSaveErrorKey || 0) !== dismissedSaveErrorKey ? state.quoteSaveError : null}
            onDismiss={() => setDismissedSaveErrorKey(state.quoteSaveErrorKey || 0)}
          />
          {renderContent()}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <BottomNav
        className="fq:hidden"
        currentView={currentView}
        onGoToDashboard={handleGoToDashboard}
        onStartNewQuote={handleStartNewQuote}
        onGoToSaved={handleGoToSaved}
        onSettingsClick={() => setShowProfileModal(true)}
        isAdminPlan={isAdmin}
      />

      {/* Profile modal */}
      {showProfileModal && (
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
              onClose={() => {
                setShowProfileModal(false);
                if (state.currentUserId) {
                  saveProfile(state.currentUserId, state.profile).catch(() => {});
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Status lifecycle modal */}
      {state.statusModal?.open && (
        <StatusModal
          modal={state.statusModal}
          job={state.recentJobs.find(j => j.id === state.statusModal.jobId)}
          onConfirm={handleStatusConfirm}
          onCancel={() => dispatch({ type: 'CLOSE_STATUS_MODAL' })}
          isAdminPlan={isAdmin}
        />
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
