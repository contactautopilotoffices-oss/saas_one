# Make scenarios

Three scenarios, already created in team 3478981. All three are switched OFF.

| Scenario | ID | Trigger | Link |
|---|---|---|---|
| ABM - 8 day cadence engine | 7121711 | every hour | https://us2.make.com/3478981/scenarios/7121711/edit |
| ABM - Intake leads from Claude | 7121713 | on demand | https://us2.make.com/3478981/scenarios/7121713/edit |
| ABM - Catch replies | 7121719 | webhook | https://us2.make.com/3478981/scenarios/7121719/edit |

## Why three and not one

Make allows exactly one trigger per scenario, and these three are triggered in
three different ways: a clock, a manual call from Claude, and an inbound HTTP
request from AiSensy. They cannot be merged.

What *was* merged is the cadence. All three WhatsApp touches plus the daily
housekeeping used to be four separate scenarios. They are now one, with a
router.

## The cadence engine, 7121711

Runs hourly. One pass does everything:

```
1  POST rpc/abm_expire_sequences        close day 9+, park for 60 days
2  Router
   |
   +-- 3  GET v_abm_due_wa_intro        Day 2
   |   4  Iterator
   |   5  AiSensy abm_intro_v1
   |   6  POST rpc/abm_mark_sent wa_intro
   |
   +-- 7  GET v_abm_due_wa_followup     Day 6
   |   8  Iterator
   |   9  AiSensy abm_followup_v1
   |  10  POST rpc/abm_mark_sent wa_followup
   |
   +-- 11 GET v_abm_due_wa_final        Day 8
       12 Iterator
       13 AiSensy abm_final_v1
       14 POST rpc/abm_mark_sent wa_final
```

Housekeeping runs first on purpose: a lead that should have been stopped is
stopped before any branch can message them.

Running hourly is safe even though two of the three touches are "daily". The
database decides who is due, and once `wa_followup_sent_at` is stamped the
lead drops out of that queue. Make cannot double-send even if it runs sixty
times a day.

## What you still have to fill in

Open each scenario and replace these. They are the only things missing.

| Placeholder | Where to get it |
|---|---|
| `__SUPABASE_SERVICE_ROLE_KEY__` | Supabase, Project Settings, API, `service_role`. Appears 14 times in 7121711, twice in 7121713, twice in 7121719 (each HTTP module carries it in two headers: `apikey` and `Authorization`). |
| `__AISENSY_API_KEY__` | AiSensy, Manage, API Key. 3 times in 7121711, inside the Request content box of modules 5, 9 and 13. |

The Supabase project URL is already filled in everywhere.

Tip: in the Make editor use the scenario's three-dot menu, Export Blueprint,
find-and-replace in a text editor, then Import Blueprint. Faster than clicking
into ten modules.

## Reply webhook

```
https://hook.us2.make.com/v6of5m2bkx2g8ronm4chsf63trui3exu
```

Paste this into AiSensy's webhook setting. This is a new hook created for
scenario 7121719. The old URL from the sheet-based build is retired.

## Still unverified

Scenario 7121719 reads `{{1.phone}}` and `{{1.text}}`. Those field names are a
guess at AiSensy's payload. Before going live: switch the scenario on, send one
real WhatsApp reply, open the execution history, see what actually arrived, and
correct the two references. This is the most likely thing to break.

## The old scenarios

7120707, 7108734, 7108740 and 7108746 are the sheet-based build and are
superseded. Leave them OFF or delete them. Never run both sets: they would
double-message every lead.
