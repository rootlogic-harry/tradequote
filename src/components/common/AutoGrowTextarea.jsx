import React, { useRef, useState, useLayoutEffect } from 'react';
import { computeAutoGrowHeight } from '../../utils/autoGrowHeight.js';

/**
 * Textarea that grows to fit its content, with an optional upper cap.
 *
 * Two mutually-exclusive sizing paths — picked at module load, never both
 * at once:
 *
 *   1. NATIVE PATH (Chrome 123+, Safari 18+, ~99% of 2026 traffic):
 *      `field-sizing: content` on the <textarea> handles sizing in the
 *      browser engine. Zero JS. No effects. No mutation of the DOM from
 *      our code. This is the default WHEN `maxHeight` IS UNSET — native
 *      field-sizing cannot enforce an upper bound or switch overflow to
 *      auto, so any caller that opts into a cap forces the JS path.
 *
 *   2. JS PATH (older Chrome / Firefox pre-support, OR any call site
 *      with a `maxHeight` cap):
 *      useLayoutEffect reads scrollHeight on every `value` change and
 *      sets `style.height` via the shared `computeAutoGrowHeight` helper.
 *      A requestAnimationFrame retry catches browsers that delay layout
 *      after setting `height: auto`.
 *
 * `maxHeight` (TRQ — Jun 2026 — Mark's "scroll option" request):
 *   When set, the textarea grows to `min(scrollHeight, maxHeight)`; above
 *   the cap, `overflowY` flips to `auto` and a subtle bottom fade
 *   overlay appears as a visual "more below" cue. The overlay is wrapped
 *   in a relative <div> sibling so it can sit on top of the textarea
 *   without interfering with text input (`pointer-events: none`).
 *
 * What we deliberately removed in Apr 2026 (TRQ fix):
 *   - The ResizeObserver. Paul reported measurement / schedule boxes
 *     visibly vibrating on a live quote. Root cause: the observer fired
 *     on every height mutation we made ourselves, which we then treated
 *     as a "parent visibility change" and re-measured, re-mutated, and
 *     re-fired the observer — an infinite sub-pixel oscillation at the
 *     browser's layout-frame rate.
 *
 * Pitfall #11 (TRQ-111 / TRQ-114): measurement runs in `useLayoutEffect`
 * keyed on `value`, never in a ref callback — ref callbacks fire before
 * the value is reliably measurable and don't re-fire on prop changes.
 *
 * Props:
 *   value       — the textarea contents (controlled)
 *   onChange    — onChange handler
 *   onBlur      — onBlur handler
 *   minHeight   — px floor for the textarea (default 120)
 *   maxHeight   — optional px cap. Unset = current unbounded behaviour.
 *   className, style, ... — forwarded to the underlying <textarea>.
 */

// Detect the native field-sizing support once at module load. On the
// server (SSR) CSS is undefined; we treat that as "no support" so the
// JS path is available when the component hydrates — but because this
// component only mounts client-side in our app, that path never runs.
const SUPPORTS_FIELD_SIZING =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports?.('field-sizing', 'content')
    : false;

export default function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  minHeight = 120,
  maxHeight,
  className = '',
  style,
  ...rest
}) {
  const ref = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  // The native field-sizing path can only be used when there is NO cap to
  // enforce — `field-sizing: content` grows unbounded and has no overflow
  // hook. With `maxHeight` set we fall back to JS measurement.
  const useNativePath = SUPPORTS_FIELD_SIZING && maxHeight == null;

  // resize() is used by the JS path. Guards against 0-width (element not
  // laid out) so we never overwrite a good height with a stale zero.
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth === 0) return;
    el.style.height = 'auto';
    const { height, overflowY, overflowing: isOverflowing } = computeAutoGrowHeight({
      scrollHeight: el.scrollHeight,
      minHeight,
      maxHeight,
    });
    el.style.height = `${height}px`;
    el.style.overflowY = overflowY;
    setOverflowing(isOverflowing);
  };

  // Synchronous measurement on mount + value/cap change — JS path only.
  // On browsers with native field-sizing AND no cap the effect is a no-op.
  useLayoutEffect(() => {
    if (useNativePath) return; // Zero-JS path — browser handles it.
    resize();
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minHeight, maxHeight, useNativePath]);

  const textarea = (
    <textarea
      ref={ref}
      value={value || ''}
      onChange={onChange}
      onBlur={onBlur}
      className={className}
      style={{
        // Native CSS auto-sizing only when there is no cap to enforce.
        ...(useNativePath ? { fieldSizing: 'content' } : null),
        minHeight,
        // When the JS path is enforcing a cap, `overflowY` is updated
        // imperatively in resize() — start `hidden` so the initial paint
        // doesn't flash a scrollbar.
        overflow: 'hidden',
        resize: 'none',
        ...style,
      }}
      {...rest}
    />
  );

  // No cap → no overlay → no wrapper. Keeps the DOM byte-identical for
  // every existing call site that hasn't opted into capping.
  if (maxHeight == null) {
    return textarea;
  }

  // Fade overlay sits in a relative wrapper above the bottom of the
  // textarea. Tasteful 32px gradient from transparent → card background
  // so the last visible line of text stays legible.
  return (
    <div style={{ position: 'relative' }}>
      {textarea}
      {overflowing && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 1,
            right: 1,
            bottom: 1,
            height: 32,
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, var(--tq-card) 100%)',
            borderRadius: 'inherit',
          }}
        />
      )}
    </div>
  );
}
