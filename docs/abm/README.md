# ABM Outbound System, Autopilot Offices

Finds growing companies in and around Andheri, reaches the decision makers on
LinkedIn, WhatsApp and phone over 8 days, and books site visits.

Configuration, copy and schema. No application code.

## How it works

```
Claude + Oppora                 find and score 50 decision makers
      |
      v
Make "ABM 0"  --> abm_intake()  dedup, DNC check, clock starts
      |
      v
          S U P A B A S E       the brain: who is due what, today
      |              |
      |              +--------------------------+
      v                                         v
Make reads a queue                      Oppora LinkedIn sequence
sends via AiSensy                       connect, message, follow-up
calls abm_mark_sent()                            |
      |                                          |
      +--------------+---------------------------+
                     v
              a reply on ANY channel
              stops EVERY channel
```

## The 8-day sequence

Day 1 LinkedIn connect, Day 2 WhatsApp intro, Day 3+ LinkedIn message once
accepted, Day 4 to 5 cold call, Day 6 follow-up on both, Day 8 final on both,
Day 9 park for 60 days. Full detail in `CADENCE.md`.

## Repo map

| Path | What |
|---|---|
| `INTEGRATIONS.md` | who has to do what, on which platform. **Start here.** |
| `CADENCE.md` | the 8-day sequence, and what stops it |
| `db/` | Supabase schema, queues, RPC layer, test suite |
| `make/` | importable Make blueprints |
| `templates/messages.md` | all copy, four personas, three channels |
| `KNOWN_ISSUES.md` | what is still unverified |

## Status

| Component | State |
|---|---|
| Supabase schema, queues, RPCs | **LIVE in project `ABM_Project`**, 25 of 25 tests pass |
| Message library, 4 personas | written |
| Make blueprints, 6 scenarios | written, URL baked in, need two keys pasted |
| Supabase project | **created, schema applied, RLS on, tests green** |
| WhatsApp templates in AiSensy | **not yet created, blocking** |
| Oppora lead data | 72 leads, 59 companies ready |
| Phone numbers | **not enriched yet**, 0 of 72 |
| LinkedIn account in Oppora | parked, waiting on the plan |
| Reply alerts | deliberately not built yet |

## Moving parts

| Part | Identifier |
|---|---|
| Supabase project | `vvozzvbwduoruozsphxa`, `ABM_Project`, ap-northeast-1 |
| Supabase API URL | `https://vvozzvbwduoruozsphxa.supabase.co` |
| Make team | 3478981 |
| Google Sheets connection in Make | 12450410 |
| Oppora list | 28836, `Andheri ABM - Master` |
| Oppora LinkedIn campaign | 15491, `ABM_Andheri` |
| AiSensy endpoint | `https://backend.aisensy.com/campaign/t1/api/v2` |
| AiSensy campaigns | `abm_intro_v1`, `abm_followup_v1`, `abm_final_v1` |
| Reply webhook | `https://hook.us2.make.com/7dqe6i2mfn2kfk58pb59sbitcsr6bvsx` |
