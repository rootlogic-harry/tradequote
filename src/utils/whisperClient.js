import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const TRADE_PROMPT =
  'Dry stone walling job description. Common terms: ' +
  'gritstone, sandstone, limestone, slate, granite, hearting, through-stones, ' +
  'cope stones, copestones, coping, pinnings, batter, wallhead, lime mortar, ' +
  'dry-laid, foundation trench, ha-ha, field wall, retaining wall, coursed, ' +
  'random rubble, galleting, boundary wall, garden wall, dyke, single-face, ' +
  'double-face, dressed, undressed, weathered, quarried, reclaimed.';

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * @param {Buffer} buffer - raw audio bytes
 * @param {string} mimeType - e.g. 'audio/webm', 'audio/mp4'
 * @returns {Promise<string>} trimmed transcript text
 */
export async function transcribe(buffer, mimeType) {
  const ext = mimeType.split('/')[1] || 'webm';
  const file = new File([buffer], `dictation.${ext}`, { type: mimeType });

  const res = await client.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    prompt: TRADE_PROMPT,
    language: 'en',
    response_format: 'json',
  });

  return res.text.trim();
}
