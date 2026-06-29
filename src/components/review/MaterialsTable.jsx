import React, { useState, useEffect, useCallback } from 'react';
import useDragReorder from '../../hooks/useDragReorder.js';

function BlurNumberInput({ value: propValue, onCommit, className, style }) {
  const [local, setLocal] = useState(String(propValue ?? ''));

  useEffect(() => {
    setLocal(String(propValue ?? ''));
  }, [propValue]);

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="next"
      autoComplete="off"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(parseFloat(local) || 0)}
      className={className}
      style={{ minHeight: 44, ...(style || {}) }}
    />
  );
}

export default function MaterialsTable({ materials = [], dispatch }) {
  const updateMaterial = (index, field, value) => {
    const updated = materials.map((m, i) => {
      if (i !== index) return m;
      const mat = { ...m, [field]: value };
      if (field === 'unitCost' || field === 'quantity') {
        const qty = parseFloat(field === 'quantity' ? value : mat.quantity) || 0;
        const cost = parseFloat(field === 'unitCost' ? value : mat.unitCost) || 0;
        mat.totalCost = Math.round(qty * cost * 100) / 100;
      }
      return mat;
    });
    dispatch({ type: 'UPDATE_MATERIALS', materials: updated });
  };

  const removeMaterial = (index) => {
    dispatch({
      type: 'UPDATE_MATERIALS',
      materials: materials.filter((_, i) => i !== index),
    });
  };

  const addMaterial = () => {
    dispatch({
      type: 'UPDATE_MATERIALS',
      materials: [
        ...materials,
        { id: `mat-new-${Date.now()}`, description: '', quantity: '', unit: 'Item', unitCost: 0, totalCost: 0 },
      ],
    });
  };

  // Drag-to-reorder (desktop)
  const { dragState, getItemProps, getDragHandleProps } = useDragReorder({
    items: materials,
    onReorder: (reordered) => dispatch({ type: 'UPDATE_MATERIALS', materials: reordered }),
  });

  // Move item (mobile up/down)
  const moveItem = useCallback((from, to) => {
    if (to < 0 || to >= materials.length) return;
    const next = [...materials];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    dispatch({ type: 'UPDATE_MATERIALS', materials: next });
  }, [materials, dispatch]);

  const UNIT_OPTIONS = ['m²', 't', 'Item', 'lin.m', 'Nr', 'days'];

  const inputClass = "w-full bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none min-h-[44px]";

  return (
    <div>
      <div className="eyebrow mb-2">Materials</div>

      {/* Desktop table */}
      <div className="hidden fq:block overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 420 }}>
        <thead>
          <tr className="border-b border-tq-border text-tq-muted text-xs">
            <th className="w-7"></th>
            <th className="text-left px-1.5 py-1" style={{ minWidth: 140 }}>Description</th>
            <th className="text-left px-1.5 py-1 w-14">Qty</th>
            <th className="text-left px-1.5 py-1 w-14">Unit</th>
            <th className="text-left px-1.5 py-1 w-20">Rate {'£'}</th>
            <th className="text-right px-1.5 py-1 w-20">Total</th>
            <th className="w-7"></th>
          </tr>
        </thead>
        <tbody>
          {materials.map((mat, i) => (
            <tr
              key={mat.id || i}
              {...getItemProps(i)}
              className={`border-b border-tq-border/50 ${dragState.dragIndex === i ? 'opacity-50' : ''} ${dragState.isDragging && dragState.overIndex === i ? 'border-t-2 border-t-tq-accent' : ''}`}
            >
              <td className="px-1 py-1 text-center" {...getDragHandleProps(i)}>
                <span style={{ cursor: 'grab' }} className="text-tq-muted text-xs select-none">{'⠇'}</span>
              </td>
              <td className="px-1.5 py-1">
                <input
                  value={mat.description}
                  onChange={(e) => updateMaterial(i, 'description', e.target.value)}
                  className={inputClass}
                  style={{ minHeight: 44 }}
                />
              </td>
              <td className="px-1.5 py-1">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={mat.quantity}
                  onChange={(e) => updateMaterial(i, 'quantity', e.target.value)}
                  className={inputClass}
                  style={{ minHeight: 44 }}
                />
              </td>
              <td className="px-1.5 py-1">
                <select
                  value={mat.unit || 'Item'}
                  onChange={(e) => updateMaterial(i, 'unit', e.target.value)}
                  className="bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none cursor-pointer w-full min-h-[44px]"
                >
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </td>
              <td className="px-1.5 py-1">
                <BlurNumberInput
                  value={mat.unitCost}
                  onCommit={(v) => updateMaterial(i, 'unitCost', v)}
                  className={`${inputClass} font-mono`}
                />
              </td>
              <td className="px-1.5 py-1 text-right font-mono text-tq-text whitespace-nowrap">
                {'£'}{(mat.totalCost || 0).toFixed(2)}
              </td>
              <td className="px-1 py-1 text-center">
                <button
                  onClick={() => removeMaterial(i)}
                  className="touch-44 text-tq-muted hover:text-tq-error text-sm"
                  aria-label="Remove material"
                >
                  {'×'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Mobile cards — re-flowed from grid-cols-4 to grid-cols-2 with 44px
          touch targets and explicit up/down move buttons (PR-5+6). */}
      <div className="fq:hidden space-y-3">
        {materials.map((mat, i) => (
          <div key={mat.id || i} className="border border-tq-border rounded p-3">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveItem(i, i - 1)}
                  disabled={i === 0}
                  className="touch-44 text-tq-muted hover:text-tq-accent text-sm disabled:opacity-30"
                  aria-label="Move material up"
                >
                  {'↑'}
                </button>
                <button
                  onClick={() => moveItem(i, i + 1)}
                  disabled={i === materials.length - 1}
                  className="touch-44 text-tq-muted hover:text-tq-accent text-sm disabled:opacity-30"
                  aria-label="Move material down"
                >
                  {'↓'}
                </button>
              </div>
              <input
                value={mat.description}
                onChange={(e) => updateMaterial(i, 'description', e.target.value)}
                className="flex-1 bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none font-medium min-h-[44px]"
                placeholder="Description"
              />
              <button
                onClick={() => removeMaterial(i)}
                className="touch-44 text-tq-muted hover:text-tq-error text-sm"
                aria-label="Remove material"
              >
                {'×'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Qty</label>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={mat.quantity}
                  onChange={(e) => updateMaterial(i, 'quantity', e.target.value)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 text-sm text-tq-text outline-none focus:border-tq-accent min-h-[44px]"
                />
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Unit</label>
                <select
                  value={mat.unit || 'Item'}
                  onChange={(e) => updateMaterial(i, 'unit', e.target.value)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 text-sm text-tq-text outline-none focus:border-tq-accent cursor-pointer min-h-[44px]"
                >
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Rate {'£'}</label>
                <BlurNumberInput
                  value={mat.unitCost}
                  onCommit={(v) => updateMaterial(i, 'unitCost', v)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 text-sm font-mono text-tq-text outline-none focus:border-tq-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Total</label>
                <div className="px-2 py-1 text-sm font-mono text-tq-text flex items-center min-h-[44px]">
                  {'£'}{(mat.totalCost || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addMaterial}
        className="text-tq-accent text-sm mt-2 hover:text-tq-accent-dark"
        style={{ minHeight: 44, padding: '8px 0' }}
      >
        + Add material
      </button>
    </div>
  );
}
