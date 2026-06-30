import React, { useEffect } from 'react';

/**
 * HelpModal — in-app help / contact surface (Harry's launch checklist
 * 2026-06-30).
 *
 * Before this, confused users hitting bugs mid-flow had no escape
 * hatch — the footer email lived on the landing page only, and once
 * past the auth gate there was no in-app help path. This modal mounts
 * globally in App.jsx (gated on `showHelp`) and is reachable from:
 *
 *   - Desktop: a small "Help" link in the side rail (Sidebar.jsx),
 *     below the rail-quota chip and above the avatar block.
 *   - Mobile: a "Need help?" link inside the existing Profile modal
 *     (mounted from App.jsx, opened by the BottomNav profile button).
 *
 * Both routes open the same HelpModal — single source of truth.
 *
 * Deliberately NOT a contact form. We surface the email channel
 * (fastquote@harrydoyle.uk) + a tight micro-FAQ for the four most
 * likely real questions. No "Send" button, no message textarea.
 *
 * Visibility: basic-user surface. No banned vocab in copy (the FAQ
 * summary "Why is my quote stuck on AI Analysis?" is fine — it
 * mirrors the actual UI label the user has seen).
 */
const HELP_EMAIL = 'fastquote@harrydoyle.uk';

export default function HelpModal({ open, onClose, showToast }) {
  // ESC to close. Mounted only when `open` so the listener doesn't
  // leak on every render — useEffect cleanup removes it on close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('fastquote@harrydoyle.uk');
      showToast?.('Email copied to clipboard', 'success');
    } catch {
      // Swallow — user can long-press the mailto link instead.
      showToast?.('Could not copy — try the mailto link', 'error');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 460,
          maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1.5px solid var(--tq-border)',
          boxShadow: '0 24px 60px -12px rgba(40,28,12,0.4)',
        }}
      >
        {/* Header band — daylight palette, matches StatusModal +
            QuotaExhaustedModal structure. */}
        <div
          style={{
            padding: '18px 22px',
            background: 'var(--tq-accent-bg, rgba(189,94,9,0.08))',
            borderBottom: '1.5px solid var(--tq-accent-bd, var(--tq-accent))',
            flexShrink: 0,
          }}
        >
          <h3
            id="help-modal-title"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800, fontSize: 22, color: 'var(--tq-text)',
              margin: 0, letterSpacing: '0.01em',
            }}
          >
            Need a hand?
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--tq-muted)', fontSize: 13.5 }}>
            We're a small team — most messages get a reply within a few hours.
          </p>
        </div>

        {/* Body — single scrolling region. Sticky footer pins below. */}
        <div
          style={{
            padding: '20px 22px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            flex: '1 1 auto',
          }}
        >
          {/* Section 1 — Email us */}
          <section style={{ marginBottom: 22 }}>
            <h4
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--tq-muted)',
                margin: '0 0 8px',
              }}
            >
              Email us
            </h4>
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
              }}
            >
              <a
                href="mailto:fastquote@harrydoyle.uk"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 14, color: 'var(--tq-accent)',
                  textDecoration: 'underline',
                  wordBreak: 'break-all',
                  minHeight: 44,
                  display: 'inline-flex', alignItems: 'center',
                }}
              >
                fastquote@harrydoyle.uk
              </a>
              <button
                type="button"
                onClick={handleCopyEmail}
                style={{
                  padding: '10px 14px', borderRadius: 6,
                  border: '1px solid var(--tq-border)',
                  background: 'transparent', color: 'var(--tq-text)',
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 700, fontSize: 12, letterSpacing: '0.06em',
                  textTransform: 'uppercase', cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                Copy email
              </button>
            </div>
          </section>

          {/* Section 2 — What to include */}
          <section style={{ marginBottom: 22 }}>
            <h4
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--tq-muted)',
                margin: '0 0 8px',
              }}
            >
              What to include for a faster fix
            </h4>
            <ul
              style={{
                margin: 0, paddingLeft: 20,
                color: 'var(--tq-text)', fontSize: 14, lineHeight: 1.55,
              }}
            >
              <li>A screenshot of what you're seeing</li>
              <li>What you were trying to do</li>
              <li>Your email address so we can reply</li>
            </ul>
          </section>

          {/* Section 3 — Quick answers (micro-FAQ accordion). The
              "AI Analysis" mention inside the first summary is fine
              because it mirrors the actual UI label the user has
              seen on Step 3 (loading screen). */}
          <section>
            <h4
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--tq-muted)',
                margin: '0 0 8px',
              }}
            >
              Quick answers
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <details
                style={{
                  border: '1px solid var(--tq-border)', borderRadius: 6,
                  padding: '10px 12px', background: 'var(--tq-surface)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer', fontWeight: 600, fontSize: 14,
                    color: 'var(--tq-text)',
                  }}
                >
                  Why is my quote stuck on AI Analysis?
                </summary>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--tq-muted)', lineHeight: 1.5 }}>
                  Usually a slow network or a very large photo. Refresh — your draft is saved. If it persists, email us.
                </p>
              </details>

              <details
                style={{
                  border: '1px solid var(--tq-border)', borderRadius: 6,
                  padding: '10px 12px', background: 'var(--tq-surface)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer', fontWeight: 600, fontSize: 14,
                    color: 'var(--tq-text)',
                  }}
                >
                  How do I change my logo or day rate?
                </summary>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--tq-muted)', lineHeight: 1.5 }}>
                  Tap your avatar (bottom-left on desktop, bottom-right on mobile) → Profile → Business / Rates &amp; tax sections.
                </p>
              </details>

              <details
                style={{
                  border: '1px solid var(--tq-border)', borderRadius: 6,
                  padding: '10px 12px', background: 'var(--tq-surface)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer', fontWeight: 600, fontSize: 14,
                    color: 'var(--tq-text)',
                  }}
                >
                  I bought 5 quotes but my counter still says exhausted.
                </summary>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--tq-muted)', lineHeight: 1.5 }}>
                  Try a refresh first. If it's still stuck, the payment webhook may have failed — email us with the transaction date and we'll fix it manually.
                </p>
              </details>

              <details
                style={{
                  border: '1px solid var(--tq-border)', borderRadius: 6,
                  padding: '10px 12px', background: 'var(--tq-surface)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer', fontWeight: 600, fontSize: 14,
                    color: 'var(--tq-text)',
                  }}
                >
                  How do I download a copy of my data?
                </summary>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--tq-muted)', lineHeight: 1.5 }}>
                  Email us — we'll export everything tied to your account. It's a quick query our side.
                </p>
              </details>
            </div>
          </section>
        </div>

        {/* Sticky footer — single Close button. Deliberately no Send
            (this is not a contact form). */}
        <div
          style={{
            display: 'flex', justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid var(--tq-border)',
            background: 'var(--tq-card)',
            position: 'sticky', bottom: 0,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px', borderRadius: 6,
              border: '1px solid var(--tq-border)',
              background: 'transparent', color: 'var(--tq-muted)',
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700, fontSize: 13, letterSpacing: '0.04em',
              textTransform: 'uppercase', cursor: 'pointer',
              minHeight: 44,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Suppress unused-warning for the HELP_EMAIL constant — kept for
// future single-source-of-truth refactor if more surfaces need it.
void HELP_EMAIL;
