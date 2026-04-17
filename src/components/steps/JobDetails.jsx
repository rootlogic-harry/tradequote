import React, { useState, useRef } from 'react';
import { PHOTO_SLOTS } from '../../constants.js';
import { validateJobDetails, validateRequiredPhotoSlots } from '../../utils/validators.js';
import { runAnalysis } from '../../utils/analyseJob.js';
import { savePhoto, deletePhoto, saveDraft } from '../../utils/userDB.js';
import VoiceRecorder from '../VoiceRecorder.jsx';
import CaptureChoice from '../CaptureChoice.jsx';
import VideoUpload from '../VideoUpload.jsx';
import { uploadWithRetry } from '../../utils/uploadWithProgress.js';

function resizeImage(file, maxSize = 2048) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Always re-encode to JPEG to ensure consistent compression
        // (raw PNGs or high-quality JPEGs can be 5-10x larger)
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function JobDetails({ state, dispatch, abortRef, showToast, voiceDictationEnabled = false }) {
  const [errors, setErrors] = useState({});
  const [photoWarnings, setPhotoWarnings] = useState({ missingSlots: [] });
  const fileInputRefs = useRef({});
  const [dragOverSlot, setDragOverSlot] = useState(null); // key of slot being dragged over
  const [dragOverExtra, setDragOverExtra] = useState(false); // extra photos drop zone
  const [uploadingSlot, setUploadingSlot] = useState(null); // which slot is processing

  const { jobDetails, photos, extraPhotos, profile, captureMode } = state;
  const [videoFile, setVideoFile] = useState(null);
  const [videoExtraPhotos, setVideoExtraPhotos] = useState([]);

  const updateJob = (field, value) => {
    dispatch({ type: 'UPDATE_JOB_DETAILS', updates: { [field]: value } });
  };

  const handlePhotoUpload = async (slotKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Warn on very large files (>15MB raw)
    if (file.size > 15 * 1024 * 1024) {
      showToast?.('Photo is very large. It will be compressed automatically.', 'info');
    }
    setUploadingSlot(slotKey);
    try {
      const dataUrl = await resizeImage(file);
      dispatch({
        type: 'SET_PHOTO',
        slot: slotKey,
        photo: { data: dataUrl, name: file.name },
      });
      if (state.currentUserId) {
        savePhoto(state.currentUserId, 'draft', slotKey, { data: dataUrl, name: file.name });
      }
    } catch (err) {
      console.error('Photo processing failed:', err);
      showToast?.('Could not process this photo. Try a different image.', 'error');
    } finally {
      setUploadingSlot(null);
    }
  };

  // Drag-and-drop handlers for photo slots
  const handleSlotDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleSlotDragEnter = (slotKey, e) => {
    e.preventDefault();
    setDragOverSlot(slotKey);
  };

  const handleSlotDragLeave = (slotKey, e) => {
    // Only clear if we're actually leaving the slot (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverSlot(null);
    }
  };

  const handleSlotDrop = async (slotKey, e) => {
    e.preventDefault();
    setDragOverSlot(null);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await resizeImage(file);
    dispatch({
      type: 'SET_PHOTO',
      slot: slotKey,
      photo: { data: dataUrl, name: file.name },
    });
    if (state.currentUserId) {
      savePhoto(state.currentUserId, 'draft', slotKey, { data: dataUrl, name: file.name });
    }
  };

  const [extraPhotoLabel, setExtraPhotoLabel] = useState('Other');
  const EXTRA_PHOTO_CATEGORIES = ['Overview', 'Close-up', 'Side Profile', 'Reference Card', 'Access', 'Other'];

  const handleExtraPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || extraPhotos.length >= 10) return;
    const dataUrl = await resizeImage(file);
    const newIndex = extraPhotos.length;
    dispatch({
      type: 'ADD_EXTRA_PHOTO',
      photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
    });
    if (state.currentUserId) {
      savePhoto(state.currentUserId, 'draft', `extra-${newIndex}`, { data: dataUrl, name: file.name, label: extraPhotoLabel });
    }
  };

  const handleAnalyse = async () => {
    const jobResult = validateJobDetails(jobDetails);
    const photoResult = validateRequiredPhotoSlots(photos);

    setErrors(jobResult.errors);
    setPhotoWarnings(photoResult);

    if (!jobResult.valid || !photoResult.valid) return;

    dispatch({ type: 'ANALYSIS_START' });

    runAnalysis({
      photos,
      extraPhotos,
      jobDetails,
      profile,
      abortRef,
      dispatch,
      userId: state.currentUserId,
    });
  };

  const handleVideoAnalyse = async () => {
    const jobResult = validateJobDetails(jobDetails);
    setErrors(jobResult.errors);
    if (!jobResult.valid) return;
    if (!videoFile) return;

    // Client-side file size check (#20)
    if (videoFile.size > 100 * 1024 * 1024) {
      showToast?.('Video must be under 100MB', 'error');
      return;
    }

    dispatch({ type: 'ANALYSIS_START' });

    // Open SSE connection for real-time progress before uploading
    let eventSource = null;
    try {
      eventSource = new EventSource(
        `/api/users/${state.currentUserId}/jobs/draft/video/progress`
      );
      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          dispatch({ type: 'VIDEO_PROGRESS', payload: data });
          if (data.stage === 'complete' || data.stage === 'error') {
            eventSource.close();
          }
        } catch { /* ignore parse errors */ }
      };
      eventSource.onerror = () => {
        eventSource.close();
      };
    } catch { /* SSE not critical — fall back to time-based */ }

    let uploadAbort = null;
    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('siteAddress', jobDetails.siteAddress);
      formData.append('briefNotes', jobDetails.briefNotes || '');
      formData.append('profile', JSON.stringify(profile));
      videoExtraPhotos.forEach((photo) => {
        formData.append('extraPhotos', photo);
      });

      const data = await uploadWithRetry({
        url: `/api/users/${state.currentUserId}/jobs/draft/video`,
        body: formData,
        onProgress: (progress) => {
          dispatch({ type: 'UPLOAD_PROGRESS', payload: progress });
        },
        onRetry: ({ attempt, maxRetries }) => {
          dispatch({ type: 'UPLOAD_PROGRESS', payload: { percent: 0, retry: attempt, maxRetries } });
        },
        maxRetries: 3,
      });
      dispatch({
        type: 'ANALYSIS_SUCCESS',
        normalised: data.normalised,
        rawResponse: data.rawResponse,
        critiqueNotes: data.critiqueNotes || null,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch({ type: 'ANALYSIS_CANCEL' });
      } else {
        dispatch({ type: 'ANALYSIS_ERROR', error: err.message });
      }
    } finally {
      try { eventSource?.close(); } catch {}
      try { uploadAbort = null; } catch {}
    }
  };

  const hasAnyPhoto = Object.values(photos).some(p => p != null) || extraPhotos.length > 0;
  const canAnalyse =
    hasAnyPhoto && jobDetails.siteAddress?.trim() && !state.isAnalysing;
  const canAnalyseVideo =
    videoFile && jobDetails.siteAddress?.trim() && !state.isAnalysing;

  // Count missing required photos for CTA label
  const filledCount = Object.values(photos).filter(p => p != null).length + extraPhotos.length;
  const neededPhotos = canAnalyse ? 0 : Math.max(0, 1 - filledCount);

  const inputClass = (field) =>
    `w-full bg-tq-card border-1.5 ${
      errors[field] ? 'border-tq-error' : 'border-tq-border'
    } rounded px-3 py-2.5 text-tq-text font-body text-sm focus:outline-none focus:border-tq-accent`;

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        Job Details & Photos
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        Enter the job details and upload photos of the damaged wall.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Client Name *
          </label>
          <input
            type="text"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="e.g. Yorkshire Estates"
            className={inputClass('clientName')}
            value={jobDetails.clientName}
            onChange={(e) => updateJob('clientName', e.target.value)}
          />
          {errors.clientName && <p className="text-tq-error text-xs mt-1">{errors.clientName}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Quote Reference
          </label>
          <input
            type="text"
            autoComplete="off"
            enterKeyHint="next"
            placeholder="Auto-generated if left blank"
            className={inputClass('quoteReference')}
            value={jobDetails.quoteReference}
            onChange={(e) => updateJob('quoteReference', e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Site Address *
          </label>
          <textarea
            autoComplete="street-address"
            enterKeyHint="next"
            placeholder="e.g. Malham Cove, Skipton BD23 4DA"
            className={inputClass('siteAddress')}
            rows={2}
            value={jobDetails.siteAddress}
            onChange={(e) => {
              updateJob('siteAddress', e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            style={{ overflow: 'hidden', resize: 'none' }}
          />
          {errors.siteAddress && <p className="text-tq-error text-xs mt-1">{errors.siteAddress}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Quote Date
          </label>
          <input
            type="date"
            className={inputClass('quoteDate')}
            value={jobDetails.quoteDate}
            onChange={(e) => updateJob('quoteDate', e.target.value)}
          />
        </div>

        {/* Brief notes — only in non-video modes to avoid duplicate (#24) */}
        {captureMode !== 'video' && (
        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Brief Notes (optional)
          </label>
          {voiceDictationEnabled && (
            <VoiceRecorder
              value={jobDetails.briefNotes}
              onUpdateText={(text) => updateJob('briefNotes', text)}
              currentUserId={state.currentUserId}
              disabled={!navigator.onLine}
            />
          )}
          <textarea
            className={inputClass('briefNotes')}
            rows={2}
            value={jobDetails.briefNotes}
            onChange={(e) => {
              updateJob('briefNotes', e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            style={{ overflow: 'hidden', resize: 'none' }}
            placeholder="Anything we should know — e.g. wall is on a slope, needs through stones replacing..."
          />
        </div>
        )}
      </div>

      {/* Capture mode choice */}
      {!captureMode && (
        <CaptureChoice
          onSelectMode={(mode) => dispatch({ type: 'SET_CAPTURE_MODE', payload: mode })}
        />
      )}

      {/* Video upload mode */}
      {captureMode === 'video' && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-heading font-bold text-tq-text">
              Video Walkthrough
            </h3>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'SET_CAPTURE_MODE', payload: null });
                setVideoFile(null);
                setVideoExtraPhotos([]);
              }}
              className="text-sm text-tq-accent hover:underline"
            >
              Change capture method
            </button>
          </div>
          <VideoUpload
            video={videoFile}
            onVideoChange={setVideoFile}
            extraPhotos={videoExtraPhotos}
            onExtraPhotosChange={setVideoExtraPhotos}
          />

          {/* Brief notes in video mode */}
          <div className="mt-6">
            <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
              Brief Notes (optional)
            </label>
            {voiceDictationEnabled && (
              <VoiceRecorder
                value={jobDetails.briefNotes}
                onUpdateText={(text) => updateJob('briefNotes', text)}
                currentUserId={state.currentUserId}
                disabled={!navigator.onLine}
              />
            )}
            <textarea
              className={inputClass('briefNotes')}
              rows={2}
              value={jobDetails.briefNotes}
              onChange={(e) => {
                updateJob('briefNotes', e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              style={{ overflow: 'hidden', resize: 'none' }}
              placeholder="Anything we should know — e.g. wall is on a slope, needs through stones replacing..."
            />
          </div>

          {/* Video analyse CTA */}
          <div className="flex justify-end gap-3 mt-6">
            {state.currentUserId && (
              <button
                onClick={async () => {
                  try {
                    await saveDraft(state.currentUserId, state);
                    if (showToast) showToast('Progress saved', 'success');
                  } catch {
                    if (showToast) showToast('Failed to save progress', 'error');
                  }
                }}
                className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-3 rounded transition-colors"
              >
                Save Progress
              </button>
            )}
            <button
              disabled={!canAnalyseVideo}
              onClick={handleVideoAnalyse}
              className="font-heading font-bold uppercase tracking-wide px-8 py-3 rounded transition-colors"
              style={{
                backgroundColor: canAnalyseVideo ? 'var(--tq-accent)' : 'var(--tq-surface)',
                color: canAnalyseVideo ? '#ffffff' : 'var(--tq-muted)',
                opacity: canAnalyseVideo ? 1 : 0.45,
                cursor: canAnalyseVideo ? 'pointer' : 'not-allowed',
                minHeight: 48,
              }}
            >
              {canAnalyseVideo ? 'GENERATE QUOTE' : 'ADD VIDEO TO CONTINUE'}
            </button>
          </div>
        </div>
      )}

      {/* Photo mode: existing flow unchanged */}
      {captureMode === 'photos' && (
        <>
      {/* Change capture method link */}
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET_CAPTURE_MODE', payload: null })}
          className="text-sm text-tq-accent hover:underline"
        >
          Change capture method
        </button>
      </div>

      {/* Reference card banner */}
      <div
        className="flex items-start gap-3 rounded-lg p-4 mb-6"
        style={{ backgroundColor: 'var(--tq-accent-bg)', border: '1.5px solid var(--tq-accent-bd)', borderRadius: 10 }}
      >
        <span className="text-2xl shrink-0">📐</span>
        <div>
          <p className="font-heading font-bold text-sm" style={{ color: 'var(--tq-accent)' }}>
            Using your FastQuote Reference Card?
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--tq-text)' }}>
            Place it flat against the wall in Slot 4. The system uses the known 148×210mm dimensions to calculate real measurements.
          </p>
        </div>
      </div>

      {/* Missing-photos warning (shown when restored draft had photos that are now null) */}
      {state._photoSlots && Object.values(photos).every(p => p == null) && (
        <div className="bg-tq-unconfirmed/10 border border-tq-unconfirmed/30 rounded p-3 mb-6">
          <p className="text-tq-unconfirmed text-sm">
            ⚠ Photos from your previous session could not be restored. Please re-upload them to continue.
          </p>
        </div>
      )}

      {/* Photo slots */}
      <h3 className="text-lg font-heading font-bold text-tq-text mb-4">
        Photo Upload
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {PHOTO_SLOTS.map((slot, slotIndex) => {
          const photo = photos[slot.key];
          const isMissing = photoWarnings.missingSlots?.includes(slot.key);
          const isReference = slot.key === 'referenceCard';
          const isRequired = slotIndex === 0 || slotIndex === 1; // overview, closeup
          const isRecommended = slotIndex === 2 || slotIndex === 4; // sideProfile, access
          const slotNum = slotIndex + 1;

          // Number circle colors
          const circleStyle = isReference
            ? { backgroundColor: '#c07e12', color: '#ffffff' }
            : isRequired
              ? { backgroundColor: '#1a1714', color: '#f5f0e8' }
              : { backgroundColor: '#7a6f5e', color: '#f5f0e8' };

          // Card border: required=solid accent, recommended=dashed grey, reference=solid gold
          const cardBorder = isReference
            ? '2px solid #e8a838'
            : isRequired
              ? '2px solid var(--tq-accent)'
              : '2px dashed var(--tq-border)';

          // Header bg for reference slot
          const headerBg = isReference ? '#fdf6e8' : 'var(--tq-card)';
          const headerBorder = isReference ? '#fae8b8' : 'var(--tq-border-soft)';

          return (
            <div
              key={slot.key}
              onDragOver={handleSlotDragOver}
              onDragEnter={(e) => handleSlotDragEnter(slot.key, e)}
              onDragLeave={(e) => handleSlotDragLeave(slot.key, e)}
              onDrop={(e) => handleSlotDrop(slot.key, e)}
              className="overflow-hidden transition-all"
              style={{
                backgroundColor: 'var(--tq-card)',
                border: dragOverSlot === slot.key ? '2px solid var(--tq-accent)' : cardBorder,
                borderRadius: 10,
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center gap-2 px-3.5 py-3"
                style={{ backgroundColor: headerBg, borderBottom: `1px solid ${headerBorder}` }}
              >
                <span
                  className="flex items-center justify-center rounded-full shrink-0"
                  style={{ width: 22, height: 22, fontSize: 11, fontWeight: 700, ...circleStyle }}
                >
                  {slotNum}
                </span>
                <span className="text-sm font-heading font-bold flex-1" style={{ color: 'var(--tq-text)' }}>
                  {slot.label}
                </span>
                {isRequired && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--tq-accent)', fontWeight: 600 }}>Required</span>
                )}
                {isRecommended && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--tq-muted)', fontWeight: 600 }}>Recommended</span>
                )}
                {isReference && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: '#c07e12', fontWeight: 600 }}>Recommended</span>
                )}
                {photo && (
                  <span className="text-xs" style={{ color: 'var(--tq-confirmed-txt)' }}>✓</span>
                )}
              </div>

              {/* Card body: drop zone, loading, or image */}
              <div className="p-3">
                {uploadingSlot === slot.key ? (
                  <div className="flex flex-col items-center justify-center" style={{ minHeight: 110 }}>
                    <div className="w-8 h-8 border-3 border-tq-accent border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>Processing photo...</span>
                  </div>
                ) : photo ? (
                  <div className="relative">
                    <img
                      src={photo.data}
                      alt={slot.label}
                      className="w-full h-28 object-cover rounded"
                    />
                    <button
                      onClick={() => {
                        dispatch({ type: 'SET_PHOTO', slot: slot.key, photo: null });
                        if (state.currentUserId) deletePhoto(state.currentUserId, 'draft', slot.key);
                      }}
                      className="absolute top-1 right-1 w-10 h-10 rounded-full flex items-center justify-center text-sm"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#ffffff', minWidth: 44, minHeight: 44 }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center cursor-pointer rounded transition-colors"
                    style={{
                      minHeight: 110,
                      border: isReference
                        ? '2px dashed #e8c870'
                        : dragOverSlot === slot.key
                          ? '2px dashed var(--tq-accent)'
                          : '2px dashed var(--tq-border)',
                      backgroundColor: isReference ? '#fef8ee' : 'transparent',
                    }}
                  >
                    <span className="text-2xl mb-1 opacity-30">📷</span>
                    <span className="text-xs text-center px-2" style={{ color: 'var(--tq-muted)' }}>
                      {slot.instruction || 'Tap to take photo or choose from gallery'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handlePhotoUpload(slot.key, e)}
                    />
                  </label>
                )}
                {isMissing && (
                  <p className="text-xs mt-2" style={{ color: 'var(--tq-error-txt)' }}>Required photo missing</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Extra photos */}
      {extraPhotos.length < 10 && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDragEnter={(e) => { e.preventDefault(); setDragOverExtra(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverExtra(false); }}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOverExtra(false);
            const file = e.dataTransfer.files?.[0];
            if (!file || !file.type.startsWith('image/') || extraPhotos.length >= 10) return;
            const dataUrl = await resizeImage(file);
            const newIndex = extraPhotos.length;
            dispatch({
              type: 'ADD_EXTRA_PHOTO',
              photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
            });
            if (state.currentUserId) {
              savePhoto(state.currentUserId, 'draft', `extra-${newIndex}`, { data: dataUrl, name: file.name, label: extraPhotoLabel });
            }
          }}
          className={`mb-6 flex items-center gap-3 flex-wrap p-3 rounded-lg border-2 transition-all ${
            dragOverExtra
              ? 'border-tq-accent ring-2 ring-tq-accent/50 border-solid bg-tq-accent/5'
              : 'border-transparent'
          }`}
        >
          <select
            value={extraPhotoLabel}
            onChange={(e) => setExtraPhotoLabel(e.target.value)}
            className="bg-tq-card border border-tq-border rounded px-2 py-1.5 text-tq-text text-sm focus:outline-none focus:border-tq-accent"
          >
            {EXTRA_PHOTO_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-tq-accent cursor-pointer hover:text-tq-accent-dark" style={{ minHeight: 44, padding: '8px 0' }}>
            + Add more photos ({extraPhotos.length}/10) — or drop here
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleExtraPhoto}
            />
          </label>
        </div>
      )}

      {extraPhotos.length > 0 && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {extraPhotos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p.data} alt={`Extra ${i + 1}`} className="w-20 h-20 object-cover rounded border border-tq-border" />
              {p.label && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b">
                  {p.label}
                </span>
              )}
              <button
                onClick={() => {
                  dispatch({ type: 'REMOVE_EXTRA_PHOTO', index: i });
                  if (state.currentUserId) {
                    // Delete all extras then re-upload remaining (re-index)
                    const remaining = extraPhotos.filter((_, idx) => idx !== i);
                    // Delete all extra-* slots
                    for (let j = 0; j < extraPhotos.length; j++) {
                      deletePhoto(state.currentUserId, 'draft', `extra-${j}`);
                    }
                    // Re-upload remaining with corrected indices
                    remaining.forEach((p, idx) => {
                      savePhoto(state.currentUserId, 'draft', `extra-${idx}`, { data: p.data, name: p.name, label: p.label });
                    });
                  }
                }}
                className="absolute -top-1 -right-1 bg-tq-error text-white w-5 h-5 rounded-full flex items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Soft warning if no reference card */}
      {!photos.referenceCard && (photos.overview || photos.closeup) && (
        <div className="bg-tq-unconfirmed/10 border border-tq-unconfirmed/30 rounded p-3 mb-6">
          <p className="text-tq-unconfirmed text-sm">
            ⚠ No reference card photo — measurements will be estimated and must each be confirmed before the quote can be generated.
          </p>
        </div>
      )}

      {/* Analyse CTA */}
      <div className="flex justify-end gap-3">
        {state.currentUserId && (
          <button
            onClick={async () => {
              try {
                await saveDraft(state.currentUserId, state);
                if (showToast) showToast('Progress saved', 'success');
              } catch {
                if (showToast) showToast('Failed to save progress', 'error');
              }
            }}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-3 rounded transition-colors"
          >
            Save Progress
          </button>
        )}
        {state.reviewData && (
          <button
            onClick={() => dispatch({ type: 'SET_STEP', step: 4 })}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-3 rounded transition-colors"
          >
            Back to Review
          </button>
        )}
        <button
          disabled={!canAnalyse}
          onClick={handleAnalyse}
          className="font-heading font-bold uppercase tracking-wide px-8 py-3 rounded transition-colors"
          style={{
            backgroundColor: canAnalyse ? 'var(--tq-accent)' : 'var(--tq-surface)',
            color: canAnalyse ? '#ffffff' : 'var(--tq-muted)',
            opacity: canAnalyse ? 1 : 0.45,
            cursor: canAnalyse ? 'pointer' : 'not-allowed',
            minHeight: 48,
          }}
        >
          {state.reviewData
            ? 'RE-GENERATE QUOTE'
            : canAnalyse
              ? 'GENERATE QUOTE'
              : neededPhotos > 0
                ? `ADD ${neededPhotos} PHOTO${neededPhotos !== 1 ? 'S' : ''} TO CONTINUE`
                : 'ADD SITE ADDRESS TO CONTINUE'
          }
        </button>
      </div>
      </>
      )}
    </div>
  );
}
