import { useState, useRef, useCallback } from 'react';

/**
 * Custom hook for drag-to-reorder using Pointer Events.
 * Works with mouse AND touch (unified via Pointer Events API).
 *
 * Distinguishes tap from drag via:
 *   - 200ms hold timeout, OR
 *   - 8px movement from pointer-down position
 *
 * @param {Object} options
 * @param {any[]}  options.items       — the array to reorder
 * @param {Function} options.onReorder — called with the new array after a drop
 * @returns {{ dragState, getItemProps, getDragHandleProps }}
 */
export default function useDragReorder({ items, onReorder }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const startPos = useRef(null);
  const holdTimer = useRef(null);
  const dragging = useRef(false);
  const dragIdx = useRef(null);

  const cleanup = useCallback(() => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    startPos.current = null;
    dragging.current = false;
    dragIdx.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const beginDrag = useCallback((index) => {
    dragging.current = true;
    dragIdx.current = index;
    setDragIndex(index);
  }, []);

  const handlePointerDown = useCallback((index, e) => {
    // Only primary button
    if (e.button !== 0) return;

    startPos.current = { x: e.clientX, y: e.clientY };
    e.target.setPointerCapture(e.pointerId);

    // Start hold timer — 200ms triggers drag
    holdTimer.current = setTimeout(() => {
      beginDrag(index);
    }, 200);
  }, [beginDrag]);

  const handlePointerMove = useCallback((index, e) => {
    if (dragging.current) {
      // Already dragging — detect which item we're over
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of els) {
        const itemEl = el.closest('[data-drag-index]');
        if (itemEl) {
          const overIdx = parseInt(itemEl.dataset.dragIndex, 10);
          if (!isNaN(overIdx) && overIdx !== dragIdx.current) {
            setOverIndex(overIdx);
          }
          break;
        }
      }
      return;
    }

    // Not yet dragging — check if movement exceeds 8px threshold
    if (startPos.current) {
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) >= 8) {
        clearTimeout(holdTimer.current);
        beginDrag(index);
      }
    }
  }, [beginDrag]);

  const handlePointerUp = useCallback(() => {
    if (dragging.current && dragIdx.current != null && overIndex != null && dragIdx.current !== overIndex) {
      // Reorder: move dragIdx to overIndex position
      const newItems = [...items];
      const [moved] = newItems.splice(dragIdx.current, 1);
      newItems.splice(overIndex, 0, moved);
      onReorder(newItems);
    }
    cleanup();
  }, [items, overIndex, onReorder, cleanup]);

  const handlePointerCancel = useCallback(() => {
    cleanup();
  }, [cleanup]);

  /**
   * Props to spread on each draggable item container.
   * Pass the item's current index.
   */
  const getItemProps = useCallback((index) => ({
    'data-drag-index': index,
  }), []);

  /**
   * Props to spread on the drag handle element within each item.
   * Pass the item's current index.
   */
  const getDragHandleProps = useCallback((index) => ({
    onPointerDown: (e) => handlePointerDown(index, e),
    onPointerMove: (e) => handlePointerMove(index, e),
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    style: { touchAction: 'none', cursor: 'grab' },
  }), [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel]);

  const dragState = {
    isDragging: dragIndex != null,
    dragIndex,
    overIndex,
  };

  return { dragState, getItemProps, getDragHandleProps };
}
