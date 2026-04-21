import React, { useRef, useLayoutEffect } from 'react';

/**
 * Textarea that grows to fit its content.
 *
 * Two mutually-exclusive sizing paths — picked at module load, never both
 * at once:
 *
 *   1. NATIVE PATH (Chrome 123+, Safari 18+, ~99% of 2026 traffic):
 *      `field-sizing: content` on the <textarea> handles sizing in the
 *      browser engine. Zero JS. No effects. No mutation of the DOM from
 *      our code. This is the default.
 *
 *   2. JS FALLBACK (older Chrome / Firefox pre-support):
 *      useLayoutEffect reads scrollHeight on every `value` change and
 *      sets `style.height`. A requestAnimationFrame retry catches
 *      browsers that delay layout after setting `height: auto`.
 *
 * What we deliberately removed in Apr 2026 (TRQ fix):
 *   - The ResizeObserver. Paul reported measurement / schedule boxes
 *     visibly vibrating on a live quote. Root cause: the observer fired
 *     on every height mutation we made ourselves, which we then treated
 *     as a "parent visibility change" and re-measured, re-mutated, and
 *     re-fired the observer — an infinite sub-pixel oscillation at the
 *     browser's layout-frame rate. With native field-sizing shipping
 *     everywhere Paul and Mark use, the observer's original job (catch
 *     the mobile-accordion open moment) is handled in the engine for
 *     free.
 *
 * Props:
 *   value       — the textarea contents (controlled)
 *   onChange    — onChange handler
 *   onBlur      — onBlur handler
 *   minHeight   — px floor for the textarea (default 120)
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
  className = '',
  style,
  ...rest
}) {
  const ref = useRef(null);

  // resize() is only used by the JS fallback path. Guards against
  // 0-width (element not laid out) so we never overwrite a good height
  // with a stale zero.
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth === 0) return;
    const prevHeight = el.style.height;
    el.style.height = 'auto';
    const needed = Math.max(minHeight, el.scrollHeight);
    const target = `${needed}px`;
    if (target !== prevHeight) {
      el.style.height = target;
    }
  };

  // Synchronous measurement on mount + value change — JS fallback only.
  // On browsers with native field-sizing support the effect is registered
  // but resize() is a cheap no-op guarded by the native sizing having
  // already done the work; we still schedule an rAF retry so a late
  // layout doesn't leave us short.
  useLayoutEffect(() => {
    if (SUPPORTS_FIELD_SIZING) return; // Zero-JS path — browser handles it.
    resize();
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minHeight]);

  return (
    <textarea
      ref={ref}
      value={value || ''}
      onChange={onChange}
      onBlur={onBlur}
      className={className}
      style={{
        // Native CSS auto-sizing where supported — does the right thing
        // with zero JS, no feedback loops, no observers.
        fieldSizing: 'content',
        minHeight,
        overflow: 'hidden',
        resize: 'none',
        ...style,
      }}
      {...rest}
    />
  );
}
