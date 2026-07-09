import React, { useReducer, useState, useEffect, useRef, useCallback } from 'react';
import { reducer, getInitialState, loadState } from './reducer.js';
import { STEPS } from './constants.js';
import { documentTerm } from './utils/documentType.js';
import StepIndicator from './components/StepIndicator.jsx';
import ProfileSetup from './components/steps/ProfileSetup.jsx';
import JobDetails from './components/steps/JobDetails.jsx';
import AIAnalysis from './components/steps/AIAnalysis.jsx';
import ReviewEdit from './components/steps/ReviewEdit.jsx';
import QuoteOutput from './components/steps/QuoteOutput.jsx';
import SavedQuotes from './components/SavedQuotes.jsx';
import SavedQuoteViewer from './components/SavedQuoteViewer.jsx';
import ClientsList from './components/ClientsList.jsx';
import ClientDetail from './components/ClientDetail.jsx';
import RamsEditor from './components/rams/RamsEditor.jsx';
import RamsOutput from './components/rams/RamsOutput.jsx';
import Toast from './components/Toast.jsx';
import UserSwitcher from './components/UserSwitcher.jsx';
import Dashboard from './components/Dashboard.jsx';
import StatusModal from './components/StatusModal.jsx';
import LearningDashboard from './components/LearningDashboard.jsx';
import AgentActivity from './components/AgentActivity.jsx';
import Analytics from './components/Analytics.jsx';
import SaveErrorBanner from './components/SaveErrorBanner.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import SubscriptionBanner from './components/SubscriptionBanner.jsx';
import QuotaExhaustedModal from './components/QuotaExhaustedModal.jsx';
import HelpModal from './components/HelpModal.jsx';
import ReferralWelcome from './components/ReferralWelcome.jsx';
// RedeemReferralBanner moved to Profile → Bonus quotes on 2026-06-30
// (no longer a Dashboard banner). Import lives in ProfileSetup.jsx.
import Sidebar from './components/Sidebar.jsx';
import BottomNav from './components/BottomNav.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { runAnalysis } from './utils/analyseJob.js';
import { trackEvent } from './utils/trackEvent.js';
import { getJob, listJobs, saveJob, updateJob, saveDraft, loadDraft, clearDraft, getProfile, saveProfile, getQuoteSequence, incrementQuoteSequence, getSetting, getTheme, setTheme as setThemeDB, setRamsNotRequired, updateJobStatus, migrateFromLegacyDB, loadPhotos, deletePhotos, saveDiffs, SessionExpiredError, getClientStatus, generateClientToken, deleteJob } from './utils/userDB.js';
import { autosaveDraft } from './utils/autosaveDraft.js';
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
  // In-app help/contact modal (Harry's launch checklist 2026-06-30).
  // Reachable from Sidebar (desktop) + ProfileSetup modal (mobile).
  const [showHelp, setShowHelp] = useState(false);
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
  // Feature flag: video analysis (server-driven via /auth/me → features
  // payload). Defaults to false so that if /auth/me fails to return the
  // flag the client keeps the safer state and basic users don't see a
  // dead video upload button. See docs/VIDEO_FLAG.md.
  const [videoAnalysisEnabled, setVideoAnalysisEnabled] = useState(false);
  // Feature flag: email integration (Send via Email + Send via Outlook
  // in QuoteOutput's caret menu). Server-driven via /auth/me → features.
  // Defaults to false so if /auth/me fails to return the flag the client
  // keeps the safer state — the Email/Outlook entry points stay hidden
  // until the server explicitly says they're on. See docs/EMAIL_FLAG.md.
  const [emailIntegrationEnabled, setEmailIntegrationEnabled] = useState(false);
  // Feature flag: Clients + Sites feature (CLIENTS_SPEC_v3, 2026-07-07).
  // Server-driven via /auth/me → features.clientsEnabled. When false
  // (default), the Sidebar hides the Clients tab and the routes 404.
  const [clientsEnabled, setClientsEnabled] = useState(false);
  // Client detail view — id of the currently-open client, or null.
  const [currentClientId, setCurrentClientId] = useState(null);
  // Quota state (2026-06-22) — populated from /auth/me's billing block.
  // Drives the "block New Quote button on exhausted" guard below so the
  // user never enters the flow only to be blocked at /analyse. Null
  // (initial) means we haven't loaded it yet — treat as permissive so
  // we don't false-positive block users while /auth/me is in flight.
  const [billing, setBilling] = useState(null);

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
        // Apply server-driven feature flags before the auth gate so the
        // disabled-state UI is correct even on an authed bounce-out.
        if (data?.features) {
          setVideoAnalysisEnabled(!!data.features.videoAnalysisEnabled);
          setEmailIntegrationEnabled(!!data.features.emailIntegrationEnabled);
          setClientsEnabled(!!data.features.clientsEnabled);
        }
        if (data?.billing) {
          setBilling(data.billing);
        }
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

  // Refresh the billing block from /auth/me. Used by the persistent
  // QuotaCounter (2026-06-23) to tick down after a successful analysis
  // without requiring a page reload. Called from the analyseJob
  // success path (via the `onAnalysisSuccess` callback). Failures
  // are silent — the counter just stays stale until the next refresh
  // window; never crashes the app.
  const refreshBilling = useCallback(async () => {
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.billing) setBilling(data.billing);
    } catch {
      // Best-effort.
    }
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
  //
  // Critical ordering rule (TRQ-165): the draft is cleared ONLY after a
  // successful Step 5 save (savedJobId set by QUOTE_SAVED). Previously
  // the clear fired the instant step transitioned out of [2,4], in
  // parallel with the saveJob effect — so a transient 5xx during save
  // left the user with no draft, no job, and only sessionStorage as a
  // recovery path. If that tab died (iPad memory pressure, OAuth re-
  // login, manual refresh), the work was gone.
  useEffect(() => {
    if (!state.currentUserId) return;
    // Out of editing entirely (dashboard, etc.) — safe to drop draft.
    if (state.step < 2) {
      clearDraft(state.currentUserId).catch(() => {});
      return;
    }
    // Active editing — keep autosaving.
    if (state.step <= 4) {
      const timer = setTimeout(() => {
        autosaveDraft(state.currentUserId, state, dispatch);
      }, 5000);
      return () => clearTimeout(timer);
    }
    // Step 5 — only clear once the job has been saved. While
    // savedJobId is null (save in flight, or save failed) the draft is
    // the user's recovery path.
    if (state.step === 5 && state.savedJobId) {
      clearDraft(state.currentUserId).catch(() => {});
    }
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
          // Reference-bug fix (2026-06-29 dashboard redesign): the SPA
          // increments `state.quoteSequence` locally on NEW_QUOTE, but
          // until this call the DB row was never updated — so every
          // fresh session started from the original value and the
          // first quote of each session got the SAME reference
          // (QT-2026-0002 in Mark's audit). Atomically bump the DB
          // sequence after a successful save so the next session
          // sees the right starting point. Best-effort; a failure
          // here doesn't roll back the save (the duplicate-ref
          // server dedup window catches accidental repeats).
          incrementQuoteSequence(state.currentUserId).catch(() => {});
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
        // Reusing the same quoteToken on retry keeps this draft as a
        // single free quote (2026-06-22).
        quoteToken: state.quoteToken,
        // Persistent quotes counter (2026-06-23): refresh billing on
        // success so the counter ticks down without a page reload.
        // Failed retries do not call this — counter stays put.
        onAnalysisSuccess: refreshBilling,
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

  // 402-lockout guard (2026-06-22). The server will 402 the next
  // /analyse call anyway, but blocking entry here avoids the awful UX
  // where the user uploads photos / records video first and only
  // discovers they're locked out at submission. The check is
  // permissive while billing is null (initial /auth/me still in
  // flight) so we don't accidentally block users on a slow boot.
  const isQuotaExhausted = billing?.quotaState === 'exhausted';

  const handleStartNewQuote = () => {
    if (isQuotaExhausted) {
      const freeLimit = billing?.freeQuotesLimit ?? 3;
      dispatch({
        type: 'ANALYSIS_QUOTA_EXHAUSTED',
        message: `You've used your ${freeLimit} free quotes. Subscribe to continue.`,
        freeQuotesUsed: billing?.freeQuotesUsed ?? freeLimit,
        freeQuotesLimit: freeLimit,
      });
      return;
    }
    // Save current work as draft first if in-progress
    if (state.currentUserId && state.step >= 2 && state.step <= 4) {
      autosaveDraft(state.currentUserId, state, dispatch);
    }
    // Clear draft photos for fresh start
    if (state.currentUserId) deletePhotos(state.currentUserId, 'draft').catch(() => {});
    dispatch({ type: 'NEW_QUOTE' });
    // Analytics Phase 1 — fire quote_started here (App entry point)
    // rather than in the reducer so we get one event per user action,
    // not one per NEW_QUOTE dispatch (which can happen during state
    // restore too). `mode: 'full'` distinguishes from Quick Quote.
    trackEvent('quote_started', { mode: 'full' });
    setCurrentView('editor');
  };

  const handleStartQuickQuote = () => {
    if (isQuotaExhausted) {
      const freeLimit = billing?.freeQuotesLimit ?? 3;
      dispatch({
        type: 'ANALYSIS_QUOTA_EXHAUSTED',
        message: `You've used your ${freeLimit} free quotes. Subscribe to continue.`,
        freeQuotesUsed: billing?.freeQuotesUsed ?? freeLimit,
        freeQuotesLimit: freeLimit,
      });
      return;
    }
    if (state.currentUserId && state.step >= 2 && state.step <= 4) {
      autosaveDraft(state.currentUserId, state, dispatch);
    }
    if (state.currentUserId) deletePhotos(state.currentUserId, 'draft').catch(() => {});
    dispatch({ type: 'NEW_QUOTE', mode: 'quick' });
    // Analytics Phase 1 — Quick Quote variant of quote_started. Same
    // event name (one funnel) but `mode: 'quick'` so the dashboard
    // can split the two modes for the analyse-skipped-review question.
    trackEvent('quote_started', { mode: 'quick' });
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
      const term = documentTerm(state.profile);
      if (targetStatus === 'sent') {
        const expiry = new Date(meta.expiresAt);
        const formatted = expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        showToast(`${term.title} marked as sent \u00b7 expires ${formatted}`, 'success');
      } else if (targetStatus === 'accepted') {
        showToast(`${term.title} accepted \u2014 don\u2019t forget to create a RAMS`, 'success');
      } else if (targetStatus === 'declined') {
        showToast(`${term.title} recorded as declined`, 'info');
      } else if (targetStatus === 'completed') {
        showToast('Job marked as completed', 'success');
      } else if (targetStatus === 'draft') {
        // 2026-06-29: Re-open from declined. App-chrome uses "Quote"
        // (terminology lockdown — Dashboard redesign 2026-06-29).
        showToast('Quote re-opened — edit and re-send when ready', 'success');
      }
      fetchIncompleteJobs(state.currentUserId);
    } catch (err) {
      showToast('Failed to update status', 'error');
    }
  };

  // --- Dashboard kebab actions (2026-06-29 UX follow-up) ---
  // Resend link: copy the existing client-portal URL to clipboard so the
  // waller can paste into WhatsApp / SMS / email. If no token exists yet
  // (rare for a sent quote but possible), generate one on the fly.
  const handleResendLink = async (job) => {
    if (!state.currentUserId || !job?.id) return;
    try {
      let url = null;
      try {
        const status = await getClientStatus(state.currentUserId, job.id);
        if (status?.url) url = status.url;
      } catch {
        // 404 = no token yet; fall through to generate
      }
      if (!url) {
        const created = await generateClientToken(state.currentUserId, job.id);
        url = created?.url || null;
      }
      if (!url) {
        showToast('Could not get a link for this quote', 'error');
        return;
      }
      // Use the modern clipboard API; falls back to a quick textarea
      // selection trick for older Safari (rare on iOS 16+ but cheap to
      // include).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast('Link copied — paste into WhatsApp or email', 'success');
    } catch (err) {
      showToast('Could not copy the link', 'error');
    }
  };

  // Delete a quote from the Dashboard kebab. Confirmation happens INSIDE
  // the kebab menu (inline two-tap pattern) so we don't need a modal
  // here — by the time this fires, the user has already confirmed.
  const handleDeleteJob = async (jobId) => {
    if (!state.currentUserId || !jobId) return;
    try {
      await deleteJob(state.currentUserId, jobId);
      // Best-effort photo cleanup; safe to ignore failure.
      deletePhotos(state.currentUserId, jobId).catch(() => {});
      const jobs = await listJobs(state.currentUserId);
      dispatch({ type: 'JOBS_UPDATED', jobs });
      setSavedJobs(jobs);
      fetchIncompleteJobs(state.currentUserId);
      showToast('Quote deleted', 'success');
    } catch (err) {
      showToast('Failed to delete quote', 'error');
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
    const term = documentTerm(state.profile);
    try {
      const full = await getJob(state.currentUserId, quoteSummary.id);
      if (!full) {
        showToast(`Could not load this ${term.lower}. It may have been deleted.`, 'error');
        return;
      }
      setViewingQuote(full);
    } catch (err) {
      console.error('Failed to load quote:', err);
      showToast(`Failed to load ${term.lower}. Check your connection and try again.`, 'error');
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
    showToast(`${documentTerm(state.profile).title} loaded for editing`, 'success');
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

  // TRQ-94: onboarding gate REMOVED. New Google users now land on the
  // dashboard with profileComplete=false and can make their first quote
  // immediately. The profile is only required at "Send to client" \u2014 see
  // ProfileGateModal in QuoteOutput. The gear icon \u2192 profile modal
  // remains the way to fill / edit company details at any time.

  const handleGoToSaved = () => {
    setCurrentView('saved');
    setViewingQuote(null);
  };

  const handleGoToClients = () => {
    setCurrentView('clients');
    setCurrentClientId(null);
    setViewingQuote(null);
  };

  const handleOpenClient = (clientId) => {
    setCurrentClientId(clientId);
    setCurrentView('clientDetail');
  };

  const handleBackToClientsList = () => {
    setCurrentClientId(null);
    setCurrentView('clients');
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
    // Analytics dashboard (admin only)
    if (currentView === 'analytics' && isAdmin) {
      return <Analytics />;
    }

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
            liveProfile={state.profile}
            showToast={showToast}
          />
        );
      }
      return (
        <Dashboard
          userName={state.currentUser?.name}
          profile={state.profile}
          onStartNewQuote={handleStartNewQuote}
          onStartQuickQuote={handleStartQuickQuote}
          onViewJobs={() => setCurrentView('saved')}
          incompleteJobs={incompleteJobs}
          currentDraft={
            pendingDraft
            || (state.step >= 2 && state.step <= 4
                && (state.jobDetails?.clientName?.trim() || state.jobDetails?.siteAddress?.trim())
                ? state
                : null)
          }
          onResumeDraft={pendingDraft ? handleResumeDraft : () => setCurrentView('editor')}
          onResumeJob={handleResumeJob}
          onMarkRamsNotRequired={handleMarkRamsNotRequired}
          onCreateRamsFromSaved={handleCreateRamsFromSaved}
          savedJobs={savedJobs}
          recentJobs={state.recentJobs}
          dispatch={dispatch}
          onViewJob={handleViewQuote}
          onViewRams={handleViewRams}
          onResendLink={handleResendLink}
          onDeleteJob={handleDeleteJob}
          showToast={showToast}
          isAdminPlan={isAdmin}
          viewMode={state.viewMode}
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
            liveProfile={state.profile}
            showToast={showToast}
          />
        );
      }
      return (
        <SavedQuotes
          onViewQuote={handleViewQuote}
          onCreateRams={handleCreateRamsFromSaved}
          onViewRams={handleViewRams}
          currentUserId={state.currentUserId}
          profile={state.profile}
          recentJobs={state.recentJobs}
          dispatch={dispatch}
          isAdminPlan={isAdmin}
          showToast={showToast}
          viewMode={state.viewMode}
        />
      );
    }

    // Clients list view (CLIENTS_SPEC_v3, 2026-07-07)
    if (currentView === 'clients') {
      return (
        <ClientsList
          currentUserId={state.currentUserId}
          onOpenClient={handleOpenClient}
          onBack={handleGoToDashboard}
          showToast={showToast}
        />
      );
    }

    // Client detail view
    if (currentView === 'clientDetail' && currentClientId) {
      return (
        <ClientDetail
          currentUserId={state.currentUserId}
          clientId={currentClientId}
          onBack={handleBackToClientsList}
          onOpenQuote={handleViewQuote}
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
            currentUserId={state.currentUserId}
            userName={state.currentUser?.name}
            showToast={showToast}
            billing={billing}
            onBillingRefresh={(nextBilling) => {
              if (nextBilling) setBilling(nextBilling);
              else refreshBilling();
            }}
          />
        );
      case 2:
        return <JobDetails state={state} dispatch={dispatch} abortRef={abortRef} showToast={showToast} voiceDictationEnabled={voiceDictationEnabled} videoAnalysisEnabled={videoAnalysisEnabled} onAnalysisSuccess={refreshBilling} clientsEnabled={clientsEnabled} currentUserId={state.currentUserId} />;
      case 3:
        return <AIAnalysis state={state} dispatch={dispatch} cancelAnalysis={cancelAnalysis} />;
      case 4:
        // Scoped boundary around the review grid — one malformed
        // measurement from a schema-drifted saved quote shouldn't take
        // the whole app down. Paul keeps editing the others.
        return (
          <ErrorBoundary scope="review">
            <ReviewEdit state={state} dispatch={dispatch} showToast={showToast} />
          </ErrorBoundary>
        );
      case 5:
        // Step 5 is the most-visited surface (preview + downloads +
        // portal link). A crash here was the worst-case: loss of
        // unsaved edits, no way back to the dashboard without a full
        // refresh. Scoped boundary gives Paul a "Try again" instead.
        return (
          <ErrorBoundary scope="quote-output">
            <QuoteOutput
              state={state}
              dispatch={dispatch}
              showToast={showToast}
              onCreateRams={handleCreateRams}
              onSaved={() => fetchIncompleteJobs(state.currentUserId)}
              isAdminPlan={isAdmin}
              onRequestOpenProfile={() => setShowProfileModal(true)}
              emailIntegrationEnabled={emailIntegrationEnabled}
            />
          </ErrorBoundary>
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
        onGoToClients={handleGoToClients}
        clientsEnabled={clientsEnabled}
        onGoToAnalytics={() => setCurrentView('analytics')}
        onGoToLearning={() => setCurrentView('learning')}
        onGoToAgents={() => setCurrentView('agents')}
        theme={theme}
        toggleTheme={toggleTheme}
        currentUser={state.currentUser}
        profile={state.profile}
        onSettingsClick={() => setShowProfileModal(true)}
        onHelpClick={() => setShowHelp(true)}
        onLogout={handleLogout}
        isAdminPlan={isAdmin}
        billing={billing}
      />

      {/* Main content */}
      {/* Mobile PR-1 (2026-06-26): mobile pb grows with safe-area
          inset to match the BottomNav, otherwise the last px of
          content sits behind the home-indicator strip on iPhone
          X+. Desktop (`fq:pb-0`) unchanged. */}
      <main className="flex-1 min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] fq:pb-0">
        <StepIndicator
          currentStep={state.step}
          dispatch={dispatch}
          currentView={currentView}
          quoteMode={state.quoteMode}
          isAdminPlan={isAdmin}
          autosave={state.autosave}
          onAutosaveRetry={() => autosaveDraft(state.currentUserId, state, dispatch)}
        />
        <div className="max-w-5xl mx-auto px-3 fq:px-4 py-4 fq:py-6">
          <OfflineBanner />
          {/* Persistent quotes-remaining counter (2026-06-23). Above
              SubscriptionBanner per the locked spec — smaller, always
              visible. Self-hides if billing isn't loaded yet.
              Dashboard redesign (2026-06-29): the Dashboard view moves
              this surface to the side rail (`RailQuotaChip` in
              Sidebar.jsx).
              2026-06-29 (later): Harry's call — the inline banner was
              redundant noise on Step pages + SavedQuotes too. Rail chip
              is visible across the app on desktop. The 402 lockout
              modal still fires when quota is exhausted, so users hit
              the wall at the actionable moment, not at every page
              load. Mobile: rail is hidden under 900px; users see the
              chip on Dashboard before entering the flow. */}
          <SubscriptionBanner />
          {/* Referrals Phase 1 (2026-06-23) — referee welcome. Self-
              hides unless the user has bonus quotes AND has not yet
              used any (signals a fresh referred signup). */}
          <ReferralWelcome billing={billing} currentUserId={state.currentUserId} />
          {/* RedeemReferralBanner used to live here as a Dashboard
              banner (Auth0 lost the original login-page field). On
              2026-06-30 Harry moved the redeem form into Profile →
              Bonus quotes, alongside the share panel. The form is
              still rendered by RedeemReferralBanner.jsx — it just
              gets mounted inside ProfileSetup's renderShare() now,
              not here. */}
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
        onGoToClients={handleGoToClients}
        clientsEnabled={clientsEnabled}
        onSettingsClick={() => setShowProfileModal(true)}
        isAdminPlan={isAdmin}
        isQuotaExhausted={isQuotaExhausted}
      />

      {/* Profile / Settings modal — 2026-06-29 redesign.
          The header (title + close-X) lives inside ProfileSetup so the
          5-section nav + sticky save bar all share one shell. App.jsx
          owns only the scrim and the 980×86vh frame. */}
      {showProfileModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-0 fq:p-6"
          aria-modal="true"
          role="dialog"
          aria-label="Edit Profile / Settings"
        >
          <div
            className="bg-tq-bg w-full fq:rounded-lg overflow-hidden border-0 fq:border border-tq-border flex flex-col h-screen fq:h-[min(86vh,820px)]"
            style={{
              maxWidth: 980,
            }}
          >
            {/*
              Profile modal close-X is now rendered INSIDE ProfileSetup
              as part of its .ps-head element (audit #14, PR-9 hit-area
              fix preserved — see .ps-head-x in index.html). App.jsx no
              longer renders its own "Edit Profile" header here.
            */}
            <ProfileSetup
              state={state}
              dispatch={dispatch}
              isModal
              onLogout={handleLogout}
              onHelpClick={() => setShowHelp(true)}
              currentUserId={state.currentUserId}
              userName={state.currentUser?.name}
              showToast={showToast}
              billing={billing}
              onBillingRefresh={(nextBilling) => {
                if (nextBilling) setBilling(nextBilling);
                else refreshBilling();
              }}
              onCancel={() => {
                // 2026-06-29 — close-only path. ProfileSetup has already
                // reverted local state to the snapshot, so we just dismiss
                // the modal. No server hit, no profile_complete touch.
                setShowProfileModal(false);
              }}
              onClose={async () => {
                setShowProfileModal(false);
                if (state.currentUserId) {
                  // Save the profile first.
                  await saveProfile(state.currentUserId, state.profile).catch(() => {});
                  // TRQ-94: ProfileSetup only invokes onClose when the
                  // form is valid (validateProfile passes). That's the
                  // signal to flip profile_complete=true so the Send-
                  // to-client gate stops blocking. Fire-and-forget —
                  // the toast confirms save regardless.
                  if (state.currentUser && state.currentUser.profileComplete === false) {
                    fetch(`/api/users/${state.currentUserId}/settings/profile_complete`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ value: true }),
                    }).catch(() => {});
                    dispatch({
                      type: 'INIT_COMPLETE',
                      user: { ...state.currentUser, profileComplete: true },
                    });
                  }
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
          currentUserId={state.currentUserId}
          onConfirm={handleStatusConfirm}
          onCancel={() => dispatch({ type: 'CLOSE_STATUS_MODAL' })}
          isAdminPlan={isAdmin}
        />
      )}

      {/* Quota-exhausted modal (2026-06-29). Renders globally whenever
          state.quotaLockout is set so the lockout surfaces wherever the
          user is. Previously the lockout UI only lived as an inline
          panel on the AIAnalysis (Step 3) screen — but exhausted users
          stopped at Step 1 / Dashboard never reached it, making the
          click a silent dead-end. Modal offers Buy + Subscribe so the
          user always has a forward path. */}
      {state.quotaLockout && (
        <QuotaExhaustedModal
          lockout={state.quotaLockout}
          onDismiss={() => dispatch({ type: 'CLEAR_QUOTA_LOCKOUT' })}
        />
      )}

      {/* In-app Help / contact modal (launch checklist 2026-06-30).
          Single source of truth for the email + micro-FAQ surface.
          Entry points: Sidebar's Help link (desktop) and the Need
          help? link inside ProfileSetup (mobile, opened via the
          BottomNav profile button). */}
      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        showToast={showToast}
      />

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
