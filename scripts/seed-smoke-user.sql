-- Seed the Phase 2 Playwright smoke user.
-- Run once against the production database (idempotent).
--
-- Runbook: docs/SMOKE.md § Phase 2.
--
-- Safe to run multiple times — every INSERT is ON CONFLICT DO NOTHING
-- so re-running never disturbs existing rows.
--
-- Blast radius: creates ONE user (id='tq_agent_smoke', plan='basic',
-- profile_complete=true) whose credentials are the AGENT_SMOKE_SECRET
-- env var + a matching X-Agent-Secret header on the /test/agent-login
-- endpoint. If AGENT_SMOKE_SECRET is unset in production, the endpoint
-- returns 404 (fail-closed) — the user row exists but is unreachable.

BEGIN;

INSERT INTO users (
  id, email, name, plan, profile_complete, created_at,
  auth_provider, auth_provider_id
)
VALUES (
  'tq_agent_smoke',
  'smoke+agent@fastquote.uk',
  'Agent Smoke',
  'basic',
  TRUE,
  NOW(),
  'agent-smoke',
  'agent-smoke'
)
ON CONFLICT (id) DO NOTHING;

-- Seed a working profile so the SPA renders past step 1 without prompts.
INSERT INTO profiles (user_id, data)
VALUES (
  'tq_agent_smoke',
  '{
    "companyName": "Smoke Co",
    "fullName": "Agent Smoke",
    "phone": "01234 567890",
    "email": "smoke+agent@fastquote.uk",
    "address": "Smoke Test, YO1 1AA",
    "dayRate": 300,
    "vatRegistered": false,
    "accreditations": "",
    "showNotesOnQuote": true,
    "hideLabourDays": false,
    "region": "West Yorkshire",
    "preferredStoneTypes": [],
    "mortarUsage": null,
    "accent": "amber",
    "documentType": "quote"
  }'::jsonb
)
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Verify:
--   SELECT id, plan, profile_complete, auth_provider FROM users WHERE id = 'tq_agent_smoke';
--   SELECT user_id, data->>'companyName' FROM profiles WHERE user_id = 'tq_agent_smoke';
