# Integrations: who does what

**you** means a human with an account login. **Claude** means I can do it from
a chat session.

Everything that can be built without your accounts is built. Three things
block the rest, all of them marked BLOCKING below.

---

## 1. Supabase, the system of record  — **DONE**

Project `ABM_Project` (`vvozzvbwduoruozsphxa`), API URL
`https://vvozzvbwduoruozsphxa.supabase.co`.

Applied and verified from this session:

- `01_schema.sql`, `02_views.sql`, `03_functions.sql`, `04_security.sql`
- the test suite ran against this live database: 25 of 25 PASS
- all test data removed afterwards, the tables are empty
- RLS enabled on all three tables with no policies, so anon and authenticated
  can read and write nothing. Only `service_role` has access, which is what
  Make uses.
- `search_path` pinned on all 14 functions
- write RPCs revoked from anon and authenticated

**Nothing left to do here.** The `service_role` key still needs to go into
Make, in step 3.

---

## 2. AiSensy, WhatsApp  — **you**, 30 min + Meta approval  — BLOCKING

1. Manage, Template Messages, New Template. Create all three from
   `templates/messages.md`, named exactly `abm_intro_v1`, `abm_followup_v1`,
   `abm_final_v1`. Copy the bodies exactly: Meta rejects templates where two
   variables touch, and these are written to avoid that.
2. Submit and wait for Meta.
3. Once approved, create one API campaign per template with the same name, and
   Set Live.
4. Manage, API Key. Generate one and keep it for Make.
5. Webhook setting: paste the Make webhook URL from `make/README.md`.
6. Top up the wallet. At about Re 1 a message and three messages a lead, 50
   leads a week is roughly Rs 150 a week.

---

## 3. Make  — **you import, 15 minutes**  — BLOCKING on items 1 and 2

Six blueprints are written and sitting in `make/`. Import each one, then
replace four placeholders. Full table in `make/README.md`.

`__SUPABASE_URL__`, `__SUPABASE_SERVICE_ROLE_KEY__`, `__AISENSY_API_KEY__`,
`__MAKE_HOOK_ID__`.

Leave the four old sheet-based scenarios switched OFF. Running both would
double-message every lead.

---

## 4. Oppora, lead data  — **connected and working**

72 leads and 59 companies are in `Andheri ABM - Master`, list 28836.

**Phone enrichment is not done.** All 72 have no number. A 3-lead test
returned 3 valid numbers, so it works; it just has not been run. 72 credits of
your 112 remaining. Say go when you want it.

---

## 5. LinkedIn  — **parked**

Waiting on the Oppora LinkedIn plan, about Rs 2,000. Nothing else is blocked
by it: WhatsApp, the call list and the tracker all run without it.

When you are ready: connect the account in Oppora and the 4-step sequence
already built in campaign 15491 starts working. One extra piece will be needed
then, pushing the DNC list across to Oppora, noted in `KNOWN_ISSUES.md`.

---

## 6. Reply alerts  — **deferred, your call**

Not built, by your instruction. The groundwork is in: `abm_record_reply`
returns an `alert` flag and `v_abm_new_replies` ranks interested replies
first. Wiring a WhatsApp, email or morning digest is a small addition later.

---

## 7. Google Sheets  — **demoted**

No longer the brain and no automation reads it. If you still want a
spreadsheet view, a daily one-way mirror from Supabase is easy to add.

---

## Cost

| Item | Cost | Status |
|---|---|---|
| Oppora lead data | bought | extra credits only if you scale |
| Oppora phone credits | 112 left, 72 needed | bought, not spent |
| Oppora LinkedIn | about Rs 2,000 | not bought |
| AiSensy wallet | Rs 2,000 to 3,000 | top-up needed |
| Supabase | free tier is enough here | may already exist |
| Make | about 600 to 700 operations per 50-lead batch | bought |
| Claude | bought | |

---

## Order of operations

| # | Step | Who | Time |
|---|---|---|---|
| 1 | ~~Run the SQL files in Supabase~~ | **done** | |
| 2 | Create and submit the three WhatsApp templates | you | 30 min + Meta wait |
| 3 | ~~Send me the Supabase Project URL~~ | **done** | |
| 4 | Import the six Make blueprints, fill the placeholders | you | 15 min |
| 5 | Create the AiSensy API campaigns, Set Live | you | 10 min |
| 6 | Paste the webhook into AiSensy | you | 2 min |
| 7 | Check the real reply payload, fix field names | both | 10 min |
| 8 | Enrich phone numbers | Claude | 5 min |
| 9 | Load 10 leads, test run | both | 1 day |
| 10 | Full run | | |

Step 2, the WhatsApp templates, is now the only long pole. Everything else is minutes.
