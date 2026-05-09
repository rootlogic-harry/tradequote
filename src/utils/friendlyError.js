/**
 * Classify a server-side error into a HTTP status + user-facing message
 * that explains both what went wrong and what the user can try next.
 *
 * Returns null for unmapped errors — callers should fall back to
 * safeError() so the original stack still gets logged and the client
 * gets the existing generic 500 message.
 *
 * Used by the video upload route and the photo /analyse route to
 * replace the previous "Something went wrong" 500 catch-all.
 */
export function classifyAnalysisError(err) {
  const msg = err?.message || '';
  const code = err?.code || '';

  // Exact-string contracts that pre-date this helper. These messages
  // are already user-friendly and the route returned them as 400 before;
  // preserve the contract so existing UI keeps working.
  if (msg === 'Video must be under 3 minutes' || msg === 'Video appears to be empty') {
    return { status: 400, message: msg };
  }

  // Multer field-value limit. Profile JSON ships embedded with a logo
  // data URL, and the default 1MB fieldSize blew up Paul's upload.
  if (code === 'LIMIT_FIELD_VALUE' || /Field value too long/i.test(msg)) {
    return {
      status: 413,
      message: 'Your profile data is too large to send with the video. Replace your saved logo with a smaller image (under 2MB) in profile settings, then try again.',
    };
  }

  // Multer file-size limit (500MB cap on video upload).
  if (code === 'LIMIT_FILE_SIZE') {
    return {
      status: 413,
      message: 'This video file is too large to upload (over 500MB). Try a shorter clip or record at a lower resolution.',
    };
  }

  // OpenAI Whisper rejected the audio it was given.
  if (/Invalid file format/i.test(msg) && /Supported formats/i.test(msg)) {
    return {
      status: 422,
      message: "We couldn't read the audio in this video. Try a different recording, or upload photos instead.",
    };
  }

  // Whisper key not configured on the server.
  if (/OPENAI_API_KEY/i.test(msg)) {
    return {
      status: 503,
      message: 'Voice transcription is temporarily unavailable. You can still upload photos to generate a quote.',
    };
  }

  // Anthropic API errors. callAnthropicRaw rejects with messages like
  // "Anthropic API error (429): {...}" — pull the status out where we can.
  if (/Anthropic API error/i.test(msg) || /ANTHROPIC_API_KEY/i.test(msg)) {
    if (/\b(429|rate.?limit)\b/i.test(msg)) {
      return {
        status: 429,
        message: "We're handling more analyses than usual right now. Please wait a moment and try again.",
      };
    }
    if (/\b(529|overloaded)\b/i.test(msg)) {
      return {
        status: 503,
        message: 'Our AI service is temporarily overloaded. Please try again in a minute or two.',
      };
    }
    return {
      status: 503,
      message: 'Our AI service is briefly unavailable. Please try again in a moment.',
    };
  }

  // Local ffmpeg failures: codec, container, or conversion errors.
  if (/ffmpeg/i.test(msg) || /Conversion failed/i.test(msg) || /Invalid data found/i.test(msg)) {
    return {
      status: 422,
      message: "We couldn't process this video format. Try recording with a different camera app, or upload photos instead.",
    };
  }

  // Unparseable analysis JSON from upstream — kept as a hint that the
  // user can simply retry; transient model failures are common.
  if (/unreadable response/i.test(msg) || /unparseable/i.test(msg)) {
    return {
      status: 502,
      message: "The analysis came back garbled. Please try again — this usually clears on a second attempt.",
    };
  }

  return null;
}
