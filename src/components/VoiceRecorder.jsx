import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  MAX_DURATION_MS,
  WARNING_THRESHOLD_MS,
  SLOW_PROCESSING_MS,
  VOICE_STATES,
  buildInsertedText,
  isSegmentEdited,
  applyRemoval,
  formatTime,
} from '../utils/voiceRecorderHelpers.js';

// ── Capability detection ──

function isRecordingSupported() {
  return typeof window !== 'undefined' &&
    navigator?.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined';
}

function getPreferredMimeType() {
  if (typeof window === 'undefined') return 'audio/webm';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of types) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return 'audio/webm'; // fallback
}

// ── Component ──

export default function VoiceRecorder({
  value = '',
  onUpdateText,
  currentUserId,
  disabled = false,
}) {
  const [voiceState, setVoiceState] = useState(
    isRecordingSupported() ? VOICE_STATES.IDLE : VOICE_STATES.UNSUPPORTED
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [slowProcessing, setSlowProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [mode, setMode] = useState(null);             // null | 'managed' | 'append-only'
  const [segments, setSegments] = useState([]);        // [{ text, edited }]
  const [hasTypedSinceInsert, setHasTypedSinceInsert] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pendingModalAction, setPendingModalAction] = useState(null); // 'replace' | 'append'

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const processingTimerRef = useRef(null);
  const preRecordValueRef = useRef('');
  const streamRef = useRef(null);

  // Track whether user has typed since last insertion
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (voiceState === VOICE_STATES.SUCCESS && value !== prevValueRef.current) {
      setHasTypedSinceInsert(true);
    }
    prevValueRef.current = value;
  }, [value, voiceState]);

  // Update segment edit status when value changes
  useEffect(() => {
    if (segments.length === 0) return;
    setSegments(prev =>
      prev.map(seg =>
        seg.edited ? seg : { ...seg, edited: isSegmentEdited(seg.text, value) }
      )
    );
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording(true);
      clearInterval(timerRef.current);
      clearTimeout(processingTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Recording control ──

  const startRecording = useCallback(async () => {
    setErrorMessage('');
    chunksRef.current = [];
    preRecordValueRef.current = value;
    setElapsedMs(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = getPreferredMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => handleRecordingComplete();
      recorder.start(1000); // collect chunks every 1s
      setVoiceState(VOICE_STATES.RECORDING);

      // Elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setElapsedMs(elapsed);

        if (elapsed >= MAX_DURATION_MS) {
          stopRecording();
        } else if (elapsed >= WARNING_THRESHOLD_MS) {
          setVoiceState(VOICE_STATES.WARNING);
        }
      }, 250);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setVoiceState(VOICE_STATES.PERMISSION_DENIED);
      } else {
        setVoiceState(VOICE_STATES.ERROR);
        setErrorMessage('Could not access microphone. Please check your device settings.');
      }
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback((discard = false) => {
    clearInterval(timerRef.current);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (discard) {
        // Override onstop to prevent transcription
        mediaRecorderRef.current.onstop = () => {};
      }
      mediaRecorderRef.current.stop();
    }

    // Stop all audio tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Transcription ──

  const handleRecordingComplete = useCallback(async () => {
    if (chunksRef.current.length === 0) {
      setVoiceState(VOICE_STATES.ERROR);
      setErrorMessage('No audio was captured. Please try again.');
      return;
    }

    setVoiceState(VOICE_STATES.PROCESSING);
    setSlowProcessing(false);
    processingTimerRef.current = setTimeout(
      () => setSlowProcessing(true),
      SLOW_PROCESSING_MS
    );

    const blob = new Blob(chunksRef.current, { type: getPreferredMimeType() });
    const formData = new FormData();
    formData.append('audio', blob, 'dictation.webm');

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/dictate', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error ${res.status}`);
        }

        const data = await res.json();
        clearTimeout(processingTimerRef.current);

        if (!data.text || data.text.trim() === '') {
          setVoiceState(VOICE_STATES.ERROR);
          setErrorMessage("Couldn't make out any words. Try speaking more clearly or move to a quieter spot.");
          return;
        }

        handleTranscriptSuccess(data.text.trim());
        return;
      } catch (err) {
        lastError = err;
        if (attempt === 0) continue; // silent retry
      }
    }

    // Both attempts failed
    clearTimeout(processingTimerRef.current);
    setVoiceState(VOICE_STATES.ERROR);
    setErrorMessage("Couldn't transcribe that recording. Please try again or type your notes instead.");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTranscriptSuccess = useCallback((transcript) => {
    const currentValue = prevValueRef.current; // latest textarea value
    const preRecording = preRecordValueRef.current;

    let newText;
    if (pendingModalAction === 'replace' && segments.length > 0) {
      // Replace: remove last unedited segment, then insert new
      const lastUnedited = [...segments].reverse().find(s => !s.edited);
      let base = currentValue;
      if (lastUnedited) {
        base = applyRemoval(currentValue, [lastUnedited]);
      }
      newText = buildInsertedText(base, transcript, base);
      setSegments(prev => [
        ...prev.filter(s => s !== lastUnedited),
        { text: transcript, edited: false },
      ]);
    } else {
      // Normal insert or append
      newText = buildInsertedText(preRecording, transcript, currentValue);
      setSegments(prev => [...prev, { text: transcript, edited: false }]);
    }

    onUpdateText(newText);
    setVoiceState(VOICE_STATES.SUCCESS);
    setHasTypedSinceInsert(false);
    setPendingModalAction(null);

    if (mode === null) {
      setMode('managed');
    }
  }, [segments, mode, onUpdateText, pendingModalAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-record & Remove ──

  const handleRecordAgain = useCallback(() => {
    if (mode === 'append-only' || !hasTypedSinceInsert) {
      // Direct re-record (no modal)
      if (mode === 'managed' && !hasTypedSinceInsert) {
        setPendingModalAction('replace');
      }
      startRecording();
    } else {
      // Show modal
      setShowModal(true);
    }
  }, [mode, hasTypedSinceInsert, startRecording]);

  const handleModalChoice = useCallback((choice) => {
    setShowModal(false);
    if (choice === 'cancel') return;

    if (choice === 'replace') {
      setPendingModalAction('replace');
      startRecording();
    } else if (choice === 'append') {
      setMode('append-only');
      setPendingModalAction(null);
      startRecording();
    }
  }, [startRecording]);

  const handleRemoveRecording = useCallback(() => {
    const newText = applyRemoval(value, segments);
    onUpdateText(newText);

    // Reset to idle if nothing remains
    const remaining = segments.filter(s => s.edited);
    setSegments(remaining);
    if (remaining.length === 0) {
      setVoiceState(VOICE_STATES.IDLE);
      setMode(null);
    }
    setHasTypedSinceInsert(false);
  }, [value, segments, onUpdateText]);

  const remainingSeconds = () => Math.max(0, Math.ceil((MAX_DURATION_MS - elapsedMs) / 1000));

  // ── Render ──

  if (voiceState === VOICE_STATES.UNSUPPORTED) {
    return (
      <button
        disabled
        className="w-full rounded px-4 py-3 text-sm font-heading uppercase tracking-wide mb-2"
        style={{
          backgroundColor: 'var(--tq-card)',
          border: '1px solid var(--tq-border)',
          color: 'var(--tq-muted)',
          opacity: 0.5,
          minHeight: 48,
        }}
      >
        Voice recording not supported on this device
      </button>
    );
  }

  return (
    <div className="mb-2">
      {/* Main control row */}
      <div className="flex gap-2">
        {/* Primary button */}
        {voiceState === VOICE_STATES.IDLE && (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="flex-1 rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: 'var(--tq-accent)',
              color: '#ffffff',
              minHeight: 48,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            Tap to record job details
          </button>
        )}

        {(voiceState === VOICE_STATES.RECORDING || voiceState === VOICE_STATES.WARNING) && (
          <button
            onClick={() => stopRecording()}
            className="flex-1 rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-colors flex items-center justify-center gap-2"
            style={{
              backgroundColor: voiceState === VOICE_STATES.WARNING ? '#991b1b' : '#dc2626',
              color: '#ffffff',
              minHeight: 48,
            }}
          >
            <span
              className="inline-block w-3 h-3 rounded-full animate-pulse"
              style={{ backgroundColor: '#ffffff' }}
            />
            {voiceState === VOICE_STATES.WARNING
              ? `Recording\u2026 ${formatTime(elapsedMs)} (${remainingSeconds()}s left)`
              : `Recording\u2026 ${formatTime(elapsedMs)}`}
          </button>
        )}

        {voiceState === VOICE_STATES.PROCESSING && (
          <button
            disabled
            className="flex-1 rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide flex items-center justify-center gap-2"
            style={{
              backgroundColor: 'var(--tq-card)',
              border: '1px solid var(--tq-border)',
              color: 'var(--tq-muted)',
              minHeight: 48,
            }}
          >
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {slowProcessing ? 'Still transcribing\u2026' : 'Transcribing\u2026'}
          </button>
        )}

        {voiceState === VOICE_STATES.SUCCESS && (
          <>
            <button
              onClick={handleRecordAgain}
              disabled={disabled}
              className="flex-1 rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-colors"
              style={{
                backgroundColor: 'var(--tq-accent)',
                color: '#ffffff',
                minHeight: 48,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              Record again
            </button>
            <button
              onClick={handleRemoveRecording}
              className="rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-colors"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid rgba(248, 113, 113, 0.4)',
                color: '#f87171',
                minHeight: 48,
              }}
            >
              Remove recording
            </button>
          </>
        )}

        {voiceState === VOICE_STATES.ERROR && (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="flex-1 rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: 'var(--tq-accent)',
              color: '#ffffff',
              minHeight: 48,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            Tap to record job details
          </button>
        )}

        {voiceState === VOICE_STATES.PERMISSION_DENIED && (
          <button
            disabled
            className="flex-1 rounded px-4 py-3 text-sm font-heading uppercase tracking-wide"
            style={{
              backgroundColor: 'var(--tq-card)',
              border: '1px solid var(--tq-border)',
              color: 'var(--tq-muted)',
              minHeight: 48,
            }}
          >
            Tap to record job details
          </button>
        )}
      </div>

      {/* Status messages */}
      {voiceState === VOICE_STATES.SUCCESS && (
        <p className="text-xs mt-2" style={{ color: 'var(--tq-muted)' }}>
          Recorded notes added
        </p>
      )}

      {voiceState === VOICE_STATES.ERROR && errorMessage && (
        <p className="text-xs mt-2" style={{ color: '#f87171' }}>
          {errorMessage}
        </p>
      )}

      {voiceState === VOICE_STATES.PERMISSION_DENIED && (
        <div className="text-xs mt-2" style={{ color: '#fbbf24' }}>
          <p>Microphone access is blocked. Enable it in your browser settings to record job details.</p>
          <a
            href="https://support.google.com/chrome/answer/2693767"
            target="_blank"
            rel="noopener noreferrer"
            className="underline mt-1 inline-block"
            style={{ color: 'var(--tq-accent)' }}
          >
            How to enable microphone
          </a>
        </div>
      )}

      {/* Re-record modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => handleModalChoice('cancel')}
        >
          <div
            className="p-6 max-w-sm mx-4"
            style={{
              backgroundColor: 'var(--tq-card)',
              border: '1px solid var(--tq-border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading font-bold text-base mb-4" style={{ color: 'var(--tq-text)' }}>
              You've edited your notes since recording
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleModalChoice('replace')}
                className="w-full rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'var(--tq-accent)',
                  color: '#ffffff',
                  minHeight: 44,
                }}
              >
                Replace previous recording
              </button>
              <button
                onClick={() => handleModalChoice('append')}
                className="w-full rounded px-4 py-3 text-sm font-heading font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'var(--tq-surface)',
                  color: 'var(--tq-text)',
                  border: '1px solid var(--tq-border)',
                  minHeight: 44,
                }}
              >
                Add to notes
              </button>
              <button
                onClick={() => handleModalChoice('cancel')}
                className="w-full rounded px-4 py-3 text-sm font-heading uppercase tracking-wide"
                style={{
                  color: 'var(--tq-muted)',
                  minHeight: 44,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
