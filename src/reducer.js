import { DEFAULT_DAY_RATE } from './constants.js';
import { buildQuotePayload } from './utils/quoteBuilder.js';
import { buildDiff } from './utils/diffTracking.js';

const STORAGE_KEY = 'tq_state';

function saveState(state) {
  try {
    // Don't persist transient loading state
    const toSave = { ...state, isAnalysing: false, analysisError: null };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded — ignore */ }
}

function loadState() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch { return null; }
}

export function getInitialState() {
  const saved = loadState();
  if (saved) {
    // Backfill API key from env if session state has it empty
    const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY || '';
    if (!saved.profile?.apiKey && envKey) {
      saved.profile = { ...saved.profile, apiKey: envKey };
    }
    return saved;
  }
  return initialState;
}

export const initialState = {
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
    accreditations: 'DSWA Professional Member',
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY || '',
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
  quoteSequence: 1,
};

export function reducer(state, action) {
  const newState = reducerCore(state, action);
  saveState(newState);
  return newState;
}

function reducerCore(state, action) {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step };

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
        step: 3,
      };

    case 'ANALYSIS_SUCCESS':
      return {
        ...state,
        isAnalysing: false,
        aiRawResponse: action.rawResponse,
        reviewData: action.normalised,
        step: 4,
      };

    case 'ANALYSIS_ERROR':
      return {
        ...state,
        isAnalysing: false,
        analysisError: action.error,
      };

    case 'CONFIRM_MEASUREMENT': {
      const measurements = state.reviewData.measurements.map(m =>
        m.id === action.id
          ? { ...m, value: action.value, confirmed: true }
          : m
      );
      return {
        ...state,
        reviewData: { ...state.reviewData, measurements },
        diffs: [...state.diffs, action.diff],
      };
    }

    case 'EDIT_MEASUREMENT': {
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
      return {
        ...state,
        reviewData: { ...state.reviewData, materials: action.materials },
      };

    case 'UPDATE_LABOUR':
      return {
        ...state,
        reviewData: {
          ...state.reviewData,
          labourEstimate: { ...state.reviewData.labourEstimate, ...action.labour },
        },
      };

    case 'UPDATE_ADDITIONAL_COSTS':
      return {
        ...state,
        reviewData: { ...state.reviewData, additionalCosts: action.additionalCosts },
      };

    case 'UPDATE_SCHEDULE':
      return {
        ...state,
        reviewData: { ...state.reviewData, scheduleOfWorks: action.schedule },
      };

    case 'UPDATE_DAMAGE_DESCRIPTION':
      return {
        ...state,
        reviewData: { ...state.reviewData, damageDescription: action.value },
      };

    case 'GENERATE_QUOTE': {
      // Generate labour diff
      const labour = state.reviewData.labourEstimate;
      const extraDiffs = [];
      if (labour.aiEstimatedDays != null) {
        extraDiffs.push(buildDiff('labour_days', 'Estimated Days', labour.aiEstimatedDays, labour.estimatedDays));
      }
      // Generate material diffs
      (state.reviewData.materials || []).forEach(mat => {
        if (mat.aiUnitCost != null) {
          extraDiffs.push(buildDiff('material_unit_cost', mat.description, mat.aiUnitCost, mat.unitCost));
        }
      });

      const allDiffs = [...state.diffs, ...extraDiffs];
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
      console.log('TradeQuote Payload:', JSON.stringify(payload, null, 2));
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
      };
    }

    case 'RESTORE_DRAFT': {
      return {
        ...state,
        ...action.draft,
        isAnalysing: false,
        analysisError: null,
        quotePayload: null,
      };
    }

    default:
      return state;
  }
}
