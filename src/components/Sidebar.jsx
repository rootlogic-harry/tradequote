import React, { useEffect, useRef } from 'react';

export default function Sidebar({
  currentView,
  onNavigate,
  onStartNewQuote,
  onGoToDashboard,
  incompleteJobs,
  onResumeJob,
  onMarkRamsNotRequired,
  currentQuoteSummary,
  isCollapsed,
  onToggleCollapse,
  onCreateRamsFromSaved,
  savedJobCount,
}) {
  const drawerRef = useRef(null);

  // Mobile: close drawer on outside click
  useEffect(() => {
    if (isCollapsed) return;
    function handleClick(e) {
      if (window.innerWidth >= 768) return;
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        onToggleCollapse();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isCollapsed, onToggleCollapse]);

  // Expanded sidebar content
  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-tq-border">
        <span className="font-heading font-bold text-tq-accent text-sm uppercase tracking-wide">
          Navigation
        </span>
        <button
          onClick={onToggleCollapse}
          className="text-tq-muted hover:text-tq-accent text-sm transition-colors"
          title="Collapse sidebar"
        >
          &#x00AB;
        </button>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 overflow-y-auto py-2">
        <NavItem
          label="Dashboard"
          icon="&#9632;"
          active={currentView === 'dashboard'}
          onClick={onGoToDashboard}
        />
        <NavItem
          label="New Quote"
          icon="+"
          onClick={onStartNewQuote}
        />
        <NavItem
          label={`Saved Jobs${savedJobCount ? ` (${savedJobCount})` : ''}`}
          icon="&#128193;"
          active={currentView === 'saved'}
          onClick={() => onNavigate('saved')}
        />

        {/* In Progress Section */}
        {(currentQuoteSummary || (incompleteJobs && incompleteJobs.length > 0)) && (
          <div className="mt-4">
            <div className="px-4 py-1">
              <span className="text-[10px] font-heading font-bold uppercase tracking-widest text-tq-muted">
                In Progress
              </span>
            </div>

            {/* Current session quote */}
            {currentQuoteSummary && (
              <div className="mx-2 mb-1 p-3 bg-tq-card rounded border border-tq-accent/30">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-tq-accent text-xs font-bold">
                    {currentQuoteSummary.reference}
                  </span>
                  <span className="text-[9px] font-heading font-bold uppercase px-1.5 py-0.5 rounded bg-tq-accent/20 text-tq-accent">
                    Active
                  </span>
                </div>
                <div className="text-tq-text text-xs font-heading truncate">
                  {currentQuoteSummary.clientName || 'New Quote'}
                </div>
                <div className="text-tq-muted text-[11px] mb-2">
                  Step {currentQuoteSummary.step}
                </div>
                {currentView !== 'editor' && (
                  <button
                    onClick={() => onNavigate('editor')}
                    className="w-full bg-tq-accent/20 hover:bg-tq-accent/30 text-tq-accent font-heading font-bold uppercase tracking-wide text-[10px] px-2 py-1.5 rounded transition-colors"
                  >
                    Resume
                  </button>
                )}
              </div>
            )}

            {/* Incomplete saved jobs */}
            {incompleteJobs?.map(job => (
              <div key={job.id} className="mx-2 mb-1 p-3 bg-tq-card rounded border border-tq-border">
                <div className="font-mono text-tq-accent text-xs font-bold mb-0.5">
                  {job.quoteReference}
                </div>
                <div className="text-tq-text text-xs font-heading truncate">
                  {job.clientName || 'Unnamed'}
                </div>
                <div className="text-amber-400 text-[11px] mb-2">Needs RAMS</div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => onCreateRamsFromSaved(job)}
                    className="flex-1 bg-tq-accent/20 hover:bg-tq-accent/30 text-tq-accent font-heading font-bold uppercase tracking-wide text-[10px] px-2 py-1.5 rounded transition-colors"
                  >
                    RAMS
                  </button>
                  <button
                    onClick={() => onMarkRamsNotRequired(job.id)}
                    className="flex-1 border border-tq-border text-tq-muted hover:text-tq-text font-heading font-bold uppercase tracking-wide text-[10px] px-2 py-1.5 rounded transition-colors"
                    title="Mark as complete (no RAMS needed)"
                  >
                    N/A
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>
    </div>
  );

  // Collapsed sidebar (desktop only)
  const collapsedContent = (
    <div className="flex flex-col items-center py-2 gap-1">
      <button
        onClick={onToggleCollapse}
        className="w-10 h-10 flex items-center justify-center text-tq-muted hover:text-tq-accent transition-colors"
        title="Expand sidebar"
      >
        &#x00BB;
      </button>
      <button
        onClick={onGoToDashboard}
        className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
          currentView === 'dashboard' ? 'text-tq-accent bg-tq-card' : 'text-tq-muted hover:text-tq-accent'
        }`}
        title="Dashboard"
      >
        &#9632;
      </button>
      <button
        onClick={onStartNewQuote}
        className="w-10 h-10 flex items-center justify-center text-tq-muted hover:text-tq-accent transition-colors"
        title="New Quote"
      >
        +
      </button>
      <button
        onClick={() => onNavigate('saved')}
        className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
          currentView === 'saved' ? 'text-tq-accent bg-tq-card' : 'text-tq-muted hover:text-tq-accent'
        }`}
        title="Saved Jobs"
      >
        &#128193;
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:block flex-shrink-0">
        <div
          className={`h-full bg-tq-surface border-r border-tq-border transition-all duration-200 ${
            isCollapsed ? 'w-12' : 'w-64'
          }`}
        >
          {isCollapsed ? collapsedContent : content}
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {!isCollapsed && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={drawerRef}
            className="absolute left-0 top-0 bottom-0 w-72 bg-tq-surface border-r border-tq-border shadow-xl animate-slide-in"
          >
            {content}
          </div>
        </div>
      )}
    </>
  );
}

function NavItem({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        active
          ? 'text-tq-accent bg-tq-card'
          : 'text-tq-text hover:bg-tq-card hover:text-tq-accent'
      }`}
    >
      <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
      <span className="font-heading text-sm font-medium truncate">{label}</span>
    </button>
  );
}
