-- Paul Clough duplicate user — diagnostic + fix (2026-07-09).
--
-- Harry-only. DO NOT run without doing the two DIAGNOSTIC queries first
-- and pasting the returned ids into the fix block below.
--
-- Root cause (server.js:1080-1164): Auth0 verify callback matches
-- existing users by lower(email). Paul's original user row has
-- email=NULL or email≠'paul@drystonepaul.co.uk', so path 1 (email
-- match) returned 0 rows on his first Auth0 login this morning and a
-- new user row got created.
--
-- Fix: merge the new duplicate's identity onto the original row, then
-- delete the duplicate. Paul's session on the duplicate must be logged
-- out AFTER the fix so his next login runs path 1 with the corrected
-- email and lands on the original.

-- ────────────────────────────────────────────────────────────
-- STEP 1 — DIAGNOSTIC (read-only, no changes)
-- ────────────────────────────────────────────────────────────

-- 1a. Paul's ORIGINAL user (owner of the PAULJULY referral code).
--     Note the returned id — call it PAUL_ORIGINAL_ID below.
SELECT u.id            AS original_id,
       u.name,
       u.email         AS original_email,
       u.auth_provider AS original_provider,
       u.auth_provider_id,
       u.created_at
  FROM users u
  JOIN referral_codes rc ON rc.user_id = u.id
 WHERE rc.code = 'PAULJULY';

-- 1b. The DUPLICATE user Paul got today via Auth0.
--     Note the returned id — call it PAUL_DUPLICATE_ID below.
--     Note the returned auth_provider_id — call it PAUL_AUTH0_SUB below.
SELECT id            AS duplicate_id,
       name,
       email         AS duplicate_email,
       auth_provider,
       auth_provider_id AS auth0_sub,
       created_at,
       (SELECT COUNT(*) FROM jobs WHERE user_id = users.id) AS jobs_on_duplicate
  FROM users
 WHERE lower(email) = 'paul@drystonepaul.co.uk'
   AND created_at > NOW() - INTERVAL '2 days'
 ORDER BY created_at DESC;

-- 1c. Sanity: how many quotes on the ORIGINAL row? Should match Paul's
--     recollection ("Sent 25 [...] All 43" from Mark's 2026-07-07 chat
--     was Mark, but Paul has his own body of work). If this returns 0,
--     something else is going on and STOP.
--     Paste PAUL_ORIGINAL_ID from 1a.
--
-- SELECT COUNT(*) FROM jobs WHERE user_id = '<PAUL_ORIGINAL_ID>';

-- ────────────────────────────────────────────────────────────
-- STEP 2 — FIX (writes; run only after diagnostic confirms the shape)
-- ────────────────────────────────────────────────────────────
-- Uncomment the block below, paste the three values from step 1, and
-- run in a single transaction.

/*
BEGIN;

-- 2a. Move the correct email + Auth0 identity onto Paul's original
--     row. This is what makes his next login hit path 1 successfully.
UPDATE users
   SET email = 'paul@drystonepaul.co.uk',
       auth_provider = 'auth0',
       auth_provider_id = '<PAUL_AUTH0_SUB from 1b>',
       last_login_at = NOW()
 WHERE id = '<PAUL_ORIGINAL_ID from 1a>';

-- 2b. Delete the duplicate. ON DELETE CASCADE handles the trivial
--     subordinate rows (drafts, session, empty jobs) that were
--     created today — Paul did no real work on the duplicate.
DELETE FROM users
 WHERE id = '<PAUL_DUPLICATE_ID from 1b>';

-- 2c. Verify: one row, correct identity.
SELECT id, name, email, auth_provider, auth_provider_id
  FROM users
 WHERE lower(email) = 'paul@drystonepaul.co.uk';

COMMIT;
*/

-- ────────────────────────────────────────────────────────────
-- STEP 3 — TELL PAUL
-- ────────────────────────────────────────────────────────────
-- Paul must fully log out and clear his session cookie before
-- attempting to log back in — his current tq_session cookie is still
-- bound to the (now-deleted) duplicate id. Simplest: POST /auth/logout
-- from a fresh tab (or use the sidebar "Log out" link). Then log back
-- in via Google. Path 1 will match his original row and he'll land on
-- his real dashboard.
