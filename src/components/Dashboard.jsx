import React from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';

export default function Dashboard({
  userName,
  onStartNewQuote,
  onViewJobs,
  incompleteJobs,
  currentDraft,
  onResumeDraft,
  onResumeJob,
  onMarkRamsNotRequired,
  onCreateRamsFromSaved,
}) {
  const hasIncompleteWork = currentDraft || (incompleteJobs && incompleteJobs.length > 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-3xl font-heading font-bold text-tq-accent mb-1">
          Welcome back{userName ? `, ${userName}` : ''}
        </h1>
        <p className="text-tq-muted text-sm">
          What would you like to do?
        </p>
      </div>

      {/* Action Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {/* Start New Quote */}
        <button
          onClick={onStartNewQuote}
          className="bg-tq-surface border border-tq-border rounded-lg p-6 text-left hover:border-tq-accent transition-colors group"
        >
          <div className="text-3xl mb-3 opacity-70 group-hover:opacity-100 transition-opacity">+</div>
          <h2 className="font-heading font-bold text-tq-text text-lg mb-1">Start New Quote</h2>
          <p className="text-tq-muted text-sm">Begin a fresh quote from job details</p>
        </button>

        {/* View Saved Jobs */}
        <button
          onClick={onViewJobs}
          className="bg-tq-surface border border-tq-border rounded-lg p-6 text-left hover:border-tq-accent transition-colors group"
        >
          <div className="text-3xl mb-3 opacity-70 group-hover:opacity-100 transition-opacity">&#128193;</div>
          <h2 className="font-heading font-bold text-tq-text text-lg mb-1">View Saved Jobs</h2>
          <p className="text-tq-muted text-sm">Browse and manage your completed quotes</p>
        </button>

        {/* Quick Stats Card */}
        <div className="bg-tq-surface border border-tq-border rounded-lg p-6">
          <div className="text-3xl mb-3 opacity-70">&#128200;</div>
          <h2 className="font-heading font-bold text-tq-text text-lg mb-1">Quick Stats</h2>
          <p className="text-tq-muted text-sm">
            {incompleteJobs?.length || 0} job{(incompleteJobs?.length || 0) !== 1 ? 's' : ''} needing attention
          </p>
        </div>
      </div>

      {/* Incomplete Work Section */}
      {hasIncompleteWork && (
        <div>
          <h2 className="text-xl font-heading font-bold text-tq-text mb-4">
            Incomplete Work
          </h2>

          <div className="space-y-3">
            {/* Current Draft */}
            {currentDraft && (
              <div className="bg-tq-surface border border-tq-accent/40 rounded-lg p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-tq-accent/20 text-tq-accent">
                      Draft
                    </span>
                    <span className="font-heading font-bold text-tq-text truncate">
                      {currentDraft.jobDetails?.clientName || 'Untitled'}
                    </span>
                  </div>
                  <p className="text-tq-muted text-sm truncate">
                    {currentDraft.jobDetails?.siteAddress || 'No address'}
                    {currentDraft.step ? ` — Step ${currentDraft.step}` : ''}
                  </p>
                </div>
                <button
                  onClick={onResumeDraft}
                  className="ml-4 bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-4 py-2 rounded transition-colors whitespace-nowrap"
                >
                  Resume
                </button>
              </div>
            )}

            {/* Incomplete Jobs (missing RAMS) */}
            {incompleteJobs?.map(job => (
              <div
                key={job.id}
                className="bg-tq-surface border border-tq-border rounded-lg p-4 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      Needs RAMS
                    </span>
                    <span className="font-mono text-tq-accent text-sm font-bold">
                      {job.quoteReference}
                    </span>
                  </div>
                  <div className="font-heading font-bold text-tq-text truncate">
                    {job.clientName || 'Unnamed client'}
                  </div>
                  <p className="text-tq-muted text-sm truncate">
                    {job.siteAddress || 'No address'}
                    {job.totalAmount ? ` — ${formatCurrency(job.totalAmount)}` : ''}
                  </p>
                </div>
                <div className="ml-4 flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => onCreateRamsFromSaved(job)}
                    className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                  >
                    Create RAMS
                  </button>
                  <button
                    onClick={() => onMarkRamsNotRequired(job.id)}
                    className="border border-tq-border text-tq-muted hover:text-tq-text font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                  >
                    No RAMS Needed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
