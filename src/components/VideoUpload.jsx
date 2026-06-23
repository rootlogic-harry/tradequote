import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

const MAX_EXTRA_PHOTOS = 3;

/**
 * Video upload component with drag-and-drop, thumbnail preview,
 * duration display, and optional extra photos.
 * Mobile-optimised: OS file picker (Camera / Photo Library / Browse),
 * 44px minimum touch targets, client-side duration check.
 *
 * @param {object} props
 * @param {File|null} props.video            — currently selected video file
 * @param {(file: File|null) => void} props.onVideoChange
 * @param {File[]} props.extraPhotos         — extra photo files
 * @param {(files: File[]) => void} props.onExtraPhotosChange
 * @param {number} [props.maxExtraPhotos=3]
 * @param {number} [props.maxDuration=180]   — max video length in seconds
 * @param {(msg: string) => void} [props.onError] — surfaces ANY rejection
 *   reason to the parent (wired to showToast). Covers non-video MIME,
 *   oversize file, and duration-exceeded.
 * @param {(msg: string) => void} [props.onDurationError] — DEPRECATED,
 *   retained for back-compat with callers that only wired duration.
 *   Prefer onError.
 */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB — matches server multer cap

export default function VideoUpload({
  video = null,
  onVideoChange,
  extraPhotos = [],
  onExtraPhotosChange,
  maxExtraPhotos = MAX_EXTRA_PHOTOS,
  maxDuration = 180,
  onError,
  onDurationError,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const photoInputRef = useRef(null);

  // Stable refs for callbacks used inside video effect — avoids stale closures
  // without re-triggering the effect when parent re-renders
  const onVideoChangeRef = useRef(onVideoChange);
  const onErrorRef = useRef(onError);
  const onDurationErrorRef = useRef(onDurationError);
  const maxDurationRef = useRef(maxDuration);
  useEffect(() => { onVideoChangeRef.current = onVideoChange; }, [onVideoChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onDurationErrorRef.current = onDurationError; }, [onDurationError]);
  useEffect(() => { maxDurationRef.current = maxDuration; }, [maxDuration]);

  // Report an error to whichever handler the parent wired. Falls back to
  // the legacy onDurationError for back-compat with JobDetails which
  // (pre-fix) only listened on that prop. Paul's bug was this callback
  // never being wired, so silent `return`s in handleFile left him
  // staring at an unchanged empty drop-zone after a failed select.
  const reportError = useCallback((msg) => {
    if (typeof onErrorRef.current === 'function') onErrorRef.current(msg);
    else if (typeof onDurationErrorRef.current === 'function') onDurationErrorRef.current(msg);
  }, []);

  // Generate thumbnail and read duration when video changes
  useEffect(() => {
    if (!video) {
      setDuration(null);
      setThumbnailUrl(null);
      setVideoUrl(null);
      return;
    }

    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.src = url;

    videoEl.onloadedmetadata = () => {
      setDuration(videoEl.duration);
      // TRQ-178: WhatsApp-compressed MP4s ship with the moov atom at
      // the end of the file. Safari (especially iOS Safari) with
      // preload="metadata" only fetches the start of the file and
      // returns videoEl.duration = Infinity in that case. The old
      // client-side check fired "Video must be under 3 minutes (this
      // one is Infinity min)" and blocked the upload — even on a
      // 30-second clip. Skip the client-side check for non-finite
      // values; the server's ffprobe-based validator catches the real
      // 3-minute rule and is authoritative anyway.
      if (Number.isFinite(videoEl.duration)) {
        if (videoEl.duration > maxDurationRef.current) {
          const msg = `Video must be under ${Math.floor(maxDurationRef.current / 60)} minutes (this one is ${Math.ceil(videoEl.duration / 60)} min)`;
          if (typeof onErrorRef.current === 'function') onErrorRef.current(msg);
          else if (typeof onDurationErrorRef.current === 'function') onDurationErrorRef.current(msg);
          onVideoChangeRef.current(null);
          return;
        }
        // Seek to 1 second for thumbnail (only safe with finite duration).
        videoEl.currentTime = Math.min(1, videoEl.duration / 2);
      } else {
        console.warn('[VideoUpload] non-finite duration', videoEl.duration,
          '— deferring duration check to server. Likely WhatsApp / non-streaming MP4.');
      }
    };

    // TRQ-178: log metadata-load failures rather than letting the
    // <video> element silently never fire onloadedmetadata. Upload
    // still proceeds — server validates via ffprobe.
    videoEl.onerror = () => {
      console.warn('[VideoUpload] could not read metadata client-side, proceeding anyway',
        videoEl.error?.code, videoEl.error?.message);
    };

    videoEl.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0);
      setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.7));
      // Don't revoke url here — it's used by the <video> playback preview
    };

    return () => URL.revokeObjectURL(url);
  }, [video]);

  const handleFile = useCallback((file) => {
    // Every rejection path now SURFACES the reason. Silent returns were
    // the root cause of Paul's iPad "picked a video, nothing happened"
    // — he had no way to know the file was being refused.
    if (!file) {
      reportError('No file was selected. Tap again to pick a video.');
      return;
    }
    if (!file.type || !file.type.startsWith('video/')) {
      reportError(
        `That file isn\u2019t a video (detected: ${file.type || 'unknown'}). Please choose a video from your library.`
      );
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(0);
      reportError(
        `Video is ${sizeMb}MB — maximum is 500MB. Try recording at a lower quality, or trim it to a shorter clip.`
      );
      return;
    }
    onVideoChange(file);
  }, [onVideoChange, reportError]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [handleFile]);

  const handleReplace = useCallback(() => {
    onVideoChange(null);
    setShowPhotoUpload(false);
  }, [onVideoChange]);

  const handlePhotoAdd = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    const remaining = maxExtraPhotos - extraPhotos.length;
    const toAdd = files.slice(0, remaining);
    if (toAdd.length > 0) {
      onExtraPhotosChange([...extraPhotos, ...toAdd]);
    }
    e.target.value = '';
  }, [extraPhotos, maxExtraPhotos, onExtraPhotosChange]);

  const handlePhotoRemove = useCallback((index) => {
    const updated = extraPhotos.filter((_, i) => i !== index);
    onExtraPhotosChange(updated);
  }, [extraPhotos, onExtraPhotosChange]);

  // Stable object URLs for extra photo thumbnails — revoked on change (#9)
  const extraPhotoUrls = useMemo(() => extraPhotos.map(f => URL.createObjectURL(f)), [extraPhotos]);
  useEffect(() => {
    return () => extraPhotoUrls.forEach(url => URL.revokeObjectURL(url));
  }, [extraPhotoUrls]);

  const formatDuration = (secs) => {
    if (!secs || !Number.isFinite(secs)) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // --- Drop zone (no video selected) ---
  if (!video) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: `2px dashed ${dragOver ? 'var(--tq-accent)' : 'var(--tq-border)'}`,
          borderRadius: '12px',
          padding: '36px 24px',
          textAlign: 'center',
          background: dragOver ? 'var(--tq-accent-bg)' : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎬</div>
        <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>
          Add a video of the job
        </div>
        <div style={{ color: 'var(--tq-muted)', fontSize: '13px', marginBottom: '16px' }}>
          Up to 3 minutes, under 500MB.
        </div>

        {/* Two primary buttons, side by side. On iPad the distinction
            matters: "Record" skips the Photos picker (capture=environment
            opens the camera directly), while "Choose from library"
            opens the standard picker. Keeping them separate stops Paul
            getting stuck in the Photos picker when he meant to shoot
            fresh footage. */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
            style={{
              padding: '12px 22px',
              minHeight: '44px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--tq-accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            📹 Record now
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            style={{
              padding: '12px 22px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--tq-border)',
              background: 'var(--tq-card)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Choose from library
          </button>
        </div>

        <div style={{ color: 'var(--tq-muted)', fontSize: '12px', fontStyle: 'italic', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
          Tip: hold the camera steady on your reference card (or a tape measure)
          for 2–3 seconds so a clean frame can be captured.
        </div>

        {/* Two inputs: camera-capture (opens camera on iOS/Android) and
            library-picker (opens Photos). Both feed the same handler. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
      </div>
    );
  }

  // --- Video selected: show preview ---
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Video playback preview */}
      <div style={{
        padding: '16px',
        border: '1px solid var(--tq-border)',
        borderRadius: '12px',
        background: 'var(--tq-card)',
      }}>
        {videoUrl && (
          <video
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            poster={thumbnailUrl || undefined}
            style={{
              width: '100%',
              maxHeight: '240px',
              borderRadius: '8px',
              marginBottom: '12px',
              background: '#000',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600,
              fontSize: '14px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {video.name}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--tq-muted)', marginTop: '4px' }}>
              {duration ? formatDuration(duration) : 'Loading...'}
              {video.size ? ` · ${(video.size / (1024 * 1024)).toFixed(1)}MB` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={handleReplace}
            style={{
              padding: '8px 16px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--tq-border)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '13px',
              flexShrink: 0,
            }}
          >
            Replace
          </button>
        </div>
      </div>

      {/* Add photos toggle. The reviewer flagged the previous version as
          buried (small text link); promote to a bordered button so
          tradesmen find it after picking the video. Single affordance
          serves both purposes — photos go on the quote AND improve
          measurement accuracy. */}
      {!showPhotoUpload && extraPhotos.length === 0 && (
        <button
          type="button"
          onClick={() => setShowPhotoUpload(true)}
          style={{
            padding: '12px 16px',
            border: '1.5px dashed var(--tq-border)',
            borderRadius: '12px',
            background: 'transparent',
            color: 'var(--tq-text)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            textAlign: 'left',
            minHeight: '48px',
            width: '100%',
          }}
        >
          + Add site photos for the quote
          <span style={{ display: 'block', fontWeight: 400, fontSize: '12px', color: 'var(--tq-muted)', marginTop: '2px' }}>
            Optional &middot; up to {maxExtraPhotos} &middot; appear on the customer's quote
          </span>
        </button>
      )}

      {/* Extra photos grid */}
      {(showPhotoUpload || extraPhotos.length > 0) && (
        <div style={{
          padding: '16px',
          border: '1px solid var(--tq-border)',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
            Site photos for the quote ({extraPhotos.length}/{maxExtraPhotos})
          </div>
          <div style={{ fontSize: '12px', color: 'var(--tq-muted)', marginBottom: '10px' }}>
            These appear on your customer's quote and improve measurement accuracy. Optional.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {extraPhotos.map((photo, i) => (
              <div key={i} style={{ position: 'relative', width: '80px', height: '80px' }}>
                <img
                  src={extraPhotoUrls[i]}
                  alt={`Extra photo ${i + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => handlePhotoRemove(i)}
                  style={{
                    position: 'absolute',
                    top: '-10px',
                    right: '-10px',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: '18px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {extraPhotos.length < maxExtraPhotos && (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                style={{
                  width: '80px',
                  height: '80px',
                  border: '2px dashed var(--tq-border)',
                  borderRadius: '8px',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: 'var(--tq-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                +
              </button>
            )}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoAdd}
            style={{ display: 'none' }}
          />
        </div>
      )}
    </div>
  );
}
