import React, { useState, useEffect } from 'react';

function BlurNumberInput({ value: propValue, onCommit, className }) {
  const [local, setLocal] = useState(String(propValue ?? ''));

  useEffect(() => {
    setLocal(String(propValue ?? ''));
  }, [propValue]);

  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(parseFloat(local) || 0)}
      className={className}
    />
  );
}

export default function MaterialsTable({ materials, dispatch }) {
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

  const UNIT_OPTIONS = ['m\u00B2', 't', 'Item', 'lin.m', 'Nr', 'days'];

  const inputClass = "w-full bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none";

  return (
    <div>
      <h4 className="font-heading font-bold text-sm text-tq-muted uppercase tracking-wide mb-2">
        Materials
      </h4>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 420 }}>
        <thead>
          <tr className="border-b border-tq-border text-tq-muted text-xs">
            <th className="text-left px-1.5 py-1" style={{ minWidth: 140 }}>Description</th>
            <th className="text-left px-1.5 py-1 w-14">Qty</th>
            <th className="text-left px-1.5 py-1 w-14">Unit</th>
            <th className="text-left px-1.5 py-1 w-20">Rate {'\u00A3'}</th>
            <th className="text-right px-1.5 py-1 w-20">Total</th>
            <th className="w-7"></th>
          </tr>
        </thead>
        <tbody>
          {materials.map((mat, i) => (
            <tr key={mat.id || i} className="border-b border-tq-border/50">
              <td className="px-1.5 py-1">
                <input
                  value={mat.description}
                  onChange={(e) => updateMaterial(i, 'description', e.target.value)}
                  className={inputClass}
                />
              </td>
              <td className="px-1.5 py-1">
                <input
                  value={mat.quantity}
                  onChange={(e) => updateMaterial(i, 'quantity', e.target.value)}
                  className={inputClass}
                />
              </td>
              <td className="px-1.5 py-1">
                <select
                  value={mat.unit || 'Item'}
                  onChange={(e) => updateMaterial(i, 'unit', e.target.value)}
                  className="bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none cursor-pointer w-full"
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
                {'\u00A3'}{(mat.totalCost || 0).toFixed(2)}
              </td>
              <td className="px-1 py-1 text-center">
                <button
                  onClick={() => removeMaterial(i)}
                  className="text-tq-muted hover:text-tq-error text-sm"
                >
                  {'\u00D7'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {materials.map((mat, i) => (
          <div key={mat.id || i} className="border border-tq-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <input
                value={mat.description}
                onChange={(e) => updateMaterial(i, 'description', e.target.value)}
                className="flex-1 bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none font-medium"
                placeholder="Description"
              />
              <button
                onClick={() => removeMaterial(i)}
                className="text-tq-muted hover:text-tq-error text-sm ml-2"
              >
                {'\u00D7'}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Qty</label>
                <input
                  value={mat.quantity}
                  onChange={(e) => updateMaterial(i, 'quantity', e.target.value)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 py-1 text-sm text-tq-text outline-none focus:border-tq-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Unit</label>
                <select
                  value={mat.unit || 'Item'}
                  onChange={(e) => updateMaterial(i, 'unit', e.target.value)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 py-1 text-sm text-tq-text outline-none focus:border-tq-accent cursor-pointer"
                >
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Rate {'\u00A3'}</label>
                <BlurNumberInput
                  value={mat.unitCost}
                  onCommit={(v) => updateMaterial(i, 'unitCost', v)}
                  className="w-full bg-tq-card border border-tq-border rounded px-2 py-1 text-sm font-mono text-tq-text outline-none focus:border-tq-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-tq-muted mb-0.5">Total</label>
                <div className="px-2 py-1 text-sm font-mono text-tq-text">
                  {'\u00A3'}{(mat.totalCost || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addMaterial}
        className="text-tq-accent text-xs mt-2 hover:text-tq-accent-dark"
      >
        + Add material
      </button>
    </div>
  );
}
