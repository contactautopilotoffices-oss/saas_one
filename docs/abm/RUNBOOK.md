# Runbook

## One time setup, in this order

1. **Create the two WhatsApp templates in AiSensy.** Manage, then Template
   Messages, then New Template. Bodies and button config are in
   `templates/whatsapp.md`. Names must be exactly `andheri_intro` and
   `andheri_followup`. Wait for Meta approval.

2. **Create the two API campaigns in AiSensy.** Same names as the templates.
   Attach the matching template to each, then Set Live. The Make scenarios find
   them by this exact string, lowercase with the underscore.

3. **Put the AiSensy API key into Make scenarios 1 and 2.** Open each scenario,
   click the middle HTTP module, find `PASTE_YOUR_AISENSY_API_KEY_HERE` in the
   Request content box, replace it, OK, Save.
   - scenario 1: https://us2.make.com/3478981/scenarios/7108734/edit
   - scenario 2: https://us2.make.com/3478981/scenarios/7108740/edit

4. **Register the reply webhook in AiSensy.** Paste
   `https://hook.us2.make.com/7dqe6i2mfn2kfk58pb59sbitcsr6bvsx` into AiSensy's
   webhook setting. Without this, replies never reach the sheet and people keep
   getting follow-ups after they have already answered.

5. **Connect a LinkedIn account in Oppora.** The sequence stays in draft until
   this is done. WhatsApp runs fine without it.

6. **Switch on Make scenarios 1, 2 and 3.** Do this last. Switching on
   scenario 1 before steps 2 and 3 are done will fire it against the sheet and
   log errors.

## Running a campaign

Tell Claude: `Start ABM: Andheri East, 50 leads`

Claude then:
1. Searches Oppora for companies and decision makers matching the brief
2. Scores each lead HOT, WARM or COLD with a reason and a call opener
3. Pushes them through Make scenario 0 into the sheet, tagged with the campaign
   name and target office
4. Enrols them in the Oppora LinkedIn sequence and pauses for approval

WhatsApp then runs itself. Scenario 1 picks up HOT and WARM leads that have a
phone number and no WhatsApp status yet, sends the intro, and stamps column N.

## Phone number format

AiSensy silently fails on bare 10 digit numbers. They must carry the country
code, so `91XXXXXXXXXX`. Claude formats them on load. Rows typed in by hand
need the 91 added manually.

## Volume safety

The Oppora sequence is capped at 20 leads a day and stops messaging anyone who
replies. Do not raise the cap much above that. LinkedIn restricts accounts that
send a lot of connection requests, and the sequence sends from a real personal
profile.

## Rollback

Every Make scenario can be restored from the blueprints in `make/`. Open the
scenario, click the three dots, Import Blueprint, and pick the matching JSON.
Blueprints carry no API key, only the placeholder.
