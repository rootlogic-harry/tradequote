import { PHOTO_SLOTS } from '../constants.js';
import { parseAIResponse, validateAIResponse, normalizeAIResponse } from './aiParser.js';

export async function runAnalysis({ photos, extraPhotos, jobDetails, profile, abortRef, dispatch, userId }) {
  try {
    const imageContent = [];
    for (const slot of PHOTO_SLOTS) {
      const photo = photos[slot.key];
      if (photo) {
        imageContent.push({
          type: 'text',
          text: `--- Photo: ${slot.label} ---`,
        });
        const base64Data = photo.data.split(',')[1];
        imageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: base64Data,
          },
        });
      }
    }

    for (let i = 0; i < extraPhotos.length; i++) {
      imageContent.push({
        type: 'text',
        text: `--- Additional Photo ${i + 1} ---`,
      });
      const base64Data = extraPhotos[i].data.split(',')[1];
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Data,
        },
      });
    }

    imageContent.push({
      type: 'text',
      text: `Site address: ${jobDetails.siteAddress}${jobDetails.briefNotes ? `\nTradesman notes: ${jobDetails.briefNotes}` : ''}`,
    });

    const controller = new AbortController();
    if (abortRef) abortRef.current = controller;
    // 5 minutes — analysis + self-critique takes longer than single call
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    // Use server-side analyse endpoint (includes self-critique) when userId is available,
    // fall back to direct proxy for backward compatibility
    const endpoint = userId
      ? `/api/users/${userId}/analyse`
      : '/api/anthropic/messages';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: imageContent,
          },
        ],
        briefNotes: jobDetails.briefNotes || '',
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      let friendlyMessage;
      try {
        const errJson = JSON.parse(errText);
        const errorType = errJson?.error?.type;
        if (response.status === 529 || errorType === 'overloaded_error') {
          friendlyMessage = 'The service is temporarily overloaded. Please wait a moment and retry.';
        } else if (errorType === 'rate_limit_error' || response.status === 429) {
          friendlyMessage = 'Rate limit reached — please wait a minute before retrying.';
        } else if (errorType === 'authentication_error') {
          friendlyMessage = 'API authentication failed — contact support to check the API key.';
        } else if (errorType === 'invalid_request_error') {
          friendlyMessage = errJson?.error?.message || 'Invalid request sent to the service.';
        } else if (response.status >= 500) {
          friendlyMessage = 'The service is temporarily unavailable. Please retry in a moment.';
        } else {
          friendlyMessage = errJson?.error?.message || errJson?.error || `API error (${response.status})`;
        }
      } catch {
        friendlyMessage = response.status >= 500
          ? 'The service is temporarily unavailable. Please retry in a moment.'
          : `API error (${response.status}). Please retry.`;
      }
      throw new Error(friendlyMessage);
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';
    const parsed = parseAIResponse(rawText);

    if (!parsed) {
      dispatch({
        type: 'ANALYSIS_ERROR',
        error: 'Analysis returned an unreadable response. Try again or enter details manually.',
      });
      return;
    }

    const validation = validateAIResponse(parsed);
    if (!validation.valid) {
      console.warn('AI response validation warnings:', validation.errors);
    }

    const normalised = normalizeAIResponse(parsed);
    normalised.referenceCardDetected = parsed.referenceCardDetected;
    normalised.stoneType = parsed.stoneType;
    normalised.additionalCosts = [];
    normalised.labourEstimate.dayRate = profile.dayRate;

    dispatch({
      type: 'ANALYSIS_SUCCESS',
      rawResponse: rawText,
      normalised,
      critiqueNotes: data.critiqueNotes || null,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      dispatch({
        type: 'ANALYSIS_ERROR',
        error: 'Analysis timed out — the analysis is taking longer than expected. Try again with fewer photos, or retry.',
      });
      return;
    }
    let errorMessage;
    if (err instanceof TypeError) {
      errorMessage = 'Network error — check your internet connection and try again.';
    } else {
      errorMessage = err.message;
    }
    dispatch({
      type: 'ANALYSIS_ERROR',
      error: errorMessage,
    });
  }
}
