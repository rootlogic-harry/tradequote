/**
 * autosaveDraft (TRQ-166) — verify the wrapper that converts silent
 * `saveDraft(...).catch(() => {})` into observable reducer state.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const mockSaveDraft = jest.fn();
jest.unstable_mockModule('../utils/userDB.js', () => ({
  saveDraft: mockSaveDraft,
}));

const { autosaveDraft } = await import('../utils/autosaveDraft.js');

beforeEach(() => {
  mockSaveDraft.mockReset();
});

describe('autosaveDraft', () => {
  test('happy path: dispatches START then OK and resolves silently', async () => {
    mockSaveDraft.mockResolvedValue(undefined);
    const dispatch = jest.fn();
    await autosaveDraft('mark', { foo: 1 }, dispatch);
    expect(mockSaveDraft).toHaveBeenCalledWith('mark', { foo: 1 });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0]).toEqual({ type: 'AUTOSAVE_START' });
    expect(dispatch.mock.calls[1][0]).toEqual({ type: 'AUTOSAVE_OK' });
  });

  test('failure path: dispatches START then FAIL with error message — does NOT throw', async () => {
    mockSaveDraft.mockRejectedValue(new Error('Network down'));
    const dispatch = jest.fn();
    // Critical: autosave is best-effort, must not throw out of the
    // calling effect. Reducer state is the only error surface.
    await expect(autosaveDraft('mark', { foo: 1 }, dispatch)).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1][0]).toEqual({
      type: 'AUTOSAVE_FAIL',
      error: 'Network down',
    });
  });

  test('failure path with no error message falls back to generic', async () => {
    mockSaveDraft.mockRejectedValue({}); // pathological — no .message
    const dispatch = jest.fn();
    await autosaveDraft('mark', { foo: 1 }, dispatch);
    expect(dispatch.mock.calls[1][0]).toEqual({
      type: 'AUTOSAVE_FAIL',
      error: 'Save failed',
    });
  });

  test('no userId: does nothing (cheap guard)', async () => {
    const dispatch = jest.fn();
    await autosaveDraft(null, { foo: 1 }, dispatch);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('no dispatch: degrades to silent legacy behaviour (does not throw)', async () => {
    mockSaveDraft.mockRejectedValue(new Error('still down'));
    await expect(autosaveDraft('mark', { foo: 1 }, null)).resolves.toBeUndefined();
    expect(mockSaveDraft).toHaveBeenCalled();
  });

  // TRQ-167: visibility-state guard prevents the two-tab race where a
  // backgrounded tab's stale-state autosave clobbers a foreground
  // tab's writes (drafts table is UNIQUE(user_id) — last write wins).
  describe('visibility-state guard', () => {
    let originalDocument;
    beforeEach(() => {
      originalDocument = globalThis.document;
    });
    afterEach(() => {
      globalThis.document = originalDocument;
    });

    test('skips entirely when document.visibilityState is "hidden"', async () => {
      globalThis.document = { visibilityState: 'hidden' };
      const dispatch = jest.fn();
      await autosaveDraft('mark', { foo: 1 }, dispatch);
      expect(mockSaveDraft).not.toHaveBeenCalled();
      // No AUTOSAVE_START/OK/FAIL dispatch — the indicator should not
      // flicker for skipped saves.
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('proceeds normally when document.visibilityState is "visible"', async () => {
      globalThis.document = { visibilityState: 'visible' };
      mockSaveDraft.mockResolvedValue(undefined);
      const dispatch = jest.fn();
      await autosaveDraft('mark', { foo: 1 }, dispatch);
      expect(mockSaveDraft).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith({ type: 'AUTOSAVE_START' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'AUTOSAVE_OK' });
    });

    test('proceeds when document is undefined (server-side / Node env)', async () => {
      globalThis.document = undefined;
      mockSaveDraft.mockResolvedValue(undefined);
      const dispatch = jest.fn();
      await autosaveDraft('mark', { foo: 1 }, dispatch);
      expect(mockSaveDraft).toHaveBeenCalled();
    });
  });
});

// Source-level wiring assertions — keep the silent-failure pattern
// from sneaking back in.
describe('autosaveDraft wiring', () => {
  const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');

  test('App.jsx imports autosaveDraft and uses it in the 5s autosave effect', () => {
    expect(appSrc).toMatch(/from\s+['"][^'"]*autosaveDraft/);
    // Find the autosave 5s timer block.
    const start = appSrc.indexOf('Auto-save draft');
    const end = appSrc.indexOf('// Auto-save job + diffs', start);
    const block = appSrc.slice(start, end);
    expect(block).toMatch(/autosaveDraft\(/);
    // The legacy silent catch should be gone from this block.
    expect(block).not.toMatch(/saveDraft\([^)]*\)\.catch\(\(\)\s*=>\s*\{\}\)/);
  });

  test('StepIndicator forwards autosave prop to AutosaveStatus', () => {
    const stepSrc = readFileSync(
      join(__dirname, '../components/StepIndicator.jsx'),
      'utf8'
    );
    expect(stepSrc).toMatch(/import\s+AutosaveStatus/);
    expect(stepSrc).toMatch(/<AutosaveStatus[^>]*autosave=\{autosave\}/);
  });

  test('App.jsx passes state.autosave + retry handler to StepIndicator', () => {
    const stepUseStart = appSrc.indexOf('<StepIndicator');
    const stepUseEnd = appSrc.indexOf('/>', stepUseStart);
    const block = appSrc.slice(stepUseStart, stepUseEnd);
    expect(block).toMatch(/autosave=\{state\.autosave\}/);
    expect(block).toMatch(/onAutosaveRetry=/);
  });
});
