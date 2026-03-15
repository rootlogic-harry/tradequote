import React from 'react';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayFormatted() {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

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
  savedJobs = [],
}) {
  // Stat calculations
  const thisMonthTotal = savedJobs.reduce((sum, j) => sum + (j.totalAmount || 0), 0);
  const recentJobs = savedJobs.slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header row */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="mb-1"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 32, color: 'var(--tq-text)' }}
          >
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            {todayFormatted()}
          </p>
        </div>
        <button
          onClick={onStartNewQuote}
          className="shrink-0 rounded transition-colors"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 15,
            backgroundColor: 'var(--tq-accent)',
            color: '#ffffff',
            padding: '10px 20px',
          }}
        >
          + NEW QUOTE
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>This month</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(thisMonthTotal)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
            {savedJobs.length} quote{savedJobs.length !== 1 ? 's' : ''} total
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>Awaiting response</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>0</div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>quotes sent</div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>Accepted</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>0</div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>this month</div>
        </div>
      </div>

      {/* Current draft banner */}
      {currentDraft && (
        <div
          className="rounded-lg p-4 flex items-center justify-between mb-6"
          style={{ backgroundColor: 'var(--tq-accent-bg)', border: '1.5px solid var(--tq-accent-bd)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-status-draft)', color: 'var(--tq-status-draft-txt)' }}
              >
                Draft
              </span>
              <span className="font-heading font-bold text-tq-text truncate">
                {currentDraft.jobDetails?.clientName || 'Untitled'}
              </span>
            </div>
            <p className="text-sm truncate" style={{ color: 'var(--tq-muted)' }}>
              {currentDraft.jobDetails?.siteAddress || 'No address'}
              {currentDraft.step ? ` — Step ${currentDraft.step}` : ''}
            </p>
          </div>
          <button
            onClick={onResumeDraft}
            className="ml-4 font-heading font-bold uppercase tracking-wide text-xs px-4 py-2 rounded transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
          >
            Resume
          </button>
        </div>
      )}

      {/* Incomplete jobs (needs RAMS) */}
      {incompleteJobs && incompleteJobs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-heading font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--tq-muted)' }}>
            Needs Attention
          </h2>
          <div className="space-y-2">
            {incompleteJobs.map(job => (
              <div
                key={job.id}
                className="rounded-lg p-4 flex items-center justify-between"
                style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-status-sent)', color: 'var(--tq-status-sent-txt)' }}
                    >
                      Needs RAMS
                    </span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--tq-accent)' }}>
                      {job.quoteReference}
                    </span>
                  </div>
                  <div className="font-heading font-bold truncate" style={{ color: 'var(--tq-text)' }}>
                    {job.clientName || 'Unnamed client'}
                  </div>
                </div>
                <div className="ml-4 flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => onCreateRamsFromSaved(job)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                    style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
                  >
                    Create RAMS
                  </button>
                  <button
                    onClick={() => onMarkRamsNotRequired(job.id)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                    style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-muted)' }}
                  >
                    Not Needed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent jobs card */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--tq-border-soft)' }}>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--tq-text)' }}>
            RECENT JOBS
          </span>
          <button
            onClick={onViewJobs}
            className="text-xs"
            style={{ color: 'var(--tq-accent)', fontWeight: 500 }}
          >
            View all &rarr;
          </button>
        </div>

        {recentJobs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--tq-muted)' }}>
            No jobs yet. Start a new quote to get going.
          </div>
        ) : (
          <div>
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-4 px-5 py-3"
                style={{ borderBottom: '1px solid var(--tq-border-soft)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
                    {job.clientName || 'Unnamed'}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                    {job.quoteReference}{job.siteAddress ? ` · ${job.siteAddress}` : ''}
                  </div>
                </div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
                  {formatCurrency(job.totalAmount || 0)}
                </div>
                <div className="text-xs hidden sm:block" style={{ color: 'var(--tq-muted)', minWidth: 80 }}>
                  {job.quoteDate ? formatDate(job.quoteDate) : '\u2014'}
                </div>
                <span
                  className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0"
                  style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    fontWeight: 700,
                    backgroundColor: 'var(--tq-status-draft)',
                    color: 'var(--tq-status-draft-txt)',
                  }}
                >
                  DRAFT
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
