# Decisions to hold until this mock is signed off

These are chosen so the real build does not reopen them. Nothing here is implemented. No schema, no public route, no email is sent.

## Transactional email

Use **Resend**. Volume is two recipients per enquiry. The API is a single send call, which is enough for “email Mark and Paul the same link”.

Send from a FastQuote address on a subdomain once DNS is in place, for example `quotes@notify.fastquote.uk`. Do not send from `hello@fastquote.uk`. That mailbox does not exist. The working human inbox today is `fastquote@harrydoyle.uk`, and that stays the place people write back to, not the automated from-address.

Look up recipients at send time from `users.email`. Do not hardcode inboxes in the page.

**Test window:** notify **Mark only** via `HOMEOWNER_NOTIFY_USER_IDS=mark`. Add Paul when Harry opens the list.

SMS stays out.

## Privacy frame

FastQuote is the **controller** for a homeowner who types their own name, email and phone.

Mark and Paul are **recipients**, not processors. They receive the details under the unticked consent so they can quote the job for their own business. Do not write a processor agreement for that share.

The consent line is exactly: “FastQuote may share my details with a local dry stone waller so they can contact me about this job.”

Marketing consent is a separate unticked box.

The shared link shows the phone number. The confirmation tells the homeowner that. The page is `noindex`. Keep phone numbers out of logs. Strip photo location data before any real store.

Privacy copy on `/privacy` is a separate pass, approved by Harry, before the first real enquiry is stored. The current notice only covers tradespeople and clients they upload.

Retention for an enquiry: 12 months, then delete.

## What stays out until then

No `homeowner_quotes` table, no change to `jobs`, `quote_diffs`, `agent_runs`, or waller quota, and no edit to the live landing page.
