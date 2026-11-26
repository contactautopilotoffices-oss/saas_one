# The 8-day cadence

Day 1 is the day the lead enters the system. Every queue uses `>=` rather than
`=`, so a day missed because a scenario was paused is picked up on the next run
instead of being skipped forever.

| Day | Touch | Who gets it | Channel | Queue |
|---|---|---|---|---|
| 1 | Connect request, no pitch | everyone with a LinkedIn URL | LinkedIn | `v_abm_due_li_connect` |
| 2 | Intro | HOT and WARM with a valid +91 mobile | WhatsApp | `v_abm_due_wa_intro` |
| 3+ | First real message | anyone who accepted the invite | LinkedIn | `v_abm_due_li_message` |
| 4 to 5 | Cold call | HOT leads, plus anyone who replied anywhere | phone, human | `v_abm_call_list` |
| 6 | Follow-up | still no reply | WhatsApp + LinkedIn | `v_abm_due_wa_followup`, `v_abm_due_li_followup` |
| 8 | Final, then stop | still no reply | WhatsApp + LinkedIn | `v_abm_due_wa_final`, `v_abm_due_li_final` |
| 9+ | Park for 60 days | still no reply | none | `abm_expire_sequences()` |

## Why these days

This is the 14-day diagram compressed to 8. The touches are all still there,
they just land sooner. The call window moved from day 4 to 6 down to day 4 to
5 so it does not collide with the day 6 follow-up, which would have meant
calling someone the same morning a WhatsApp went out.

To go back to 14 days: in `db/02_views.sql` change the day 6 checks to 8, the
day 8 checks to 14, and `> 8` to `> 14` in `v_abm_to_expire`. Nothing else
changes.

## What stops a sequence

Any one of these ends it immediately, on every channel at once:

- the lead replies on any channel
- the lead is on the DNC list
- the lead reaches day 9 with no reply
- stage moves to `closed_won`, `closed_lost` or `dnc`

This is the cross-channel stop, and it is enforced by `abm_is_live()`, which
every send queue filters on. A reply on WhatsApp silences LinkedIn and vice
versa.

## Budget per lead

Three WhatsApp messages, four LinkedIn touches, one call, over 8 days. The
views enforce the ceiling, so no lead can be messaged more than that even if a
scenario runs twice.

## What each score gets

| Score | LinkedIn | WhatsApp | Call |
|---|---|---|---|
| HOT | yes | yes | yes, day 4 to 5 |
| WARM | yes | yes | only if they reply |
| COLD | yes | no | only if they reply |

COLD gets LinkedIn only. LinkedIn touches are free and low risk. WhatsApp
messages cost money and burn goodwill, so they are spent on HOT and WARM.

## Where LinkedIn timing actually lives

Worth being precise about this, because it is the one place the architecture
is split.

WhatsApp, the call list and all tracking are driven by Supabase. LinkedIn is
driven by Oppora's own sequence engine, which keeps its own timers, because
Oppora exposes no "send this one message now" API.

So the LinkedIn day numbers above are configured twice: once in the Oppora
sequence, and once in the `v_abm_due_li_*` views that mirror it for reporting.
If you change LinkedIn timing, change it in both. The views are the source of
truth for reporting, Oppora is the source of truth for sending.
