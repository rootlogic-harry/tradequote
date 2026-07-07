/**
 * ClientMergeReview — grouping regression guard.
 *
 * Harry's UAT (2026-07-07): "you should be able to merge 3 duplicates
 * into one". The initial modal rendered every candidate PAIR verbatim,
 * so three "Yorkshire Estates" showed as three rows with six "Keep this
 * one" buttons — confusing and forced the user to merge twice.
 *
 * The rewritten modal groups pairs via `computeDuplicateGroups`
 * (Union-Find over the pair set — tested in mergeGroups.test.js) and
 * renders ONE card per group with N cards inside. Picking a target
 * performs N-1 sequential merges into that client.
 *
 * This suite pins that contract at the source level so a future
 * refactor can't silently regress back to pair-shaped rendering.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const modalSrc = readFileSync(
  join(repoRoot, 'src/components/ClientMergeReview.jsx'),
  'utf8',
);

describe('ClientMergeReview — group-shaped rendering', () => {
  test('imports the pure grouping helper', () => {
    expect(modalSrc).toMatch(/from ['"]\.\.\/utils\/mergeGroups\.js['"]/);
    expect(modalSrc).toMatch(/computeDuplicateGroups/);
  });

  test('renders one card per GROUP, not per pair', () => {
    // The old modal used `data-testid="client-merge-review-pair"` and
    // sorted `duplicates` in-place. The new one iterates `groups` and
    // uses `data-testid="client-merge-review-group"`.
    expect(modalSrc).toMatch(/data-testid=["']client-merge-review-group["']/);
    expect(modalSrc).not.toMatch(/data-testid=["']client-merge-review-pair["']/);
  });

  test('groups render N ClientCards inside a responsive grid', () => {
    // The auto-fit grid is what makes a 3-client group render 3 cards
    // in a row on desktop, wrapping on narrow viewports. Losing this
    // would collapse the group back to a stack that looks like pairs.
    expect(modalSrc).toMatch(/gridTemplateColumns:\s*['"]repeat\(auto-fit/);
    expect(modalSrc).toMatch(/group\.clients\.map/);
  });

  test('group merge is sequential (server merge locks target row)', () => {
    // Parallel merges risk FK conflicts and interleaved audit rows.
    // The loop must be `for … of` awaiting each call, NOT Promise.all.
    expect(modalSrc).toMatch(/for\s*\(const\s+src\s+of\s+sources\)/);
    expect(modalSrc).not.toMatch(/Promise\.all\s*\(\s*sources/);
  });

  test('confirm message names every source client (not just one)', () => {
    // Old modal said "merge X INTO Y?". New one lists every source so
    // the user sees exactly what will be soft-deleted.
    expect(modalSrc).toMatch(/sourceNames/);
    expect(modalSrc).toMatch(/sources\.map\(\(c\) =>/);
  });

  test('touch targets stay ≥44px on the merge buttons', () => {
    // Same mobile contract as the rest of the app.
    expect(modalSrc).toMatch(/minHeight:\s*44/);
  });

  test('onMerged refetches after a partial-failure catch', () => {
    // If the 2nd merge in a 3-client group fails, the 1st already
    // succeeded. The modal must refetch from server so state is
    // consistent — no client-side rollback attempted.
    const catchBlock = modalSrc.slice(modalSrc.indexOf('catch (e)'));
    expect(catchBlock).toMatch(/onMerged/);
  });
});
