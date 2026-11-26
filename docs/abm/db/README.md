# Database

Supabase (Postgres) is the system of record. The Google Sheet is now only a
read-only mirror.

## Install

Run these in the Supabase SQL editor, in order. All are idempotent.

1. `01_schema.sql` — tables, enums, dedup indexes, helper functions
2. `02_views.sql` — one queue per touch in the 14-day cadence
3. `03_functions.sql` — the RPC layer Make calls

## Design

Make holds no cadence logic. It reads a view, sends, then calls
`abm_mark_sent()`. That means the rules live in one place and can be changed
without touching seven scenarios.

| Concern | Where it is handled |
|---|---|
| Who gets touched today | the `v_abm_due_*` views |
| Dedup | unique indexes on `lower(linkedin_url)` and `phone` |
| Never contact again | `abm_dnc` + `abm_is_dnc()`, checked at intake and in every view |
| One reply stops everything | `abm_is_live()`, used by every send queue |
| Was the reply a yes or a no | `abm_record_reply()` classifies intent |
| Only sendable numbers | `abm_is_sendable_phone()`, `^91[6-9][0-9]{9}$` |
| Stop at day 14, retry at 60 | `abm_expire_sequences()`, run daily |

## RPC endpoints

All reachable at `POST {SUPABASE_URL}/rest/v1/rpc/<name>`.

| Function | Called by | Does |
|---|---|---|
| `abm_intake` | Claude | upserts a batch, dedups, blocks DNC, starts the clock |
| `abm_mark_sent` | Make | stamps one touch, advances stage, writes an event |
| `abm_record_reply` | Make | classifies intent, stops all channels, auto-DNCs refusals |
| `abm_record_answers` | Make | stores seats / move date / area |
| `abm_mark_called` | Make or a human | logs the call outcome |
| `abm_set_stage` | Make or a human | visit_booked, proposal, closed_won ... |
| `abm_add_dnc` | anyone | manual block |
| `abm_expire_sequences` | Make, daily | closes day 15+ and parks for 60 days |

## Tests

`99_test_part1.sql` and `99_test_part2.sql` run the whole thing against a
throwaway Postgres. They were run against PostgreSQL 16.15 and all assertions
held:

- intake of 6 leads produced 4 inserted, 1 duplicate blocked (case-insensitive
  LinkedIn match), 1 DNC blocked
- a US phone number was normalised to null and the lead dropped from both the
  WhatsApp queue and the call list
- every queue fired on the correct day and was empty on every other day
- the LinkedIn message queue stayed empty until the invite was marked accepted
- "Yes, share options" classified as `interested` and raised an alert
- "Not right now" classified as `later` and did NOT raise an alert
- "not interested, please remove me" classified as `not_interested`, moved the
  lead to `dnc`, and wrote them to the DNC table
- re-importing that person in a later batch was blocked
- after any reply, that lead appeared in zero send queues on any channel
- a lead reaching day 15 with no reply was stopped and given a retry date 60
  days out

To re-run locally:

```bash
psql -f 01_schema.sql -f 02_views.sql -f 03_functions.sql -f 99_test_part1.sql -f 99_test_part2.sql
```
