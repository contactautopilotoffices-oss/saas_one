# Known issues and what is still unverified

## Verified by test, not by live traffic

The database layer has a test suite (`db/99_test.sql`) that passes 26 of 26
assertions against PostgreSQL 16.15: intake, dedup, DNC, phone validation,
every day boundary in the 8-day cadence, all three reply intents, the
cross-channel stop, and expiry with a 60-day park.

That proves the logic. It does not prove the integrations. Nothing below has
touched a real WhatsApp message, a real reply or a real LinkedIn account yet.

## 1. The AiSensy reply payload is a guess

`make/scenario-4-replies.json` reads `{{1.phone}}` and `{{1.text}}`. Those are
assumed field names. If they are wrong, replies never reach the database,
`abm_record_reply` never fires, and people keep getting follow-ups after they
have already answered.

**Fix before launch:** run the webhook in Make, send one real reply, read the
actual payload, correct the two references.

## 2. No phone numbers are loaded yet

All 72 leads in Oppora have `phone: null`. A 3-lead test returned 3 valid
numbers, so enrichment works, but it has not been run. Until it is, the
WhatsApp track and the call list have nobody in them.

Enriching 72 leads costs 72 of 112 remaining phone credits. One of the three
test numbers came back as a US number for a Mumbai director, so expect some
share to be dropped by the `^91[6-9][0-9]{9}$` validator.

## 3. Nobody is notified when a lead replies

Deliberate, deferred. Today an interested reply lands in `v_abm_new_replies`
and waits for someone to look. The queue and the `alert` flag from
`abm_record_reply` are both built, so wiring an alert is a small addition when
it is wanted.

## 4. LinkedIn timing is configured in two places

Oppora owns LinkedIn sending and keeps its own timers. The `v_abm_due_li_*`
views mirror the same schedule for reporting. Change one and you must change
the other, or the tracker will disagree with what actually went out.

## 5. Oppora's sequence does not read the DNC list

The cross-channel stop works inside Supabase. Oppora does not know about it.
If someone says "not interested" on WhatsApp, Supabase stops its own channels,
but an already-enrolled Oppora LinkedIn sequence keeps running for that person
until a sync pushes the stop across.

**Not yet built.** It matters once LinkedIn goes live, not before.

## 6. One of two Oppora connections has a dead key

One configured Oppora connection returns "invalid, revoked or expired API
key". Only the working one is used. Regenerate or remove the dead one.

## 7. The test suite needs a clean database

`99_test.sql` writes test data and asserts exact counts, so running it twice
against the same database fails on the second run. Always run it against a
throwaway database.
