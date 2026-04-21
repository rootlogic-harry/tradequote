import React, { useRef, useLayoutEffect, useEffect } from 'react';

/**
 * Textarea that grows to fit its content.
 *
 * Previous revisions used only useLayoutEffect + scrollHeight, which failed
 * in two real cases:
 *   1. The textarea was rendered inside a `display: none` mobile accordion
 *      (or a `.fq:hidden` desktop sibling). scrollHeight reads as 0 at mount
 *      → height capped to minHeight forever even after the parent becomes
 *      visible.
 *   2. The browser hadn't finished layout when the synchronous effect read
 *      scrollHeight, so the measurement was stale.
 *
 * Now uses layered fallbacks:
 *   • `field-sizing: content` CSS (Chrome 123+, Safari 18+) — native auto-
 *     sizing, zero JS, handles all edge cases.
 *   • useLayoutEffect for the initial measurement.
 *   • requestAnimationFrame retry to catch late layout.
 *   • ResizeObserver on the textarea to catch parent visibility changes
 *     (e.g. mobile accordion expanding, desktop grid activating at the
 *     `fq:` breakpoint) — re-runs the measurement the moment the element
 *     gains a real width.
 *
 * Forwards every other prop straight through to the underlying <textarea>.
 */
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

  // Core resizer — used by every trigger below. Guards against
  // display:none / 0-width measurements so we never overwrite a good height
  // with a stale 0 value.
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    // If the element isn't laid out (parent display:none, not in DOM, etc.)
    // scrollHeight is meaningless — skip and let the ResizeObserver catch
    // us up when visibility changes.
    if (el.clientWidth === 0) return;
    const prevHeight = el.style.height;
    el.style.height = 'auto';
    const needed = Math.max(minHeight, el.scrollHeight);
    const target = `${needed}px`;
    if (target !== prevHeight) {
      el.style.height = target;
    }
  };

  // 1. Synchronous measurement on mount + when the value changes.
  useLayoutEffect(() => {
    resize();
    // 2. rAF retry — catches browsers that delay layout after height='auto'.
    const raf = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minHeight]);

  // 3. ResizeObserver — fires whenever the textarea itself resizes, which
  //    happens when an ancestor toggles between display:none and display:block
  //    (mobile accordion open/close, responsive grid activation). Without
  //    this, a textarea rendered inside a hidden parent stays at minHeight
  //    forever after the parent becomes visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      value={value || ''}
      onChange={onChange}
      onBlur={onBlur}
      className={className}
      style={{
        // Native CSS auto-sizing where supported — does the right thing with
        // zero JS. Our useLayoutEffect/ResizeObserver path remains the
        // fallback for browsers that don't yet support it.
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
