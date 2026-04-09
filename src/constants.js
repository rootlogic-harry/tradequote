export const TRADE_TYPE = 'Dry Stone Walling';

export const DEFAULT_DAY_RATE = 400;

export const STEPS = [
  { number: 1, label: 'Profile' },
  { number: 2, label: 'Job Details' },
  { number: 3, label: 'Analysis' },
  { number: 4, label: 'Review & Edit' },
  { number: 5, label: 'Quote' },
];

export const LOADING_MESSAGES = [
  'Analysing photographs...',
  'Identifying damage and stone type...',
  'Calculating measurements...',
  'Estimating stone tonnage and materials...',
  'Building schedule of works...',
  'Preparing your quote...',
];

export const PHOTO_SLOTS = [
  { key: 'overview', label: 'Overview', instruction: 'Full damaged section, straight on, landscape orientation', required: true },
  { key: 'closeup', label: 'Close-up', instruction: 'Worst damage area — show the collapse and scattered stone', required: true },
  { key: 'sideProfile', label: 'Side Profile', instruction: 'Shoot along the wall face to show height, batter angle, and condition of standing sections', required: false },
  { key: 'referenceCard', label: 'Reference Card', instruction: 'Place your TradeQuote Reference Card flat against the wall face and photograph it clearly', required: true },
  { key: 'access', label: 'Access & Approach', instruction: 'The road, gate, or field approach — helps estimate travel and access difficulty', required: false },
];

export const VALID_STONE_TYPES = ['sandstone', 'gritstone', 'limestone', 'slate', 'unknown'];

export const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
