import React from 'react';

export default function ScheduleList({ scheduleOfWorks, dispatch }) {
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
      <h3 className="text-lg font-heading font-bold text-tq-text mb-3">
        Schedule of Works
      </h3>

      <div className="space-y-3">
        {scheduleOfWorks.map((step, i) => (
          <div
            key={step.id || i}
            className="bg-tq-card border border-tq-border rounded p-3"
          >
            <div className="flex items-start gap-3">
              <span className="bg-tq-accent text-tq-bg w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1">
                <input
                  value={step.title}
                  onChange={(e) => updateStep(i, 'title', e.target.value)}
                  className="w-full bg-transparent text-tq-text font-heading font-bold text-sm border-b border-transparent hover:border-tq-border focus:border-tq-accent outline-none mb-1"
                  placeholder="Step title"
                />
                <textarea
                  value={step.description}
                  onChange={(e) => updateStep(i, 'description', e.target.value)}
                  rows={2}
                  className="w-full bg-transparent text-tq-text text-sm border-b border-transparent hover:border-tq-border focus:border-tq-accent outline-none resize-none"
                  placeholder="Description"
                />
              </div>
              <button
                onClick={() => removeStep(i)}
                className="text-tq-muted hover:text-tq-error text-sm flex-shrink-0"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addStep}
        className="text-tq-accent text-xs mt-3 hover:text-tq-accent-dark"
      >
        + Add step
      </button>
    </div>
  );
}
