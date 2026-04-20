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
 * @param {(msg: string) => void} [props.onDurationError] — called when video exceeds maxDuration
 */
export default function VideoUpload({
  video = null,
  onVideoChange,
  extraPhotos = [],
  onExtraPhotosChange,
  maxExtraPhotos = MAX_EXTRA_PHOTOS,
  maxDuration = 180,
  onDurationError,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  // Stable refs for callbacks used inside video effect — avoids stale closures
  // without re-triggering the effect when parent re-renders
  const onVideoChangeRef = useRef(onVideoChange);
  const onDurationErrorRef = useRef(onDurationError);
  const maxDurationRef = useRef(maxDuration);
  useEffect(() => { onVideoChangeRef.current = onVideoChange; }, [onVideoChange]);
  useEffect(() => { onDurationErrorRef.current = onDurationError; }, [onDurationError]);
  useEffect(() => { maxDurationRef.current = maxDuration; }, [maxDuration]);

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
      // Client-side duration check — reject before uploading
      if (videoEl.duration > maxDurationRef.current) {
        onDurationErrorRef.current?.(`Video must be under ${Math.floor(maxDurationRef.current / 60)} minutes`);
        onVideoChangeRef.current(null);
        return;
      }
      // Seek to 1 second for thumbnail
      videoEl.currentTime = Math.min(1, videoEl.duration / 2);
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
    if (!file || !file.type.startsWith('video/')) return;
    if (file.size > 100 * 1024 * 1024) return; // 100MB client-side cap
    onVideoChange(file);
  }, [onVideoChange]);

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
    if (!secs) return '';
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
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent, #2563eb)' : 'var(--border, #ccc)'}`,
          borderRadius: '12px',
          padding: '48px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--accent-bg, #eff6ff)' : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎬</div>
        <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>
          Tap to record or drop a video
        </div>
        <div style={{ color: 'var(--text-secondary, #666)', fontSize: '13px', marginBottom: '8px' }}>
          or choose from your files (max 3 minutes, 100MB)
        </div>
        <div style={{ color: 'var(--text-secondary, #666)', fontSize: '12px', marginBottom: '16px', fontStyle: 'italic', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
          Tip: hold the camera steady on your reference card (or a tape measure)
          for 2–3 seconds so a clean frame can be captured.
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            border: '1px solid var(--border, #ccc)',
            background: 'var(--card-bg, #fff)',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Choose file
        </button>
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
        border: '1px solid var(--border, #e0e0e0)',
        borderRadius: '12px',
        background: 'var(--card-bg, #fff)',
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
            <div style={{ fontSize: '13px', color: 'var(--text-secondary, #666)', marginTop: '4px' }}>
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
              border: '1px solid var(--border, #ccc)',
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

      {/* Add photos toggle */}
      {!showPhotoUpload && extraPhotos.length === 0 && (
        <button
          type="button"
          onClick={() => setShowPhotoUpload(true)}
          style={{
            padding: '8px',
            border: 'none',
            background: 'transparent',
            color: 'var(--accent, #2563eb)',
            cursor: 'pointer',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          + Add photos (optional, up to {maxExtraPhotos})
        </button>
      )}

      {/* Extra photos grid */}
      {(showPhotoUpload || extraPhotos.length > 0) && (
        <div style={{
          padding: '16px',
          border: '1px solid var(--border, #e0e0e0)',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
            Extra photos ({extraPhotos.length}/{maxExtraPhotos})
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
                  border: '2px dashed var(--border, #ccc)',
                  borderRadius: '8px',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: 'var(--text-secondary, #666)',
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
