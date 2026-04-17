import OpenAI, { toFile } from 'openai';

// Lazy-init: avoid throwing at module load if OPENAI_API_KEY is not yet set
let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export const TRADE_PROMPT =
  'Dry stone walling job description. Common terms: ' +
  'gritstone, sandstone, limestone, slate, granite, hearting, through-stones, ' +
  'cope stones, copestones, coping, pinnings, batter, wallhead, lime mortar, ' +
  'dry-laid, foundation trench, ha-ha, field wall, retaining wall, coursed, ' +
  'random rubble, galleting, boundary wall, garden wall, dyke, single-face, ' +
  'double-face, dressed, undressed, weathered, quarried, reclaimed.';

/**
 * Extract a clean file extension from a MIME type, stripping codec params.
 * e.g. 'audio/webm;codecs=opus' → 'webm', 'audio/mp4' → 'mp4'
 */
function extFromMime(mimeType) {
  const subtype = (mimeType || '').split('/')[1] || 'webm';
  return subtype.split(';')[0];
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * @param {Buffer} buffer - raw audio bytes
 * @param {string} mimeType - e.g. 'audio/webm', 'audio/mp4'
 * @returns {Promise<string>} trimmed transcript text
 */
export async function transcribe(buffer, mimeType) {
  const ext = extFromMime(mimeType);
  // Use the SDK's toFile() helper — works across all Node versions
  // (the browser-only File constructor is not reliably available in Node)
  const file = await toFile(buffer, `dictation.${ext}`, { type: mimeType });

  const res = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    prompt: TRADE_PROMPT,
    language: 'en',
    response_format: 'json',
  });

  return res.text.trim();
}
