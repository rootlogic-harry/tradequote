/*
 * FastQuote landing — live demo controller + referral-link preserver.
 *
 * Three stages rotate on a fixed timing: 2.4s, 2.8s, 3.2s. Each stage:
 *   1. Hides the previous stage, shows the new one.
 *   2. Resets and runs the progress bar over the stage duration.
 *   3. On stage 2, reveals the numeric values 200ms after each row's
 *      slide-in animation lands.
 *
 * Pauses when scrolled off-screen (IntersectionObserver). Replay button
 * restarts from stage 1. Honours prefers-reduced-motion by holding the
 * punchline stage (3) statically — no rotation, no progress fill.
 *
 * Vanilla — no framework, no deps.
 */

// Referrals Phase 1 (2026-06-30 fix). The ReferralPanel shares URLs of
// shape `https://fastquote.uk/?ref=CODE`. When the recipient lands here
// and clicks "Get started" or "Log in", the static template's hardcoded
// /signup and /login hrefs drop the `?ref=` query — the referral is
// silently lost. This IIFE rewrites the 5 auth-bound CTAs to preserve
// the ref so the OAuth callback's session-stash receives it.
// Mirrors the validation in src/utils/referrals.js normaliseReferralCode().
(function preserveReferralCode() {
  'use strict';
  try {
    var params = new URLSearchParams(window.location.search);
    var ref = params.get('ref');
    if (!ref) return;
    ref = ref.trim().toUpperCase();
    if (ref.length === 0 || ref.length > 64) return;
    if (!/^[A-Z0-9-]+$/.test(ref)) return;
    // Only rewrite hrefs that hit /login or /signup — privacy/terms/DPA
    // and external links stay untouched. Encoded so a malformed code
    // can't break the URL.
    var anchors = document.querySelectorAll(
      'a[href="/login"], a[href="/signup"], a[href^="/login?"], a[href^="/signup?"]'
    );
    var encoded = encodeURIComponent(ref);
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var hrefAttr = a.getAttribute('href') || '';
      var sep = hrefAttr.indexOf('?') === -1 ? '?' : '&';
      // Skip if the anchor already carries a ref (e.g. server-rendered).
      if (/[?&]ref=/.test(hrefAttr)) continue;
      a.setAttribute('href', hrefAttr + sep + 'ref=' + encoded);
    }
  } catch (e) {
    // Best-effort — preserving ref must never break the landing page.
  }
})();

(function () {
  'use strict';

  var STAGE_DURATIONS = [2400, 2800, 3200];
  var ROW_REVEAL_BASE_MS = 200;          // wait after row's CSS slide-in
  var ROW_CSS_ANIMATION_MS = 400;        // matches @keyframes demoRowIn

  var demo = document.querySelector('[data-demo]');
  if (!demo) return;

  var stages = demo.querySelectorAll('.demo-stage-step');
  var rows = demo.querySelectorAll('.demo-row-v');
  var progressBar = demo.querySelector('.demo-progress-bar');
  var replayBtn = demo.querySelector('.demo-replay');

  var current = 0;
  var rotateTimer = null;
  var rowTimers = [];
  var stopped = true; // start in the stopped state; start() flips it
  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clearRowTimers() {
    rowTimers.forEach(function (t) { clearTimeout(t); });
    rowTimers = [];
  }

  function clearAllValues() {
    rows.forEach(function (el) { el.textContent = ''; });
  }

  function showStage(idx) {
    stages.forEach(function (s, i) {
      s.classList.toggle('is-active', i === idx);
    });
    if (idx === 1) {
      // Reveal values on stage 2 — 200ms after each row's slide-in.
      rows.forEach(function (el, i) {
        var delay = ROW_CSS_ANIMATION_MS + ROW_REVEAL_BASE_MS + i * 200;
        var target = el.getAttribute('data-target') || '';
        rowTimers.push(setTimeout(function () {
          if (stopped) return; // guard against late fires after stop()
          el.textContent = target;
        }, delay));
      });
    }
  }

  function runProgress(durationMs) {
    if (!progressBar) return;
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    // Force a reflow so the transition restart actually takes effect.
    void progressBar.offsetHeight;
    progressBar.style.transition = 'width ' + durationMs + 'ms linear';
    progressBar.style.width = '100%';
  }

  function tick() {
    if (stopped) return;
    var duration = STAGE_DURATIONS[current];
    showStage(current);
    runProgress(duration);
    rotateTimer = setTimeout(function () {
      if (stopped) return; // bail if we were stopped during the wait
      current = (current + 1) % stages.length;
      clearRowTimers();
      if (current === 0) clearAllValues(); // restart of the cycle
      tick();
    }, duration);
  }

  // Fully idempotent — clears any in-flight timers before scheduling new
  // ones, so a flurry of IntersectionObserver enters can't accumulate.
  function start() {
    if (rotateTimer) clearTimeout(rotateTimer);
    clearRowTimers();
    stopped = false;
    if (prefersReducedMotion) {
      // Hold the punchline so the page still reads correctly.
      current = stages.length - 1;
      showStage(current);
      // Populate stage 2 values so they're visible if the user scrolls back.
      rows.forEach(function (el) {
        el.textContent = el.getAttribute('data-target') || '';
      });
      if (progressBar) progressBar.style.width = '100%';
      return;
    }
    current = 0;
    clearAllValues();
    tick();
  }

  function stop() {
    stopped = true;
    if (rotateTimer) clearTimeout(rotateTimer);
    clearRowTimers();
  }

  // Pause when the demo is off-screen; resume (= start fresh) when it
  // scrolls back in. start() is idempotent so repeated enters are safe.
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          start();
        } else {
          stop();
        }
      });
    }, { threshold: 0.2 });
    observer.observe(demo);
  } else {
    // No-IO fallback: just run.
    start();
  }

  // Replay — reset and replay from stage 1.
  if (replayBtn) {
    replayBtn.addEventListener('click', function () {
      stop();
      // Force reflow so re-adding .is-active retriggers CSS animations.
      stages.forEach(function (s) { s.classList.remove('is-active'); });
      void demo.offsetHeight;
      start();
    });
  }
})();
