import React, { useRef, useLayoutEffect } from 'react';

/**
 * Textarea that grows to fit its content.
 *
 * Why useLayoutEffect: it runs synchronously after DOM mutations and before
 * the browser paints, so the height is correct on the first frame the user
 * sees — important for read-mostly fields that arrive pre-populated (analyser
 * outputs in the schedule + damage description). React's `ref` callbacks fire
 * before the value is reliably measurable, so we use a ref + effect instead.
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(minHeight, el.scrollHeight) + 'px';
  }, [value, minHeight]);

  return (
    <textarea
      ref={ref}
      value={value || ''}
      onChange={onChange}
      onBlur={onBlur}
      className={className}
      style={{ minHeight, overflow: 'hidden', resize: 'none', ...style }}
      {...rest}
    />
  );
}
