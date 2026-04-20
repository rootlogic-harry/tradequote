import React from 'react';
import AutoGrowTextarea from '../common/AutoGrowTextarea.jsx';

export default function ScheduleList({ scheduleOfWorks = [], dispatch }) {
  const updateStep = (index, field, value) => {
    const updated = scheduleOfWorks.map((s, i) =>
      i === index ? { ...s, [field]: value } : s
    );
    dispatch({ type: 'UPDATE_SCHEDULE', schedule: updated });
  };

  const removeStep = (index) => {
    const updated = scheduleOfWorks
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stepNumber: i + 1 }));
    dispatch({ type: 'UPDATE_SCHEDULE', schedule: updated });
  };

  const addStep = () => {
    dispatch({
      type: 'UPDATE_SCHEDULE',
      schedule: [
        ...scheduleOfWorks,
        {
          id: `sow-new-${Date.now()}`,
          stepNumber: scheduleOfWorks.length + 1,
          title: '',
          description: '',
        },
      ],
    });
  };

  return (
    <div>
      <div className="eyebrow mb-3">Schedule of Works</div>

      <div className="space-y-2">
        {scheduleOfWorks.map((step, i) => (
          <div
            key={step.id || i}
            className="flex items-start gap-3 p-3"
            style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}
          >
            <span
              className="flex items-center justify-center text-xs font-mono font-bold flex-shrink-0 mt-0.5"
              style={{
                width: 28, height: 28, borderRadius: 2,
                backgroundColor: 'var(--tq-accent)', color: '#ffffff',
              }}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <input
                value={step.title}
                onChange={(e) => updateStep(i, 'title', e.target.value)}
                className="w-full bg-transparent text-tq-text font-heading font-bold text-sm border-b border-transparent hover:border-tq-border focus:border-tq-accent outline-none mb-1"
                placeholder="Step title"
              />
              <AutoGrowTextarea
                value={step.description}
                onChange={(e) => updateStep(i, 'description', e.target.value)}
                onBlur={(e) => updateStep(i, 'description', e.target.value)}
                rows={6}
                minHeight={140}
                className="w-full bg-transparent text-tq-text text-sm border border-tq-border/40 hover:border-tq-border focus:border-tq-accent outline-none leading-relaxed p-2 rounded"
                placeholder="Description"
              />
            </div>
            <button
              onClick={() => removeStep(i)}
              className="text-tq-muted hover:text-tq-error text-sm flex-shrink-0"
            >
              {'\u00D7'}
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addStep}
        className="text-tq-accent text-xs mt-3 hover:text-tq-accent-dark"
        style={{ minHeight: 44, padding: '8px 0' }}
      >
        + Add step
      </button>
    </div>
  );
}
