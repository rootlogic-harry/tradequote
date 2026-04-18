import { DEFAULT_DAY_RATE } from './constants.js';
import { buildQuotePayload } from './utils/quoteBuilder.js';
import { buildDiff, enrichDiffWithContext } from './utils/diffTracking.js';
import { calculateRiskRating, generateRamsId } from './utils/ramsBuilder.js';
import { COMPANY_DEFAULTS, COMMON_PPE, DEFAULT_RISK_ASSESSMENTS } from './data/ramsDefaults.js';
import { WORK_STAGES_TEMPLATES } from './data/ramsTemplates.js';

function storageKey(userId) {
  return userId ? 'tq_session_' + userId : 'tq_state';
}

function saveState(state) {
  try {
    const toSave = { ...state, isAnalysing: false, analysisError: null, videoProgress: null, uploadProgress: null };
    sessionStorage.setItem(storageKey(state.currentUserId), JSON.stringify(toSave));
  } catch { /* quota exceeded — ignore */ }
}

export function loadState(userId) {
  try {
    const saved = sessionStorage.getItem(storageKey(userId));
    if (!saved) return null;
    return JSON.parse(saved);
  } catch { return null; }
}

export function getInitialState() {
  // Don't auto-load session state — wait for user selection
  return initialState;
}

export const initialState = {
  currentUserId: null,
  currentUser: null,
  allUsers: [],
  initComplete: false,
  step: 1,
  profile: {
    companyName: '',
    fullName: '',
    phone: '',
    email: '',
    address: '',
    logo: null,
    vatRegistered: false,
    vatNumber: '',
    dayRate: DEFAULT_DAY_RATE,
    accreditations: '',
    showNotesOnQuote: true,
  },
  jobDetails: {
    clientName: '',
    siteAddress: '',
    quoteReference: `QT-${new Date().getFullYear()}-0001`,
    quoteDate: new Date().toISOString().split('T')[0],
    briefNotes: '',
  },
  photos: {
    overview: null,
    closeup: null,
    sideProfile: null,
    referenceCard: null,
    access: null,
  },
  extraPhotos: [],
  isAnalysing: false,
  analysisError: null,
  aiRawResponse: null,
  reviewData: null,
  diffs: [],
  quotePayload: null,
  captureMode: null,       // null | 'video' | 'photos'
  videoProgress: null,     // SSE progress: { stage, progress, message }
  uploadProgress: null,    // XHR upload: { percent, loaded, total, speed, eta }
  quoteMode: 'standard',  // 'standard' | 'quick'
  quoteSequence: 1,
  savedJobId: null,
  quoteSaveError: null,
  critiqueNotes: null,
  transcript: null,         // Whisper transcript from video walkthrough
  quoteSaveErrorKey: 0,
  rams: null,
  retryCount: 0,
  statusModal: { open: false, jobId: null, targetStatus: null },
  recentJobs: [],
};

function buildDiffContext(reviewData) {
  if (!reviewData) return {};
  const measurements = reviewData.measurements || [];
  const heightM = measurements.find(m => /height/i.test(m.item));
  const lengthM = measurements.find(m => /length/i.test(m.item));
  return {
    stoneType: reviewData.stoneType || null,
    wallHeightMm: heightM ? parseInt(heightM.value, 10) || null : null,
    wallLengthMm: lengthM ? parseInt(lengthM.value, 10) || null : null,
    referenceCardUsed: !!reviewData.referenceCardDetected,
  };
}

export function reducer(state, action) {
  const newState = reducerCore(state, action);
  saveState(newState);
  return newState;
}

function reducerCore(state, action) {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step };

    case 'SET_CAPTURE_MODE':
      return { ...state, captureMode: action.payload };

    case 'VIDEO_PROGRESS':
      return { ...state, videoProgress: action.payload };

    case 'UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.payload };

    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.updates } };

    case 'UPDATE_JOB_DETAILS':
      return { ...state, jobDetails: { ...state.jobDetails, ...action.updates } };

    case 'SET_PHOTO':
      return {
        ...state,
        photos: { ...state.photos, [action.slot]: action.photo },
      };

    case 'ADD_EXTRA_PHOTO':
      return {
        ...state,
        extraPhotos: [...state.extraPhotos, action.photo],
      };

    case 'REMOVE_EXTRA_PHOTO':
      return {
        ...state,
        extraPhotos: state.extraPhotos.filter((_, i) => i !== action.index),
      };

    case 'ANALYSIS_START':
      return {
        ...state,
        isAnalysing: true,
        analysisError: null,
        videoProgress: null,
        uploadProgress: null,
        transcript: null,
        step: 3,
      };

    case 'ANALYSIS_SUCCESS': {
      const reviewData = action.normalised;
      const critiqueNotes = action.critiqueNotes || null;
      const transcript = action.transcript || null;

      if (state.quoteMode === 'quick') {
        // Auto-confirm all measurements
        const measurements = (reviewData.measurements || []).map(m => ({ ...m, confirmed: true }));
        const measurementDiffs = (reviewData.measurements || []).map(m =>
          buildDiff('measurement', m.item, m.aiValue, m.value)
        );

        // Build labour + material diffs (same as GENERATE_QUOTE)
        const labour = reviewData.labourEstimate || {};
        const extraDiffs = [];
        if (labour.aiEstimatedDays != null) {
          extraDiffs.push(buildDiff('labour_days', 'Estimated Days', labour.aiEstimatedDays, labour.estimatedDays));
        }
        (reviewData.materials || []).forEach(mat => {
          if (mat.aiUnitCost != null) {
            extraDiffs.push(buildDiff('material_unit_cost', mat.description, mat.aiUnitCost, mat.unitCost));
          }
          if (mat.aiQuantity != null) {
            extraDiffs.push(buildDiff('material_quantity', mat.description, mat.aiQuantity, mat.quantity));
          }
        });

        const quickDiffContext = buildDiffContext(reviewData);
        const allDiffs = [...measurementDiffs, ...extraDiffs].map(d => enrichDiffWithContext(d, quickDiffContext));
        const confirmedReviewData = { ...reviewData, measurements, aiRawResponse: action.rawResponse };
        const payload = buildQuotePayload(state.profile, state.jobDetails, confirmedReviewData, allDiffs);

        return {
          ...state,
          isAnalysing: false,
          aiRawResponse: action.rawResponse,
          reviewData: { ...reviewData, measurements },
          diffs: allDiffs,
          quotePayload: payload,
          critiqueNotes,
          transcript,
          step: 5,
        };
      }

      // Standard mode — unchanged
      return {
        ...state,
        isAnalysing: false,
        aiRawResponse: action.rawResponse,
        reviewData,
        critiqueNotes,
        transcript,
        step: 4,
      };
    }

    case 'ANALYSIS_CANCEL':
      return { ...state, isAnalysing: false, analysisError: null, videoProgress: null, uploadProgress: null, step: 2 };

    case 'ANALYSIS_ERROR':
      return {
        ...state,
        isAnalysing: false,
        analysisError: action.error,
        videoProgress: null,
        uploadProgress: null,
      };

    case 'CONFIRM_MEASUREMENT': {
      if (!state.reviewData) return state;
      const measurements = state.reviewData.measurements.map(m =>
        m.id === action.id
          ? { ...m, value: action.value, confirmed: true }
          : m
      );
      // Deduplicate: remove any existing diff for the same (fieldType, fieldLabel)
      const filteredDiffs = state.diffs.filter(
        d => !(d.fieldType === action.diff.fieldType && d.fieldLabel === action.diff.fieldLabel)
      );
      const enrichedDiff = enrichDiffWithContext(action.diff, buildDiffContext(state.reviewData));
      return {
        ...state,
        reviewData: { ...state.reviewData, measurements },
        diffs: [...filteredDiffs, enrichedDiff],
      };
    }

    case 'CONFIRM_ALL_MEASUREMENTS': {
      if (!state.reviewData) return state;
      const measurements = state.reviewData.measurements.map(m =>
        m.confirmed ? m : { ...m, confirmed: true }
      );
      // Build diffs for each newly confirmed measurement, deduplicating
      const newDiffs = state.reviewData.measurements
        .filter(m => !m.confirmed)
        .map(m => buildDiff('measurement', m.item, m.aiValue, m.value));
      // Remove existing diffs that match any new diff's (fieldType, fieldLabel)
      const newDiffKeys = new Set(newDiffs.map(d => `${d.fieldType}::${d.fieldLabel}`));
      const filteredDiffs = state.diffs.filter(
        d => !newDiffKeys.has(`${d.fieldType}::${d.fieldLabel}`)
      );
      return {
        ...state,
        reviewData: { ...state.reviewData, measurements },
        diffs: [...filteredDiffs, ...newDiffs],
      };
    }

    case 'EDIT_MEASUREMENT': {
      if (!state.reviewData) return state;
      const measurements = state.reviewData.measurements.map(m =>
        m.id === action.id
          ? { ...m, confirmed: false }
          : m
      );
      return {
        ...state,
        reviewData: { ...state.reviewData, measurements },
      };
    }

    case 'UPDATE_MATERIALS':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: { ...state.reviewData, materials: action.materials },
      };

    case 'UPDATE_LABOUR':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: {
          ...state.reviewData,
          labourEstimate: { ...state.reviewData.labourEstimate, ...action.labour },
        },
      };

    case 'UPDATE_ADDITIONAL_COSTS':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: { ...state.reviewData, additionalCosts: action.additionalCosts },
      };

    case 'UPDATE_SCHEDULE':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: { ...state.reviewData, scheduleOfWorks: action.schedule },
      };

    case 'UPDATE_DAMAGE_DESCRIPTION':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: { ...state.reviewData, damageDescription: action.value },
      };

    case 'RETRY_ANALYSIS':
      return {
        ...state,
        isAnalysing: true,
        analysisError: null,
        retryCount: (state.retryCount || 0) + 1,
      };

    case 'BACK_TO_REVIEW':
      return {
        ...state,
        step: 4,
        quotePayload: null,
        quoteMode: 'standard',
      };

    case 'UPDATE_NOTES':
      if (!state.reviewData) return state;
      return {
        ...state,
        reviewData: { ...state.reviewData, notes: action.notes },
      };

    case 'GENERATE_QUOTE': {
      if (!state.reviewData) return state;
      // Generate labour diff
      const labour = state.reviewData.labourEstimate || {};
      const extraDiffs = [];
      if (labour.aiEstimatedDays != null) {
        extraDiffs.push(buildDiff('labour_days', 'Estimated Days', labour.aiEstimatedDays, labour.estimatedDays));
      }
      // Generate material diffs (unit cost + quantity)
      (state.reviewData.materials || []).forEach(mat => {
        if (mat.aiUnitCost != null) {
          extraDiffs.push(buildDiff('material_unit_cost', mat.description, mat.aiUnitCost, mat.unitCost));
        }
        if (mat.aiQuantity != null) {
          extraDiffs.push(buildDiff('material_quantity', mat.description, mat.aiQuantity, mat.quantity));
        }
      });

      // Deduplicate: remove existing labour/material diffs before appending fresh ones
      const extraDiffKeys = new Set(extraDiffs.map(d => `${d.fieldType}::${d.fieldLabel}`));
      const baseDiffs = state.diffs.filter(d => !extraDiffKeys.has(`${d.fieldType}::${d.fieldLabel}`));
      const diffContext = buildDiffContext(state.reviewData);
      const allDiffs = [...baseDiffs, ...extraDiffs].map(d => enrichDiffWithContext(d, diffContext));
      const reviewDataWithRaw = {
        ...state.reviewData,
        aiRawResponse: state.aiRawResponse,
      };
      const payload = buildQuotePayload(
        state.profile,
        state.jobDetails,
        reviewDataWithRaw,
        allDiffs
      );
      console.log('FastQuote Payload:', JSON.stringify(payload, null, 2));
      return {
        ...state,
        diffs: allDiffs,
        quotePayload: payload,
        step: 5,
      };
    }

    case 'NEW_QUOTE': {
      const nextSeq = state.quoteSequence + 1;
      const year = new Date().getFullYear();
      return {
        ...state,
        captureMode: null,
        videoProgress: null,
        uploadProgress: null,
        quoteMode: action.mode || 'standard',
        step: 2,
        jobDetails: {
          clientName: '',
          siteAddress: '',
          quoteReference: `QT-${year}-${String(nextSeq).padStart(4, '0')}`,
          quoteDate: new Date().toISOString().split('T')[0],
          briefNotes: '',
        },
        photos: {
          overview: null,
          closeup: null,
          sideProfile: null,
          referenceCard: null,
          access: null,
        },
        extraPhotos: [],
        isAnalysing: false,
        analysisError: null,
        aiRawResponse: null,
        reviewData: null,
        diffs: [],
        quotePayload: null,
        quoteSequence: nextSeq,
        savedJobId: null,
        quoteSaveError: null,
        critiqueNotes: null,
        transcript: null,
        quoteSaveErrorKey: 0,
        retryCount: 0,
        rams: null,
      };
    }

    case 'RESTORE_DRAFT': {
      // Restore job data from draft but preserve current profile (DB is source of truth)
      // Also protect auth-critical fields from being overwritten by untrusted draft data
      const {
        profile: _draftProfile,
        currentUserId: _draftUserId,
        currentUser: _draftUser,
        allUsers: _draftAllUsers,
        initComplete: _draftInit,
        ...draftData
      } = action.draft;
      return {
        ...state,
        ...draftData,
        quoteMode: action.draft.quoteMode || 'standard',
        isAnalysing: false,
        analysisError: null,
        quotePayload: null,
        videoProgress: null,
        uploadProgress: null,
      };
    }

    case 'RESTORE_PHOTOS': {
      return {
        ...state,
        photos: action.photos ?? state.photos,
        extraPhotos: action.extraPhotos ?? state.extraPhotos,
      };
    }

    case 'CREATE_RAMS': {
      const { profile, jobDetails, photos, extraPhotos = [] } = state;
      // Collect photos
      const ramsPhotos = [];
      if (photos.overview) ramsPhotos.push({ label: 'Overview', data: photos.overview.data });
      if (photos.closeup) ramsPhotos.push({ label: 'Close-up', data: photos.closeup.data });
      if (photos.sideProfile) ramsPhotos.push({ label: 'Side Profile', data: photos.sideProfile.data });
      if (photos.access) ramsPhotos.push({ label: 'Access & Approach', data: photos.access.data });
      extraPhotos.forEach((p, i) => {
        ramsPhotos.push({ label: p.label || `Extra ${i + 1}`, data: p.data });
      });

      return {
        ...state,
        rams: {
          id: generateRamsId(),
          status: 'draft',
          jobNumber: jobDetails.quoteReference || '',
          siteAddress: jobDetails.siteAddress || '',
          company: profile.companyName || '',
          client: jobDetails.clientName || '',
          foreman: profile.fullName || '',
          documentDate: new Date().toISOString().split('T')[0],
          commencementDate: '',
          projectedCompletionDate: '',
          workTypes: [],
          workStages: [],
          methodDescription: '',
          riskAssessments: DEFAULT_RISK_ASSESSMENTS.map(ra => ({ ...ra, existingControls: [...ra.existingControls] })),
          ppeRequirements: COMMON_PPE.filter(p => p.defaultSelected).map(p => p.id),
          employeesOnJob: [],
          communicatedEmployees: [],
          contactTitle: COMPANY_DEFAULTS.contactTitle || '',
          contactName: profile.fullName || '',
          contactNumber: profile.phone || '',
          workplaceAccess: COMPANY_DEFAULTS.workplaceAccess || '',
          workplaceLighting: COMPANY_DEFAULTS.workplaceLighting || '',
          specialControlMeasures: '',
          wasteManagement: COMPANY_DEFAULTS.wasteManagement || '',
          hazardousMaterials: COMPANY_DEFAULTS.hazardousMaterials || '',
          photos: ramsPhotos,
        },
      };
    }

    case 'UPDATE_RAMS':
      if (!state.rams) return state;
      return {
        ...state,
        rams: { ...state.rams, ...action.updates },
      };

    case 'SET_RAMS_WORK_TYPES': {
      if (!state.rams) return state;
      const workTypes = action.workTypes;
      const workStages = [];
      workTypes.forEach(wt => {
        const template = WORK_STAGES_TEMPLATES[wt];
        if (template) {
          workStages.push(...template.map(s => ({ type: wt, stage: s })));
        }
      });
      return {
        ...state,
        rams: { ...state.rams, workTypes, workStages },
      };
    }

    case 'ADD_RAMS_RISK': {
      if (!state.rams) return state;
      return {
        ...state,
        rams: {
          ...state.rams,
          riskAssessments: [...state.rams.riskAssessments, action.risk],
        },
      };
    }

    case 'UPDATE_RAMS_RISK': {
      if (!state.rams) return state;
      const riskAssessments = state.rams.riskAssessments.map(ra =>
        ra.id === action.id
          ? {
              ...ra,
              ...action.updates,
              riskRating: calculateRiskRating(
                action.updates.likelihood ?? ra.likelihood,
                action.updates.consequence ?? ra.consequence
              ),
            }
          : ra
      );
      return {
        ...state,
        rams: { ...state.rams, riskAssessments },
      };
    }

    case 'REMOVE_RAMS_RISK': {
      if (!state.rams) return state;
      return {
        ...state,
        rams: {
          ...state.rams,
          riskAssessments: state.rams.riskAssessments.filter(ra => ra.id !== action.id),
        },
      };
    }

    case 'CLEAR_RAMS':
      return { ...state, rams: null };

    case 'RESTORE_RAMS':
      return { ...state, rams: action.rams };

    case 'OPEN_STATUS_MODAL':
      return { ...state, statusModal: { open: true, jobId: action.jobId, targetStatus: action.targetStatus } };

    case 'CLOSE_STATUS_MODAL':
      return { ...state, statusModal: { open: false, jobId: null, targetStatus: null } };

    case 'JOBS_UPDATED':
      return { ...state, recentJobs: action.jobs };

    case 'DELETE_JOB':
      return { ...state, recentJobs: state.recentJobs.filter(j => j.id !== action.id) };

    case 'INIT_COMPLETE': {
      // Post-OAuth init: the server has told us who the current user is.
      // `action.user` has { id, name, email, avatarUrl, plan, profileComplete }
      if (!action.user) {
        return { ...state, initComplete: true };
      }
      return {
        ...state,
        initComplete: true,
        currentUserId: action.user.id,
        currentUser: action.user,
        allUsers: [action.user], // single-user list; UserSwitcher no longer needed
      };
    }

    case 'SELECT_USER':
      return {
        ...state,
        currentUserId: action.userId,
        currentUser: { ...state.currentUser, id: action.userId, name: action.name },
        profile: action.profile ? { ...state.profile, ...action.profile } : state.profile,
        quoteSequence: action.quoteSequence || state.quoteSequence,
      };

    case 'QUOTE_SAVED':
      return {
        ...state,
        savedJobId: action.jobId,
        quoteSaveError: null,
      };

    case 'QUOTE_SAVE_FAILED':
      return {
        ...state,
        quoteSaveError: action.error || 'Save failed. Your work is preserved in this tab.',
        quoteSaveErrorKey: (state.quoteSaveErrorKey || 0) + 1,
      };

    case 'SWITCH_USER':
      return {
        ...initialState,
        allUsers: state.allUsers,
        initComplete: true,
        currentUserId: action.userId,
        currentUser: { id: action.userId, name: action.name },
        profile: action.profile ? { ...initialState.profile, ...action.profile } : initialState.profile,
        quoteSequence: action.quoteSequence || 1,
      };

    default:
      return state;
  }
}
