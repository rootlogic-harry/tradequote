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
        { id: `mat-new-${Date.now()}`, description: '', quantity: '', unitCost: 0, totalCost: 0 },
      ],
    });
  };

  return (
    <div>
      <h4 className="font-heading font-bold text-sm text-tq-muted uppercase tracking-wide mb-2">
        Materials
      </h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tq-border text-tq-muted text-xs">
            <th className="text-left px-2 py-1">Description</th>
            <th className="text-left px-2 py-1 w-20">Qty</th>
            <th className="text-left px-2 py-1 w-24">Unit {'\u00A3'}</th>
            <th className="text-right px-2 py-1 w-24">Total</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {materials.map((mat, i) => (
            <tr key={mat.id || i} className="border-b border-tq-border/50">
              <td className="px-2 py-1">
                <input
                  value={mat.description}
                  onChange={(e) => updateMaterial(i, 'description', e.target.value)}
                  className="w-full bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  value={mat.quantity}
                  onChange={(e) => updateMaterial(i, 'quantity', e.target.value)}
                  className="w-full bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm outline-none"
                />
              </td>
              <td className="px-2 py-1">
                <BlurNumberInput
                  value={mat.unitCost}
                  onCommit={(v) => updateMaterial(i, 'unitCost', v)}
                  className="w-full bg-transparent border-b border-transparent hover:border-tq-border focus:border-tq-accent text-tq-text text-sm font-mono outline-none"
                />
              </td>
              <td className="px-2 py-1 text-right font-mono text-tq-text">
                {'\u00A3'}{(mat.totalCost || 0).toFixed(2)}
              </td>
              <td className="px-2 py-1 text-center">
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
      <button
        onClick={addMaterial}
        className="text-tq-accent text-xs mt-2 hover:text-tq-accent-dark"
      >
        + Add material
      </button>
    </div>
  );
}
