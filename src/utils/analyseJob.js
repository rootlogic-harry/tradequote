import { PHOTO_SLOTS } from '../constants.js';
import { parseAIResponse, validateAIResponse, normalizeAIResponse } from './aiParser.js';

export async function runAnalysis({ photos, extraPhotos, jobDetails, profile, systemPrompt, abortRef, dispatch }) {
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
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('/api/anthropic/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: imageContent,
          },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';
    const parsed = parseAIResponse(rawText);

    if (!parsed) {
      dispatch({
        type: 'ANALYSIS_ERROR',
        error: 'AI returned an unreadable response. Try again or enter details manually.',
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
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      dispatch({ type: 'ANALYSIS_CANCEL' });
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
