import React from 'react';

export default function LandingPage({ onGetStarted, onLogIn }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0a',
        color: '#ffffff',
        fontFamily: '"IBM Plex Sans", sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* NAV */}
      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 2rem',
          borderBottom: '1px solid #222',
        }}
      >
        <span
          style={{
            fontFamily: '"Barlow Condensed", sans-serif',
            fontWeight: 700,
            fontSize: '1.5rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#FFD600',
          }}
        >
          TRADEQUOTE
        </span>
        <button
          onClick={onLogIn}
          style={{
            fontFamily: '"Barlow Condensed", sans-serif',
            fontWeight: 600,
            fontSize: '0.875rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#ffffff',
            background: 'transparent',
            border: '1px solid #555',
            borderRadius: '2px',
            padding: '0.5rem 1.25rem',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#FFD600')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#555')}
        >
          LOG IN
        </button>
      </nav>

      {/* HERO */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '3rem',
            alignItems: 'center',
          }}
          className="landing-hero-grid"
        >
          {/* Left column */}
          <div>
            {/* Kicker */}
            <p
              style={{
                fontFamily: '"Barlow Condensed", sans-serif',
                fontWeight: 600,
                fontSize: '0.8rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#FFD600',
                marginBottom: '1rem',
              }}
            >
              FOR TRADESPEOPLE, BY TRADESPEOPLE
            </p>

            {/* Headline */}
            <h1
              style={{
                fontFamily: '"Barlow Condensed", sans-serif',
                fontWeight: 700,
                fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                lineHeight: 1.1,
                marginBottom: '1.25rem',
                color: '#ffffff',
              }}
            >
              Professional quotes{' '}
              <span style={{ display: 'block' }}>
                in under{' '}
                <span style={{ color: '#FFD600' }}>5 minutes</span>
              </span>
            </h1>

            {/* Subtitle */}
            <p
              style={{
                fontSize: '1.2rem',
                color: '#9ca3af',
                marginBottom: '2rem',
                maxWidth: '520px',
              }}
            >
              3 photos and a job description. That's all it takes.
            </p>

            {/* Bullet points */}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 2.5rem 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              {[
                'Reduce quoting time 95%',
                'More accurate quotes',
                'Professional branded docs',
                'Less desk time, more jobs',
              ].map((item) => (
                <li
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    fontSize: '1rem',
                    color: '#d1d5db',
                  }}
                >
                  <span
                    style={{
                      color: '#FFD600',
                      fontWeight: 700,
                      fontSize: '1.2rem',
                      lineHeight: 1,
                    }}
                  >
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            {/* CTAs */}
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={onGetStarted}
                style={{
                  fontFamily: '"Barlow Condensed", sans-serif',
                  fontWeight: 700,
                  fontSize: '1rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  backgroundColor: '#FFD600',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '2px',
                  padding: '0.875rem 2.5rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E6C200')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFD600')}
              >
                GET STARTED
              </button>
              <a
                href="mailto:contact@tradequote.com"
                style={{
                  fontFamily: '"Barlow Condensed", sans-serif',
                  fontWeight: 600,
                  fontSize: '1rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#ffffff',
                  border: '1px solid #ffffff',
                  borderRadius: '2px',
                  padding: '0.875rem 2.5rem',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#FFD600';
                  e.currentTarget.style.color = '#FFD600';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#ffffff';
                  e.currentTarget.style.color = '#ffffff';
                }}
              >
                GET IN TOUCH
              </a>
            </div>
          </div>

          {/* Right column — How It Works card */}
          <div className="landing-how-it-works">
            <div
              style={{
                border: '1px solid #333',
                borderRadius: '2px',
                padding: '2rem',
                backgroundColor: '#111',
              }}
            >
              <h2
                style={{
                  fontFamily: '"Barlow Condensed", sans-serif',
                  fontWeight: 700,
                  fontSize: '1rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#FFD600',
                  marginBottom: '2rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid #333',
                }}
              >
                HOW IT WORKS
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {[
                  {
                    num: '01',
                    title: 'UPLOAD PHOTOS',
                    desc: 'Snap 3 photos of the job site. Our AI analyses the damage, stone type, and measurements.',
                  },
                  {
                    num: '02',
                    title: 'REVIEW & CONFIRM',
                    desc: 'Check every measurement and cost line. Edit anything. You stay in control — the AI just gives you a head start.',
                  },
                  {
                    num: '03',
                    title: 'SEND YOUR QUOTE',
                    desc: 'Download a professional PDF with your branding, ready to email to the client.',
                  },
                ].map((step) => (
                  <div key={step.num} style={{ display: 'flex', gap: '1rem' }}>
                    <span
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontWeight: 500,
                        fontSize: '1.5rem',
                        color: '#FFD600',
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      {step.num}
                    </span>
                    <div>
                      <h3
                        style={{
                          fontFamily: '"Barlow Condensed", sans-serif',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          color: '#ffffff',
                          marginBottom: '0.4rem',
                        }}
                      >
                        {step.title}
                      </h3>
                      <p
                        style={{
                          fontSize: '0.875rem',
                          color: '#9ca3af',
                          lineHeight: 1.5,
                          margin: 0,
                        }}
                      >
                        {step.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer
        style={{
          textAlign: 'center',
          padding: '1.5rem',
          borderTop: '1px solid #222',
          color: '#555',
          fontSize: '0.8rem',
          fontFamily: '"IBM Plex Sans", sans-serif',
        }}
      >
        TradeQuote 2026
      </footer>

      {/* Responsive styles */}
      <style>{`
        @media (min-width: 768px) {
          .landing-hero-grid {
            grid-template-columns: 3fr 2fr !important;
          }
        }
        @media (max-width: 767px) {
          .landing-how-it-works {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
