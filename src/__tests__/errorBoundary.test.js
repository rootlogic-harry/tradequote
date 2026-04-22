/**
 * ErrorBoundary contract — source-level assertions.
 *
 * The codebase doesn't ship a JSX test transform (jest config has
 * `transform: {}`), so we can't mount a React tree in-test. Instead
 * we lock down the boundary's behaviour by asserting the source has
 * the right shape. That catches the cases that have actually hurt us
 * in the past — a scoped boundary that forgets to isolate, a reset
 * button that doesn't re-mount, an onError callback that re-throws.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');
const boundarySrc = readFileSync(
  join(srcDir, 'components/common/ErrorBoundary.jsx'),
  'utf-8'
);

describe('ErrorBoundary source contract', () => {
  test('flips hasError via getDerivedStateFromError (React 16+ API)', () => {
    expect(boundarySrc).toMatch(/static\s+getDerivedStateFromError/);
    expect(boundarySrc).toMatch(/return\s*\{\s*hasError:\s*true\s*\}/);
  });

  test('componentDidCatch logs the scope for debugging', () => {
    // Scope label lets us tell a QuoteDocument crash apart from a
    // ReviewEdit crash in the console without clicking into specifics.
    expect(boundarySrc).toMatch(/componentDidCatch/);
    expect(boundarySrc).toMatch(/ErrorBoundary:\$\{this\.props\.scope\}/);
  });

  test('renders children unchanged when no error', () => {
    expect(boundarySrc).toMatch(/if \(!this\.state\.hasError\)/);
    expect(boundarySrc).toMatch(/this\.props\.children/);
  });

  test('scoped fallback is inline (no FASTQUOTE full-page branding)', () => {
    // Full-page fallback has the branded header; scoped must not.
    // We assert the scoped branch runs BEFORE the full-page fallback.
    const scopeBranchStart = boundarySrc.indexOf('if (this.props.scope)');
    const fastquoteBrandIdx = boundarySrc.lastIndexOf('FASTQUOTE');
    expect(scopeBranchStart).toBeGreaterThan(-1);
    expect(scopeBranchStart).toBeLessThan(fastquoteBrandIdx);
  });

  test('scoped fallback offers a "Try again" button wired to reset', () => {
    // Without this, a crashed subtree is locked until a full page
    // refresh — destroying any unsaved work Paul has in other surfaces.
    expect(boundarySrc).toMatch(/Try again/);
    expect(boundarySrc).toMatch(/onClick=\{this\.reset\}/);
  });

  test('reset() increments errorKey so children re-mount fresh', () => {
    // A stale reference inside the crashed subtree would throw again
    // on the next render — keyed remount forces React to throw the
    // whole subtree away and rebuild from scratch.
    expect(boundarySrc).toMatch(/errorKey:\s*s\.errorKey\s*\+\s*1/);
    expect(boundarySrc).toMatch(/key=\{this\.state\.errorKey\}/);
  });

  test('custom fallback prop is honoured (static node OR render function)', () => {
    // Function form receives { reset, scope } so callers can wire
    // context-aware UIs (e.g. "Reload preview" that also clears state).
    expect(boundarySrc).toMatch(/this\.props\.fallback/);
    expect(boundarySrc).toMatch(/typeof this\.props\.fallback === 'function'/);
    expect(boundarySrc).toMatch(/\{\s*reset:\s*this\.reset,\s*scope:\s*this\.props\.scope\s*\}/);
  });

  test('onError callback is protected — a throwing telemetry hook never bubbles out', () => {
    // Defence in depth: the whole point of a boundary is to contain
    // errors. An onError that itself throws would defeat that.
    const onErrorIdx = boundarySrc.indexOf('this.props.onError');
    const catchIdx = boundarySrc.indexOf('catch', onErrorIdx);
    expect(catchIdx).toBeGreaterThan(onErrorIdx);
    expect(catchIdx - onErrorIdx).toBeLessThan(200);
  });

  test('no inline <script> tags (CSP-friendly)', () => {
    // Portal pages enforce strict CSP. Keep the boundary serialisable
    // into any environment by avoiding dynamic script injection.
    expect(boundarySrc).not.toMatch(/<script/);
  });
});

describe('ErrorBoundary wired at the root (main.jsx)', () => {
  const mainSrc = readFileSync(join(srcDir, 'main.jsx'), 'utf-8');

  test('imports the shared ErrorBoundary (not a local duplicate)', () => {
    expect(mainSrc).toMatch(
      /import\s+ErrorBoundary\s+from\s+['"`].*ErrorBoundary/
    );
  });

  test('wraps <App /> in <ErrorBoundary>', () => {
    expect(mainSrc).toMatch(/<ErrorBoundary>[\s\S]*<App\s*\/>\s*<\/ErrorBoundary>/);
  });

  test('no ErrorBoundary class defined inline in main.jsx (must use shared)', () => {
    // We consolidated to the shared component — duplicates would
    // drift in behaviour and defeat the scoped-vs-root contract.
    expect(mainSrc).not.toMatch(/class\s+ErrorBoundary\s+extends/);
  });
});
