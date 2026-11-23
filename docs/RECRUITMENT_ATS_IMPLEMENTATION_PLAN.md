# Recruitment Module (ATS): Implementation Plan

**22 Nov 2026: assessment invitations and interview notes (local implementation).** The candidate panel now has **Send assessment**: select an active assessment from the existing Assessments module, select a connected sending mailbox for email, and click **Send by email** or **Send on WhatsApp**. Existing Recruitment and assessment-author permissions both apply. Links use the assessment's existing `/t/<public_token>` page; questions, answer keys, test-taking and results stay in the Assessments module. Candidates enter their own name/email there. This does not introduce candidate-specific attempt tokens or automatic result matching.

Apply `20261122000005_candidate_assessments.sql` after the assessment tables and Stage 3 email migration, then deploy. Email reuses the connected Recruitment Zoho mailbox and appears in its outgoing history. WhatsApp requires the approved `candidate_assessment_invite_v1` template and an active AiSensy API campaign; its body and four parameters are documented in `docs/whatsapp_templates_hr.md`. The optional `AISENSY_CANDIDATE_ASSESSMENT_CAMPAIGN` overrides the campaign name. No credentials or production configuration were changed.

Invitations are recorded in the candidate's activity. A database claim prevents duplicate sends, including concurrent clicks. Each candidate can receive each assessment once per channel; definite failures can be retried. Uncertain or interrupted sends are held instead of blindly resent: check Zoho Sent/AiSensy delivery before any further action. Delivery acceptance is not proof that the candidate read the message or completed the test. No real assessment invitations were sent during implementation.

**Interviews:** notes already attach to the candidate's interview and stay out of the standalone Meeting Assistant list. **Full notes and transcript** opens the existing meeting review inside Recruitment, with summary, topic notes, decisions, open questions and timestamped speaker transcript, plus existing export/retry controls. The interview list refreshes while notes are processing. The HR policy assistant is hidden on `/guest`, `/meet`, standalone meeting routes and embedded meeting screens, including an already-open policy chat.

The owner explicitly selected **transcript and notes only**. Audio is still deleted after transcription, and video is not stored. This is the existing browser-based capture flow, not a separate Fireflies bot: a staff browser must remain connected, recording permissions must work, and upload/processing must complete. Speakers are shown with the labels actually produced; automatic hiring decisions or scores are not added. No changes to model selection, prompts, audio retention or guest access were needed.

Validation: 22 focused assessment, interview and email tests passed. Real-component desktop/phone browser checks passed for both send buttons, duplicate prevention, full notes/transcript, bot hiding and the ended-interview notes destination. Changed-file lint, SQL lint and whitespace checks passed. Type checking still reports the same eight unrelated existing test errors. Delivery and meeting capture used local fixtures; live sends, live calls, production migration and deployment were not performed.

**22 Nov 2026: implementation stage 4, reviewed tracker imports (built locally).** This stage number is the agreed build sequence, not the roadmap's sourcing stage.

- Connecting a tracker saves its settings and opens an actual-candidate preview. It creates no candidates. The default is manual sync. Even if a new connection selects hourly/daily, scheduling waits for its first reviewed import.
- Every sheet column appears in preview. Known columns are suggested; unknown columns require a choice: map to an HRMS field, **Keep as extra column**, or **Don't import**. Extra values stay in the saved tracker row, visible under **Tracker values** in candidate details. They are not added to profiles, reports or stage rules. Ignored columns are shown for review but excluded from newly saved raw rows (unless explicitly used as the status column).
- Preview shows new candidates, existing matches, proposed field changes, duplicate rows, invalid rows, and all source values. Select rows and press **Import selected**. Duplicate candidate/role rows use the last row, visibly flagged. Ambiguous contacts and rows without a usable email/phone are blocked until corrected in the sheet.
- Skipped changed rows remain excluded on subsequent syncs, keyed by the tracker's contact and role. They can be selected in a later preview. A changed contact/role is a different tracker identity. Scheduling explicitly authorizes future new/changed rows without individual previews; new columns stop imports until their mapping is reviewed.
- Preview and import share the same preparation and matching helpers. Import rechecks the sheet, settings, snapshots and affected app values against the review fingerprint. Concurrent syncs/settings changes are guarded. App fields whose source cells did not change remain untouched. Snapshots and record matching page past the database's 1,000-row default.
- Results show added/updated/skipped records and pipeline moves/pending work. A failure requires a fresh preview before retrying; completed rows are matched on retry. Merge imports retain the existing non-transactional behavior: a mid-import database failure can leave some rows saved. The source sheet is never written.

**Stage 4 activation:** A person must apply `supabase/migrations/20261122000004_tracker_preview.sql` after the existing tracker migration, then deploy the code. Existing successfully synced connections retain their scheduling approval. New or remapped connections wait for review. Rerunning the migration does not reapprove remapped connections. No production migration, deployment or real tracker import was performed by this implementation.

**Stage 4 checks:** Actual-schema tests cover read-only preview, exact field changes, selection/exclusions, extras/ignored columns, organisation isolation, stale previews, new-column blocking, ambiguous contacts, duplicate handling, concurrent sync protection and a 1,002-row tracker. A real-component browser test exercises setup, manual default, column decisions, cancel, row selection and final import on desktop and phone with mocked API responses.

Stage 4 validation: all 440 recruitment tests passed, including eight tracker review cases and the pending-stage retry check. The desktop/phone browser test and SQL migration lint passed. The type check reports the same eight unrelated errors in meeting-room, task-manager-report and ticket-reply tests; these were left unchanged.

**Sources:**
- *Recruitment Module – Workflow & Build Specification* (HR, 12 Nov 2026), the full target system
- *ATS tracking system (HR) Meeting* (12 Nov 2026: Roohi, Sanil, Lohitaksha, Sahil), which set the build order

**Branch:** `feat/hr-ats-update`
**Status:** 15 Nov 2026. **Scope narrowed:** we are *not* building the full spec yet. We are building only the **Priority Track** in §3. The full spec stays as the roadmap in §6.
**Status, 20 Nov 2026.** The Priority Track is built, apart from the P1 accuracy run and the P7 evaluation baseline. The requisition flow and the HRMS meeting items 1–4 are built too. **§6 is now the working plan:** what the spec still needs, stage by stage, and the order to build it in. Every step there is approved by the owner before it starts.

**22 Nov 2026, resume uploads Stage 1 (implemented locally; deployment pending).** Every file/folder upload now stops at a preview. HR can choose or type a batch designation / role sourced for and override individual files; Naukri / LinkedIn are detected per filename, with unknown or conflicting markers left Unknown. The assigned role is stored on the resume, separately from the candidate's current job title. The library shows source and designation, allows corrections, filters both, and includes both in Excel. "Any laptop" is now "All users". Duplicate files keep their existing metadata.

**Database step:** apply `20261122000001_resume_sourcing.sql` after `20261116000004_sourcing_duplicates.sql`. It adds the resume role and fills only previously unlabelled, unambiguous Naukri / LinkedIn sources from stored filenames; no re-upload needed. Existing source labels are preserved, and rerunning does not overwrite HR corrections. No live migration was run. Zoho Mail and Standard Tracker changes are outside this stage.

**22 Nov 2026, Zoho Mail Stage 2 (local implementation; deployment and live mailbox check pending).** Recruitment → Resumes → **Zoho Mail** connects a recruitment mailbox with read-only consent. HR chooses the mailbox, folder, starting date (UTC) and default designation. **Sync now — preview** reads attachment metadata only: sender, subject, filename, date, size and filename-based Naukri / LinkedIn source. A same-name warning is only a possible duplicate; import checks the actual bytes. Select up to ten attachments, assign a designation and import; failed files remain available for retry. Originals use the existing private resume store and background parsing. Imported / Already stored history retains the originating email and links to the stored resume. Disconnect clears this Recruitment grant and stops imports, while preserving resumes and history; it does not revoke other modules' Zoho connections or delete mail. Sending mail, candidate reply threads and email-to-requisition drafts are Stage 3, not this change.

Stage 2 setup (operator action, not performed by the implementation):

1. Apply `supabase/migrations/20261122000002_recruitment_mail.sql` **after Stage 1's migration**. It adds three Recruitment-only tables with service-role access and encrypted grants; existing candidate data is unchanged.
2. Reuse the server-based Zoho application's `ZOHO_MAIL_APP_CLIENT_ID`, `ZOHO_MAIL_APP_CLIENT_SECRET`, `MAIL_TOKEN_KEY` and `ZOHO_MAIL_APP_DC` (or `ZOHO_MAIL_DC`). Keep the token key stable. Register **`<app-origin>/api/candidates/resume-mail/callback`** as an additional exact redirect URI on that Zoho client (localhost separately if used). Existing login, Task Manager and Agent Console redirect URIs stay registered. The selected account's data centre must be enabled in the client.
3. Deploy the code, then connect from Recruitment. Finish Zoho consent in the new tab, return and click **Refresh connections**. The requested scopes are `ZohoMail.messages.READ`, `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`; no send, write or delete scope is requested.
4. Save a folder and starting date in manual mode. Preview reads ten emails per request; **Continue preview** walks the next page. Nothing enters the resume library until **Import selected**. Unsupported types and files whose reported size exceeds 15 MB are omitted; downloads enforce the size limit too. Filename source can be corrected in the library. Matching bytes retain the first stored resume's source/designation.
5. Optional: finish the first preview, skip unwanted attachments, then explicitly enable **Every hour — automatic import**. This imports **all pending and future supported attachments**, not only previously ticked rows, with the connection's default designation. The `/api/cron/resume-mail` schedule is included at minute 50 each hour and requires `CRON_SECRET`. Each scheduled run scans ten emails and imports up to three attachments per connection; larger queues continue on later runs. Failed attachments rotate behind unattempted ones. Pause stops scanning/importing; a running operation must finish before settings can change.

The connector uses [Zoho's folder-filtered email listing](https://www.zoho.com/mail/help/api/get-emails-list.html) and [folder-scoped attachment metadata](https://www.zoho.com/mail/help/api/get-attach-info.html). Offset pagination is not a mailbox snapshot: a completed pass restarts from the newest email to catch changes, and stored message/attachment identities prevent reimport. New mail may wait until the next pass when walking a long history. No email body is stored, no email is marked read, and no mail is sent or deleted. The initial live check should use a dedicated recruitment folder with a few known resumes, including a duplicate and a non-resume attachment.

Stage 2 verification: the combined Recruitment + existing Zoho Task Manager regression run passed **459 tests**. The final focused mail run passed **9 tests**, including the later storage-retry and direct-database-access checks. Browser tests cover the real resume-upload and mail components on desktop and phone with mocked APIs; no external mailbox or storage was contacted. New code passes lint and migrations pass SQL lint. The full type check retains eight unrelated existing test errors; the shared Zoho service retains four pre-existing `any` lint errors (five before this change). No live migration, build, deployment, commit or push was performed.

**22 Nov 2026, Zoho Mail Stage 3 (implemented locally; deployment and live mail check pending).** The new **Recruitment → Email** tab sends individual candidate emails, reads incoming replies and converts reviewed incoming hiring requests into ordinary requisition drafts. It shares Stage 2's connections, selected folder and starting date. Emails loaded into this tab are visible to users with Recruitment access in that organisation.

Stage 3 setup and use:

1. Apply `supabase/migrations/20261122000003_recruitment_email.sql` after Stage 2, then deploy. It adds correspondence storage, optional sending consent and a unique email reference on hiring requests. Existing grants remain read-only. No additional server secrets or redirect URI are needed beyond Stage 2.
2. In **Email**, choose **Connect Zoho for sending**, approve the additional `ZohoMail.messages.CREATE` permission, then **Refresh connections**. The existing read scopes remain. The connection resets to manual resume syncing on reconnect. A later read-only reconnect from Resumes removes the app's sending capability for that grant.
3. Choose a candidate, write the subject/message, **Save draft and review**, check From/To and the full message, then **Send email**. Drafts send nothing. Only their author can edit/send them. A draft changed after its preview must be reviewed again. Recipient addresses come from the candidate record or selected incoming email; send-time checks recheck the candidate address, blacklist, connection and permissions. Sending is plain text to one recipient, without attachments, CC/BCC, bulk campaigns or automated sends. Outgoing history covers messages composed here; pre-existing Zoho Sent history is not imported.
4. **Check emails** loads 30 messages from the configured folder and date per call; **Continue checking** walks older messages. Checks are manual. Candidate matching uses a unique exact sender address; shared or unknown addresses remain unassigned. Read the email to load its body as plain text without external images. **Reply** uses Zoho's original message ID; the conversation shows loaded messages in that thread, and the candidate filter shows correspondence across threads. Mail elsewhere in Zoho is not silently imported.
5. A confirmed send means Zoho accepted the request, not proof of delivery or reading. An uncertain response is marked **unknown** and is never automatically resent. If a process stops after starting a send, it remains **sending**. Check the mailbox's Sent folder in Zoho, then confirm sent/not sent in the email details; a confirmed “not sent” returns to draft for another review. A mailbox lock can take up to ten minutes to expire after a server interruption. Blindly confirming “not sent” can duplicate an email.
6. Open an incoming request and choose **Create hiring request draft**. Review the role, department, location, headcount, budget and reason. Only users already permitted to raise hiring requests can create it. The signed-in user raises the draft; an email sender is never granted access or treated as an authenticated requester. A source-email reference prevents duplicate requests. **Open Requisitions** to complete missing details and submit through the existing approval flow. No AI extraction, automatic submission or approval is introduced.

Provider references: [Zoho send API](https://www.zoho.com/mail/help/api/post-send-an-email.html), [Zoho reply API](https://www.zoho.com/mail/help/api/post-reply-to-an-email.html). Stage 3 reuses the existing mailbox transport, encrypted-token helper, candidate picker, dialog, plain-text email conversion and requisition creation/permissions. The initial live check should send one message to a controlled test candidate, receive a reply in the chosen folder, and convert a test hiring-request email into a draft; no live test message has been sent by this implementation.

Stage 3 verification: **469 regression tests passed** across Recruitment and existing Zoho Task Manager behaviour; the final **10 focused email tests** also passed after adding stale-preview and interrupted-send checks. Desktop (1440 px) and phone (390 px) browser checks passed for candidate selection, draft/review/send, incoming mail and reviewed hiring-request creation, including plain-text handling and no premature send. New/changed feature code and SQL pass lint; the same eight unrelated test type errors and four pre-existing shared Zoho service lint errors remain. No build, live migration, deployment, commit, push or real email send was performed.

**Progress (15 Nov 2026).** Built on the branch, not yet merged: search fixes (phrase matching, dropdown counts = search counts, `/` alternative groups, typed AND / OR / NOT, "matched in" tags); JD upload and the reader's skill groups and conflicts; migration `20261115000002` (positions, insert-only history, blacklist, "Others", `keep_as_resume`) — **to be applied by a person**; remarks, "Others" and blacklisting; the Pipeline tab per position; Needs attention actions; the screens rebuilt to the approved mockup (header row, Positions tab, JD strip, compact cards, one-column candidate panel with the inline status change, pipeline board, Needs attention rows and the resume library table). Details and decisions: `docs/features/candidate_search.md`, "Decisions (owner, 2026-11-15)". Still to do: the accuracy run on the three sample JDs (P1).

**Progress (16 Nov 2026).** P3 + P7 built on the branch: the **Calls** tab on the candidate's panel (upload a recording or paste a transcript, for a position, with the consent tick), migration `20261116000001` (`call_analyses` + the private bucket `candidate-calls`) and `20261116000002` (the two model jobs), the pipeline in `backend/lib/callInsights/` (Groq Whisper with time stamps → one structured Claude call → sentiment, interest, the mood over the call, concerns, red flags, the facts heard with quotes), "Apply" per fact onto the record (history: `field_edit` from the call; the reason for change as a remark), playback, retry, delete. **Both migrations and the bucket are to be applied by a person.** Agent spec: `docs/agents/call-insights-spec.md`. Not built: the P7 evaluation baseline.

**Outreach (16 Nov 2026, owner: "ok to send WhatsApp messages for this demo").** Built: the WhatsApp update to the candidate after Shortlisted / Rejected (the pipeline's prompt and the panel's "Send update"), two Meta templates to approve (`docs/whatsapp_templates_hr.md` §1b), migration `20261116000003` (`candidate_outreach` + the `outreach_sent` history action, to be applied by a person), the checks (blacklist, phone, once per position, role) and the history entry. Candidates only receive; the footer says not to reply. Hiring-manager and recruiter notifications stay in §6.

**16 Nov 2026, later.** Owner asks after the first look: the module marked **Beta**; a **"Search for"** dropdown in Search (a saved position with its JD, or a role people were sourced for); and **"already in the database"** (owner: keep and flag, sheets too, the source dropdown optional): a vendor's resume or sheet row for a person the team already had is kept, flagged on the file / row and in the person's history with where the copy came from and how the person was first sourced, with a filter and an export for vendor disputes. Migration `20261116000004` (to be applied by a person) also fixes the permanent deletes, which the insert-only history had been refusing. Details: `docs/features/candidate_search.md`.

**16 Nov 2026, the position as a job record.** Owner, after pasting a long JD: "only 3 parameters were extracted … this is definitely not how a tier 1 company would work"; the reader had in fact found 11, but a position was only a saved search, with nowhere for the job's own details. Built (owner: "go ahead with the create position form, no approvals for now"): the **Create / Edit position form** with the JD, the basics, the requirements and a summary, filled from the JD by two readers and checked by HR; migration `20261116000005` (to be applied by a person). "Search for" now lists only the positions created there. Requisition approval (§6 Phase 1) stays out for now.

**19 Nov 2026, configurable stages and editable WhatsApp (HRMS meeting MOM: "add more stages", "editable WhatsApp messages").** Owner: the stages are the HR team's standard-tracker statuses (Screening Pending/Reject, L1 Pending/Select/Reject, L2/Assignment Pending/Reject, L3 Pending, Director Round Pending, Final round select/reject, Salary discussion pending, Backout, Already Sourced, L1/L2/L3 Feedback Pending), keeping Sourced, Offer and Joined; "make the stages customizable" in a **Configurations** tab; one list for every position; anyone in HR may change it. Built:
- `backend/lib/candidates/stage-list.ts` (the built-in list, the rules a saved list must keep, the board's grouping) and `stages.ts` (load and save; a stage's key never changes, so a rename never moves anyone; no delete while people are in a stage, hide instead; two people saving at once cannot overwrite each other; every save is in `recruitment_stage_changes`, insert-only). `GET/PUT /api/candidates/stages`.
- **Recruitment → Configurations**: each stage's name, board column (round), type (Active / Rejected / Out of the flow, with a one-line hint under it; 20 Nov the owner merged "In progress" and "Selected" into Active, as they behaved the same; lists saved earlier read "selected" as Active), colour, "Offer a WhatsApp update" with its default text, and "Remark needed"; reorder, add, hide, delete; Save / Discard; the recent changes.
- **The board**: one column per round, scrolling sideways; each status is an area in its column to drop a card on; Rejected areas fold to a count; out-of-the-flow stages are the strip under it. The table, the candidate panel ("Next round" and "Reject" for the round), the Positions funnel and the Calls tab's round all follow the list.
- **Editable WhatsApp**: one new template `candidate_stage_update_v1` (`docs/whatsapp_templates_hr.md` §1b, Template 12) with a fixed opening and closing and HR's text in the middle, prefilled from the stage's default and edited before each send; once per person, position and stage. The two earlier fixed messages are no longer offered (kept in the history).
- **Migration `20261119000001_recruitment_stages.sql`, to be applied by a person.** It also moves people at the old stages that the new list renames: Screening → Screening Pending, Shortlisted and Interview → L1 Pending (days in the stage kept). People at Rejected or Others stay there, shown out of the flow until moved. Until it is applied the app keeps the old ten stages and the Configurations tab is read-only.
- **To do by a person:** apply the migration; submit `candidate_stage_update_v1` in AiSensy for Meta's approval (until then sends are recorded as failed). Tests: `tests/candidates/stages.test.ts`, `outreach.test.ts`.

**19 Nov 2026, interviews with a video link (HRMS meeting: "video meeting link generation"; owner: "go ahead with 3").** **Schedule interview** on the candidate's pipeline panel (`frontend/components/candidates/InterviewScheduler.tsx`, `backend/lib/candidates/interviews.ts`, `POST /api/candidates/interviews`):
- Round (prefilled from the person's column, e.g. L1), date and time (India time), **Online / In person** (owner: "hybrid mode is not required"), the venue, interviewers picked from the Task Manager's people, a note, and optionally a stage to move to.
- Online makes the Meeting Assistant's **online meeting** in the **HR space** (one link for everyone: the interviewers picked go straight in, the candidate waits to be let in; recorded in a team member's browser; notes written, tasks not looked for). In person makes no call.
- **Everything stays in Recruitment** (owner: "i dont want the user to go to meeting assistant"): the candidate's Interviews tab has **Join call** (the video call opens over the Recruitment page) and, for an in-person interview, **Record interview** (the Meeting Assistant's recorder, over the page; `POST /api/candidates/interviews/record`). These meetings carry `meeting_notes.purpose = 'interview'` and are **not listed in the Meeting Assistant** (owner: "yes hide it").
- The interview is a history entry under the position (`remark`, meta.kind "interview", with the meeting it made), so no new table.
- Invites only where HR ticks: the candidate on WhatsApp (new template `candidate_interview_invite_v1`, §1b Template 13, recorded in `candidate_outreach` as `interview_invite`) and by email, the interviewers by email. Never to a blacklisted person. A failed send never undoes the interview; the form lists what went, and gives the link with **Copy** and **Share on WhatsApp** (the meeting's "WhatsApp copy-link sharing").
- The candidate panel's new **Interviews** tab lists each interview, its link while it is ahead, and the call's notes (summary, decisions, open questions) once written.
- **Migration `20261119000002_recruitment_interviews.sql`, to be applied by a person, after 20261119000001** (the invite kind, `interview_id`, one invite per interview, `meeting_notes.purpose`; before it, interview meetings still show in the Meeting Assistant). Before it, interviews are scheduled but the WhatsApp invite is not sent (the form says so). **Submit `candidate_interview_invite_v1` in AiSensy.** Online interviews also need the LiveKit keys (as the Meeting Assistant). Tests: `tests/candidates/interviews.test.ts`.
- Someone from the team must be in the call for it to be recorded and to let the candidate in (guests never record). Joining and recording use the Meeting Assistant's HR-space access: people with an HR role (and, for joining, the person who scheduled it and the interviewers picked).

**17–20 Nov 2026, manpower requisition (spec Stages 1–2; HRMS meeting item 4).** Paused and resumed on 17 Nov ("follow these stages and rules"). Built:
- **Raising a request** (Stage 1). The form has the spec's fields, generates a requisition ID and can be saved as a draft. Requests are raised **only from the logins**: a **Hiring requests** sidebar item (`/[orgId]/hiring-requests`, `frontend/components/recruitment/HiringRequestsPage.tsx`) shows for the roles and people picked in the Tech dashboard. Nobody gets it until someone is picked. The raiser can withdraw their own request; the button is hidden for everyone else.
- **Approval** (Stage 2). The HR Head reviews first and ticks "in plan" (a simple tick box, no headcount list). Out of plan, or above the CTC level, also goes to the Director. Each level has a backup. **Nobody approves a request they raised**: that level's backup takes it, or the other level does. Actions: approve, reject with reason, send back, hold. Alerts go by email and WhatsApp with a **one-time phone link**, so approvers can act without a desktop login. Reminders fire at 24 h and 48 h and escalation at 72 h, once each per level, from the hourly cron `/api/cron/requisition-reminders`. **An approved request opens a position** in the Positions tab, with the target days.
- **HR's Recruitment → Requisitions tab is a tracker only**: who raised what, the status, and who it is waiting on. It has no "Raise a request" button.
- **Tech dashboard → HR Configs** (a sidebar tab, not Settings) holds who can raise requests (roles and people) and the approvers (HR Head and Director, each with a backup), the CTC level for the Director, and the target days. It is changed by the Tech team and admins. The people lists are the **Task Manager's employee list**. The HR Head dropdowns list only the HR team; the Director dropdowns list only org super admins. Every change is logged in `recruitment_stage_changes`.
- **21 Nov 2026, the requisition gaps (owner: "go ahead with all"):**
  - The tracker filters by **department, location and status** and shows **candidates in pipeline** for each approved request.
  - The form **keeps what was typed through a page refresh**, in this browser until it is saved or cancelled.
  - **Department heads** are set in HR Configs (department and person, from the Task Manager's list). A head gets Hiring requests in their sidebar, sees their department's submitted requests, is emailed when one is raised, and can **endorse** it. Endorsing is shown to the approvers and approves nothing; the HR Head and Director still decide.
  - **A24 on-hold chaser:** after 15 and 20 days the raiser is asked "still needed, or withdraw?". **Still needed** tells the approver and stops the raiser's chasers. Day 25 goes to the HR Head.
  - **A03:** an approved request opens its position with **no recruiter**. The HR team is emailed to assign one, using a new Recruiter picker on Recruitment → Positions (HR team only). The person picked is emailed, and the HR Head is emailed if nobody is assigned after 48 h.
  - All alerts are by email; WhatsApp is parked.
  - **Migration `20261121000001_recruitment_requisition_followups.sql`, to be applied by a person.** It adds the "endorsed" and "still needed" history entries. Until it is applied those two buttons say a database update is needed; everything else works.
- **21 Nov 2026, connected trackers (HRMS meeting item 5).** In Recruitment → Sheets, **Connect a tracker**: a Google Sheet or Excel (OneDrive/SharePoint) share link, the tab, the header row, the column matching (guessed, HR corrects it), the status values matched to pipeline stages, and how often to sync (hourly, daily, manual). Owner's rules:
  - **one way, sheet → app**, through the upload's cleaning and Merge, so nothing is deleted;
  - statuses move people in the **open position whose title matches the row's role**;
  - a cell only changes the app if it **changed in the sheet since the last sync**;
  - the sheet is shared **"Anyone with the link can view"** (no Google sign-in);
  - **duplicates are flagged**: the same person and role twice in the tracker (the last row is used and flagged for review), and a person already in the database (the import's "already in the database" flag).

  A tab that **repeats its header row** (the owner's tracker has 116 blocks with columns in different orders) is read block by block. Code: `backend/lib/candidates/trackers.ts`, `/api/candidates/trackers*`, hourly cron `/api/cron/tracker-sync` (vercel.json), `TrackerConnections.tsx`. **Migration `20261121000002_candidate_tracker_connections.sql`, to be applied by a person.** Tests: `tests/candidates/trackers.test.ts`.
- **21 Nov 2026, Phase 1 steps 1–6 (owner: "go on with all the steps").** Everything is by email; WhatsApp is parked.
  1. **Rejection reasons.** A fixed list in Configurations (HR edits it). A rejection asks for a reason; moving someone back a round asks for a remark. This is enforced on the server too.
  2. **Interview follow-up.**
     - Mark done, no-show or cancelled; reschedule. Cancelling and rescheduling email the candidate and the panel.
     - Reminders 24 h and about 2 h before, sent by the hourly job.
     - Once the time has passed, the person who booked it is asked to mark it; the HR Head is told the next day.
  3. **Scorecards.**
     - One per interviewer, from a one-time link in their invite, with no login.
     - Four skills rated 1–5, an overall rating, proceed / hold / reject. Comments are required to reject.
     - The other interviewers' ratings are shown only after submitting. Chasers go at 24 h and 48 h, and the HR Head at 72 h.
  4. **Selection and offer** (Interviews tab → "Select and make an offer"; the new **Offers** tab).
     - The CTC is checked against the request's band. The HR Head approves, and the Director too when above the band; the proposer never approves.
     - The letter comes from HR's template (Configurations), and release is blocked while a `{{blank}}` is unfilled.
     - HR releases it by email and records the answer. Chasers cover A14–A17.
  5. **Joining.**
     - Weekly call reminders, and the HR team is told 7 days before.
     - Joined: the person moves to Joined, and the position closes when every opening is filled.
     - Dropped: the position reopens, and the HR Head and Director are told.
  6. **Dashboard tab.** Today, Roles and Funnel, each with an Excel (CSV) export.

  **Migration `20261121000003_recruitment_hiring_flow.sql`, to be applied by a person.** Code: `backend/lib/candidates/hiring.ts`, `recruitment-dashboard.ts`, `/api/candidates/{interviews/follow-up,scorecards/[token],offers,offer-letter,dashboard,rejection-reasons}`. Tests: `tests/candidates/hiring.test.ts`.
- Tables (migration `20261117000003_recruitment_requisitions.sql`, applied by a person): `recruitment_requisitions`, `recruitment_requisition_approvals` (insert-only), `recruitment_requisition_notices`, `recruitment_requisition_counters`. Code: `backend/lib/candidates/requisitions.ts`, `requisition-notify.ts`, `app/api/recruitment/*`. Tests: `tests/candidates/requisitions.test.ts`.

---

## 1. What the meeting decided (and how it shapes this plan)

| Meeting point | Effect on this plan |
|---|---|
| Build phase by phase, **JD and database matching first** | P1 (accuracy) and P2 (JD upload) come first |
| Until IVR exists, **call on a normal phone and upload the recording** for transcription and sentiment | P3 + P7: upload-based call analysis now, IVR webhook later |
| **Every shortlist, reject or hold carries a remark** | P4: remark is mandatory on these actions |
| Offer accepted but did not join, or bad behaviour → **blacklist / do-not-contact, never in search again** | P6 |
| HR starts using internal search now and gives feedback | P1 adds an in-app "relevant / not relevant" signal so the feedback is captured as data |
| Repeated queries should not re-scan every CV; about $100/month goes on AI ranking | P1 measures cost and adds caching where it pays |
| Public "small Naukri" platform, IVR, MCP tracker sync, vendor logins | **Not in this track** (see §5) |

**Monday 16 Nov demo** (meeting task 1): *add a position → search the database → demo call → recording → sentiment → shortlist / not-shortlist outreach.*
Today only **search** and **paste a JD** exist. Adding a position needs P2, the call and sentiment steps need P3 and P7, and outreach is not in this track. The demo should show the current search and walk through this plan for the rest.

---

## 2. What already exists (reuse, don't rebuild)

| Area | Already in the repo | Where |
|---|---|---|
| Candidate database | `candidates` (one row per person, deduplicated by `phone_key` / `email_key`) + `candidate_applications` (one sourcing record per sheet row or hand entry: role, source, experience, notice, ₹/month in hand, `remark`, `status`) | `supabase/migrations/20261102000003_candidate_search.sql` and later `*candidate*` migrations |
| Sheet import | Excel/CSV import with row issues, Replace/Merge, AI fix, soft delete and restore | `app/api/candidates/sheets/*`, `backend/lib/candidates/import.ts` |
| Search | Filters (SQL) + keyword (FTS) + meaning (vector), combined with RRF; plain-English query → filters | `app/api/candidates/search`, `filter`, `backend/lib/candidates/search.ts` |
| Paste a JD | `POST /api/candidates/understand` turns JD text into filters for HR to edit | `app/api/candidates/understand/route.ts` |
| AI ranking | `POST /api/candidates/rank` scores and explains matches against `jobText` | `app/api/candidates/rank/route.ts`, `rerank.ts` |
| Search logging | `candidate_search_logs`: query, parsed spec, `result_ids`, timings per step | same migration |
| Resumes | Upload (SHA-256 dedupe), text extraction, scan, LLM field extraction, auto-link by email/phone, **manual attach / detach** (`PATCH /api/candidates/resumes/[id]`) | `app/api/candidates/resumes/*`, `backend/lib/candidates/resume-*.ts` |
| AI model choice | Per-job model chain chosen in the Control Center (`candidate_parse`, `candidate_rank`) | `backend/lib/candidates/models.ts` |
| Access | HR roles, org super admin, Tech, master admin (module-only check) | `backend/lib/candidates/access.ts`, `app/api/candidates/_lib/auth.ts` |
| UI | `CandidateSearchTab` (Search, Records, Sheets, Resumes views; `CandidateDetails` panel), mounted in the Tech dashboard and HR Tickets | `frontend/components/candidates/*` |
| Call transcription | OpenAI Whisper client with segment timestamps (used by CRM call coaching) | `backend/lib/coaching/whisper.ts`, `pipeline.ts` |
| Call analysis pattern | Transcript → structured facts with evidence quotes (SATEJ vendor calls) | `backend/lib/satej/prompts/callAnalyst.ts` |
| Agent tracing | `withAgentRun` (run/step telemetry, tokens, cost) | `backend/lib/agents/instrument.ts` |
| Tests | `tests/candidates/*.test.ts` | |

**Not there yet:** a blacklist or do-not-contact flag, a per-action remark history (only one `remark` field that gets overwritten), JD file upload, saved positions, recording or transcript upload for candidates, and sentiment analysis.

---

## 3. Priority Track

Build order is in §4. Each item lists **goal → reuse → build → rules → done when**.

### P1: Test query accuracy on the ~3,000 profiles

**Goal:** know, with numbers, how well real HR requirements find the right people. Then decide how to handle must-have skills when CVs don't contain the keyword.

**Reuse:** the existing search modes, `candidate_search_logs` (timings, result IDs), and the `rank` endpoint.

**Build:**
1. **Data-quality audit** (read-only script): the share of the ~3,000 records that have phone/email, skills, total and relevant experience, notice period, CTC, an attached resume, and extracted resume text. This explains *why* some searches miss.
2. **Gold set:** 20–30 real queries from HR's current and recent open positions. For each one, HR labels the top results as relevant or not, and names any "must-find" people they know are in the database.
3. **In-app feedback:** a 👍 / 👎 "relevant?" control on each result card, with an optional note. It is stored in a new `candidate_search_feedback` table (search_log_id, application_id, relevant, note, user, at). This captures HR's feedback as data and keeps the gold set growing.
4. **Eval script** (`scripts/candidates/eval-search.ts`, read-only): runs every gold query in four modes: *filters only*, *+ keyword*, *+ meaning (hybrid)*, and *+ AI rank*. It reports:
   - precision@10 and recall of must-find people
   - median latency
   - AI cost per query
5. **Must-have experiment:** compare a *hard filter* against a *strong boost* for must-have skills, with and without inferred skills (`candidates.inferred_fields`) and resume text.
6. **Caching:** cache AI-rank results by (normalised query spec + record-set version), so a repeated query costs nothing. Indexing already avoids re-reading CVs at search time.

**Output:** `docs/CANDIDATE_SEARCH_ACCURACY_REPORT.md` with the baseline numbers, the must-have decision, and the next fixes.

**Rules:** the eval and audit scripts only read the database (CLAUDE.md).

**Done when:** the baseline numbers are published, HR agrees a target (for example, at least 7 of the top 10 relevant on the gold set), and the must-have rule is chosen from data, not opinion.

---

### P2: JD upload option

**Goal:** HR uploads a JD file, the system turns it into editable filters, and HR searches and ranks the database against it. The JD is saved so it can be reused.

**Reuse:** resume text extraction (PDF/DOCX → text) from `backend/lib/candidates/resume-text.ts`; the `understand` endpoint (JD text → filters); the `rank` endpoint (`jobText`).

**Build:**
- **Data:** `candidate_positions`: a light "open position" holding its JD (title, department, location, `jd_text`, `jd_file_path`, `jd_file_name`, `filters` jsonb as last confirmed by HR, `status` open|closed, created_by, timestamps, `deleted_at`). The file goes in private storage, like resumes.
- **API:**
  - `POST /api/candidates/positions` (create with a file or pasted text)
  - `GET` (list)
  - `PATCH` (edit / close)
  - `POST /api/candidates/positions/[id]/search` (runs the saved filters, optionally with AI rank)
- **UI:** an "Upload JD" button next to the existing paste box. After upload: the parsed text, then the filters (editable), then the results. A **Positions** list in the tab to reopen a saved JD and re-run it.

**Rules:**
- The JD → filters step only *suggests*; HR confirms the filters.
- The size limit and file types (PDF, DOCX, TXT) match resume upload.
- If long JDs need a change to the `understand` prompt, that prompt change needs an Agent Spec Block (see [AGENT_DOCTRINE.md](AGENT_DOCTRINE.md)).

**Done when:**
- A PDF and a DOCX JD each upload, parse, produce sensible filters and return results.
- The position is saved and can be re-run.
- Tests cover parsing and the positions API.

---

### P3: First outreach call by phone (record → upload → analyse)

**Goal:** the recruiter's first call to a candidate is captured and analysed automatically: transcript, summary, screening facts and sentiment.

**Now (no IVR):** the recruiter calls on a normal phone, records it, and uploads the recording from the candidate's panel. Optionally they link it to a position from P2.

**Later (IVR, meeting task 8):** the IVR provider posts each finished recording to a webhook, which feeds the same pipeline. Only the input changes.

**Build:**
- A **"Calls" section** in `CandidateDetails`: upload a recording (or a transcript, see P7), pick the position (optional), then see the analysis when it is ready.
- On upload, the system creates a P7 analysis with `subject_type = 'candidate'`.
- **Suggested field updates:** facts heard on the call (current CTC, expected CTC, notice period, location, reason for change) are shown next to the current values with an evidence quote. **HR clicks to apply each one. Nothing is overwritten automatically.**
- Every call is logged as a P4 action (`call_logged`).

**Rules:** **candidate consent to recording** (see open questions). Recordings are private, and only HR roles can play them.

**Done when:** a real recorded call uploads and the transcript, summary, sentiment and suggested facts appear on the candidate. Applying a fact updates the record and shows in the timeline.

---

### P4: Remarks on every action (per candidate)

**Goal:** every decision on a candidate carries a reason, and the full history is visible. Today a single `remark` field gets overwritten.

**Build:**
- **Data:** `candidate_actions`, which is **insert-only** (a trigger blocks UPDATE and DELETE). Fields:
  - `id`, `organization_id`, `candidate_id`
  - `application_id` (the record, if any), `position_id` (if any)
  - `action`: `status_change` · `shortlist` · `reject` · `hold` · `blacklist` · `unblacklist` · `resume_attached` · `resume_forced` · `call_logged` · `note`
  - `from_status`, `to_status`, `remark`, `meta` jsonb
  - `created_by`, `created_at`
- **API:** the status change (`PATCH /api/candidates/[id]`) writes an action row in the same request. A new `POST /api/candidates/[id]/actions` adds a plain note.
- **UI:**
  - Changing status opens a small dialog with a remark box.
  - A **History** timeline in `CandidateDetails` (who, what, when, remark).
  - The latest remark shows on the result card.

**Rules:**
- **The remark is mandatory for shortlist, reject, hold and blacklist** (meeting decision). The server rejects the change without one, not just the UI.
- The existing `remark` column stays as "latest note" for import compatibility.

**Done when:**
- Shortlist, reject and hold without a remark are refused by the API.
- With a remark, they are saved and appear in the timeline in order.
- Tests cover the remark rule and that the history cannot be edited.

---

### P5: Force-upload a resume for a candidate

**Goal:** HR can attach a resume to a specific candidate directly, even when the automatic email/phone match didn't link it or linked the wrong file.

**Reuse:** the existing upload flow and `PATCH /api/candidates/resumes/[id]` (attach / detach).

**Build:**
- An **"Upload resume"** button in the candidate's Resume section. It uploads the file through the existing path with a `candidateId` and attaches it straight away (`match_reason = 'manual'`), skipping auto-matching.
- **Conflicts:**
  - If the same file (by SHA-256) is already attached to *another* candidate, show who it is attached to and ask for confirmation before moving it.
  - If the candidate already has resumes, the new one is added as the latest version. **Older versions are kept.**
- Each attach writes a P4 action (`resume_forced`, with the file name and any previous owner in `meta`).

**Rules:** extraction runs as usual on the new file. Check during build that extraction **does not overwrite fields HR entered by hand**. If it does, show those values as suggestions instead.

**Done when:**
- A resume can be attached to a candidate who has no match.
- Moving a file from another candidate asks first and is logged.
- Old versions are still downloadable.

---

### P6: Candidate blacklisting

**Goal:** people who accepted an offer and didn't join, who behaved badly, or who asked not to be contacted **never appear in search again**, and the team can see why.

**Build:**
- **Data** (per person, on `candidates`, an additive migration): `blacklisted_at`, `blacklisted_by`, `blacklist_reason` (fixed list: *offer accepted, did not join* · *misconduct* · *false information / documents* · *asked not to be contacted* · *other*), and `blacklist_remark`. Unblacklisting clears the fields. Both actions are kept in `candidate_actions`.
- **Effects:**
  - **Hidden** from search, filters, AI rank, positions search and exports.
  - **Shown** in the Records view with a red badge, behind a "show blacklisted" toggle.
  - **Import and resume upload:** a sheet row or resume that matches a blacklisted person by phone or email is flagged in the import issues ("blacklisted: \<reason\>") instead of quietly bringing them back.
- **UI:** a "Blacklist" action in `CandidateDetails` (reason + mandatory remark), and an "Unblacklist" action (mandatory remark).

**Rules:**
- Blacklisting is per **person**, so it applies to all of that person's records.
- The remark must be factual (it is personal data about someone outside the company).
- Who may unblacklist is an open question.

**Done when:**
- A blacklisted person is missing from every search path, including AI rank and export.
- A re-import of their row is flagged.
- Unblacklisting restores them.
- Tests cover each search path.

---

### P7: Call sentiment analysis module ("Call Insights")

**Goal:** a reusable module. You upload a call **recording** or a call **transcript** (later an IVR posts it automatically) and get an interpretation of the other person's sentiment, plus a summary and key facts. Candidates are the first use (P3). The design allows other subjects later (for example BD calls).

**Inputs:**
- Audio (mp3, m4a, wav, ogg) → Whisper transcription, reusing `backend/lib/coaching/whisper.ts`
- A transcript as pasted text or a file (.txt, .docx, .vtt, .srt) → used as is
- Later: an IVR webhook delivering audio plus call metadata

**Output** (structured JSON; every judgement carries a short evidence quote from the transcript):

| Field | Meaning |
|---|---|
| `overall_sentiment` | positive · neutral · negative, with a confidence level |
| `interest_level` | high · medium · low (interest in the role / proposal) |
| `sentiment_timeline` | sentiment per segment, to show where the call turned |
| `concerns` | what the person worried about (salary, location, notice, shift…) |
| `red_flags` | concrete concerns only, each with a quote |
| `facts` | current CTC, expected CTC, notice period, location, reason for change. Each value is null when not said, never guessed |
| `summary` | 2–3 sentences a recruiter can read in 10 seconds |
| `suggested_next_step` | advisory text only |

**Build:**
- **Code:** `backend/lib/callInsights/`: `transcribe.ts` (wraps the existing Whisper client), `analyse.ts` (one structured LLM call per context), `contexts/candidateScreening.ts` (prompt and schema), and `pipeline.ts` (idempotent, wrapped in `withAgentRun` for tracing).
- **Data:** `call_analyses`. Fields:
  - `id`, `organization_id`
  - `subject_type` ('candidate'), `subject_id`, `position_id`
  - `input_kind` (audio | transcript), `storage_path`, `file_name`
  - `transcript_text`, `segments` jsonb
  - `status` (uploaded → transcribing → analysing → done | failed), `error`
  - `result` jsonb, `model`, `tokens_in`, `tokens_out`, `cost`
  - `created_by`, `created_at`, `deleted_at`
- **Storage:** a new private bucket for call audio. A person creates it, like other infra changes.
- **API:**
  - `POST /api/call-insights` (upload + start)
  - `GET /api/call-insights/[id]` (status + result)
  - `POST /api/call-insights/[id]/retry`
  - `GET /api/call-insights?subjectType=&subjectId=` (list)
- **UI:** the Calls section in `CandidateDetails` (P3) and a **Calls** view in the Candidate Search tab (all analyses, filters by sentiment and position, upload a transcript not yet linked to a candidate).
- **Model:** a new `call_analyse` job in the existing Control Center "AI models" chain, so the model can be changed without a release.

**Rules:**
- **Advisory only.** Sentiment never changes a candidate's status and never rejects anyone. A person decides (spec rule "Human decides").
- Facts are never invented. A missing value is null.
- Transcripts and audio are personal data: private storage, HR-only access, soft delete.
- Language: calls will often be Hindi/English mixed. Test transcription quality on real calls before relying on it.

**Done when:**
- An audio file and a pasted transcript both produce a result.
- Failures show a clear error and can be retried.
- The P7 evaluation below has a baseline.

#### Agent Spec: Call Insights (candidate screening)

**1. Workflow or agent?** Workflow. The pathway is known ahead of time (transcribe → analyse → store) and has few edge cases `[BAA p.104]`.
   Justification: N/A for an agent. The doctrine's default is a workflow `[BAA p.115]`.
   Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`: no prior path exists. Today recruiters only keep notes by hand.

**2. Context** `[BAA p.112]`
   It knows: one call transcript, the linked position's JD (if any), and that candidate's current record fields. It knows nothing about other candidates, nor about employees' salaries.

**3. Cost of a false positive** `[BAA p.112]`
   High. A wrong "negative / not interested" read can bias a recruiter against a real person. → Model tier: **larger** (via the `call_analyse` chain), because the output is shown next to a decision about a person. This is mitigated by evidence quotes and by a human making every decision.

**4. Tools**
   | tool | description reviewed for when-not-to-use? `[BAA p.107]` | returns errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
   |---|---|---|---|---|
   | none: one structured-output call, no tool use | N/A | N/A (pipeline catches errors and stores `status = failed` + `error`) | input validated before the call `[BAA p.93]` | N/A |

**5. Prompt** `[BAA pp.105, 114]`
   Numbered ordered steps: yes. Explicit no-skip clause: yes (the same style as `satej/prompts/callAnalyst.ts`).
   Single-shot tone example: one worked transcript → result. Terminal state written to data: `call_analyses.status = 'done'` with `result` `[BAA p.114]`.

**6. Memory** `[BAA pp.100–103]`
   Does this workload repeat? No. Each call is independent. → No write tool.

**7. Multi-agent?** `[BAA p.116]`
   Single. Transcription is a non-LLM step. The one analysis prompt per context is tuned on its own, so changing the candidate prompt cannot regress another context.

**8. Evaluation: all four axes** `[BAA pp.118–119]`
   - **System:** Whisper and LLM latency and error rate from the run traces.
   - **Quality assurance:** 15–20 real calls labelled by HR (sentiment, interest, facts). A rubric grader from a different model family, mid-tier, scoring 0–3 with reasoning before the score, plus a manual audit of at least 10% `[BAA pp.96–98]`.
   - **Tool interaction:** N/A, no tools `[BAA p.95]`.
   - **Agent efficiency:** tokens and ₹ per analysed call, and audio minutes transcribed `[BAA p.119]`.

**9. Trace** `[BAA pp.119–120]`
   Run/step telemetry: `withAgentRun` around the transcribe and analyse steps. Ad-hoc testing on about 10 real calls before HR uses it `[BAA p.116]`.

**10. Laws knowingly violated, and why:** none. L9 (MCP default) `[BAA pp.106–107]` does not apply yet, because no agent calls this as a tool. If the Brain or MCP needs it later, it gets exposed then.

---

## 4. Build order

| Step | Item | Why this order |
|---|---|---|
| 0 | **P1 audit + gold set** (starts now, alongside the rest) | Needs HR time to label; the numbers guide P2 |
| 1 | **P4** remarks / `candidate_actions` | P3, P5 and P6 all write into it |
| 2 | **P6** blacklisting | Small; touches every search path, so do it before more paths are added |
| 3 | **P5** force-upload resume | Small; builds on existing attach |
| 4 | **P2** JD upload + positions | Gives P1 and P3 a position to link to |
| 5 | **P7** Call Insights module | Self-contained; then wire it in |
| 6 | **P3** call upload on the candidate | Thin UI over P7 |
| 7 | **P1** eval run + accuracy report + caching | Run once P2 positions exist; report to HR |

Each step is one small PR with its migration file (rollback block included, **applied by a person**), tests, type check and lint.

---

## 5. Not in this track (from the meeting and the spec)

- Public candidate platform / reach campaign (meeting: later phase; budget question for Nirupam)
- Cloud IVR (meeting task 8: demos first; P3 is designed so IVR is only a new input)
- Connecting Zoho / Google Sheets / Excel trackers via MCP (meeting task 6)
- Candidate shortlist / reject notifications. The meeting wants polite rejections with feedback; the spec says these are sent manually from templates. Planned with §6 notifications.
- Vendor and hiring-manager logins
- Everything in §6

---

## 6. The full specification: what is left, and the plan

The Priority Track is in use, so this is now the working plan. P4, P6 and P7 fold into it: `candidate_actions` is the stage history, the blacklist is the spec's do-not-contact, and `call_analyses` feeds screening.

### 6.1 Where we stand against the spec (checked against the code, 20 Nov 2026)

| Spec part | Built | Left out |
|---|---|---|
| Stage 1 Requisition | Form with all fields, ID, draft, in-plan tick, raised from the sidebar | The last request for the same role, shown on the form |
| Stage 2 Approval | HR Head → Director, backups, no self-approval, approve / reject / send back / hold, phone link, 24 h / 48 h / 72 h | — |
| Stage 3 JD and posting | JD library with versions (`jd-library.ts`) | Job post draft from the JD; channels (career page, portals, referral, consultants) with the date |
| Stage 4 Sourcing | Database search, resume upload and reading, duplicate check ("already in the database") | **Search before source** (A04): "sourcing done" stays locked until the database has been searched |
| Stage 5 Screening | Configurable stages, Call Insights, mandatory remarks | Screening questionnaire (T03), chasers at 24 h / 48 h and the move to "No response" (A08); CTC / notice capture as one screening step |
| Stage 6 Interviews | Scheduling, video link, WhatsApp / email invites, recording, notes | **Scorecards** (blind until submitted; reject needs a comment); reminders 24 h and 2 h before (A10, T06); interview status (done / no-show / cancelled, A12); reschedule and cancel (T07); feedback chasers (A11, T08) |
| Stage 7 Selection | — | Combined scorecard to the hiring manager (A13); select / hold / reject; proposed CTC against the band with the variance |
| Stage 8 Offer | — | Offer approval (HR Head; Director above the band, A14 / A15); salary breakup; letter from a template, with unfilled placeholders blocking it; release by HR (T10); acceptance and chasers (A16, A17, T11) |
| Stage 9 Joining | A "Joined" stage only | Joining date; weekly contact (A18, T12); joined / dropped (A19, A20, T16); reopen the request with a Director alert; close it when filled; hand over to onboarding |
| Roles and permissions | HR access, raisers, approvers | Hiring manager, department head, Director, panel member and recruiter views; CTC hidden from panel members and hiring managers |
| Candidate search | Filters, keyword, meaning, blacklist | Saved searches, last contacted date and filter, "not contacted in 6 months", the spec's status filter |
| Audit log | Insert-only stage history, approvals, config changes, search logs | Exports, CTC edits, merges and permission changes in one log nobody can edit; the monthly export report |
| Consent and retention | Do-not-contact (blacklist), consent tick on calls | Consent flag, date and basis per record; retention periods and the monthly review (A23); removal request |
| Configuration | Stages, approvers, raisers, CTC level, target days | SLA days, **fixed rejection reasons**, sources list, editable email templates |
| Automations | A01, A02, A03 (position opened), A05, A22 | A04, A06–A21, A23, A24 |
| Templates | T01, T04 (candidate), the stage update | T02, T03, T05–T17 |
| Dashboards | A small funnel on the Positions tab | Today, Roles and Funnel views; time to fill / hire; offer acceptance and drop; rejection reasons; Excel export; the monthly pack |
| Integrations | WhatsApp (AiSensy), email, video (LiveKit) | Qandle, calendar, resume intake mailbox, career page form, e-signature, daily health checks |
| Every screen | — | "Last changed by and when"; unsaved forms survive a refresh; a reason when moving backwards |
| HRMS meeting item 5 | — | Standard tracker Excel integration (needs a sample tracker from HR) |

### 6.2 Phase 1: the order to build it in

Each step is one small change with its migration (rollback block, **applied by a person**), tests, type check and lint. The owner approves each step before it starts.

| Step | What | Spec | Needs first |
|---|---|---|---|
| 1 | **Rejection reasons and backward moves.** A fixed list of reasons in Configurations. Picking a reason is required on any Rejected or out-of-the-flow stage, and a reason is required when moving someone back a round. | Common behaviour; A22; report "rejection reasons" | HR's reason list (spec open question 3) |
| 2 | **Interview follow-through.** Status (scheduled / done / no-show / cancelled), reschedule and cancel with the update sent to everyone, reminders 24 h and 2 h before, "mark it" ask after the time passes. | Stage 6; A10, A12; T06, T07 | Two more WhatsApp templates in AiSensy |
| 3 | **Panel scorecards.** Per-round competencies (set in Configurations), ratings, proceed / hold / reject, comment required for reject, **blind until the panel member submits**, chasers at 24 h / 48 h and escalation at 72 h. Panel members open only their assigned candidates and rounds, with no CTC. | Stage 6; screen 10; A11; T08; scenario 12, 20 | **Owner approval: panel-member access (access control)**; the competency list |
| 4 | **Selection.** The combined scorecard to the hiring manager; select / hold / reject; proposed CTC against the request's budget band, with the variance shown. | Stage 7; A13 | Step 3; the salary-unit decision (§6.4) |
| 5 | **Offer.** Offer record with its approvals (same pattern as requisition approvals: HR Head, then Director above the band, no self-approval, phone link), salary breakup, letter from an HR template with a placeholder check, release by HR only after every approval, acceptance and chasers. | Stage 8; A14–A17; T10, T11; scenarios 13–17 | Step 4; HR's offer letter template and CTC bands by grade |
| 6 | **Joining.** Joining date, weekly contact reminder to the recruiter, HR Ops alert 7 days before, joined / dropped with reason; dropped reopens the request and alerts the HR Head and Director; the request closes when all positions are filled; handover note to onboarding. | Stage 9; A18–A20; T12, T13, T16; scenarios 18, 19 | Step 5; where the onboarding handover goes |
| 7 | **Sourcing and screening automations.** Search before source (A04), unscreened reminders (A06, A07), screening questionnaire with chasers and "No response" (A08, T03), shortlist sent to the hiring manager (A09, T09), approval result to the manager (T02), job post channels (Stage 3). | Stages 3–5 | Questionnaire wording from HR; one more template |
| 8 | **Recruitment roles.** Hiring manager (own requests and their candidates, no CTC of employees), department head (own department), Director (dashboards, all requests), recruiter. In a module-only table, following `backend/lib/candidates/access.ts`. | Roles and permissions; scenario 21 | **Owner approval: access control** |
| 9 | **Audit, consent and search.** One append-only log for exports, CTC edits, merges and permission changes, with the monthly export report; consent flag / date / basis; saved searches; last contacted; the status filter. | Audit log; consent; search; scenarios 22–24 | — |
| 10 | **Dashboards and digests.** Today (recruiter), Roles (ageing, A21, T15), Funnel; time to fill / hire, offer rates; Excel export of every view; the daily recruiter digest (T17); SLA days in Configurations. | Reports; screen 12; scenario 25 | Agreed metric definitions from HR |
| 11 | **Acceptance run.** Walk the spec's 27 scenarios with HR on test data; fix and retest any failure. HR Head signs off. | Acceptance criteria | Steps 1–10 |
| — | **Standard tracker Excel integration** (HRMS meeting item 5). Slots in as soon as HR shares the tracker. | — | A sample tracker file and where it lives |

### 6.3 Phase 2 and Phase 3 (unchanged from the spec)

| Phase | Contents |
|---|---|
| Phase 2 | Calendar integration (panel availability) · Qandle write-back on joining · WhatsApp inbound replies · consultant / vendor login · source effectiveness and cost per hire · e-signature on offers · A23 retention review, A24 on-hold chaser · resume intake mailbox and career page form · integration health checks |
| Phase 3 | Candidate self-service portal · portal API resume pull · background verification · assessment tests · referral programme |

### 6.4 Decisions needed before the steps that use them

| Decision | For step |
|---|---|
| The rejection reasons list (spec open question 3) | 1 |
| Competencies per round, and the rating scale | 3 |
| Panel-member access, and later the full recruitment roles (access control, owner approval) | 3, 8 |
| **Salary unit.** Candidate records hold ₹/month in hand; requisitions and the spec use annual CTC. Pick one for selection and offers, or store both. | 4, 5 |
| CTC bands by grade, and the variance above which the Director approves | 4, 5 |
| The offer letter template and the salary breakup structure | 5 |
| Where the joining handover goes (onboarding is a separate module) | 6 |
| Screening questionnaire wording; SLA day defaults; retention periods | 7, 10, Phase 2 |

Design notes:
- New tables keep the `recruitment_` prefix the requisition tables use (`recruitment_offers`, `recruitment_scorecards`, …). The existing `candidate_applications` means a *sourcing record*; a person in a position is `candidate_position_members`.
- Approvals for offers reuse the requisition approval pattern (insert-only rows, backups, no self-approval, phone link, the reminder cron).
- Every candidate-facing message stays a template, sent through the existing outreach checks (blacklist, once per event); offers and rejections are sent by a person.

---

## 7. Open questions for this track

| # | Question | For | Blocks |
|---|---|---|---|
| Q1 | Who labels the P1 gold set, and how many queries (20–30 suggested)? | HR (Roohi / Shwetha) | P1 |
| Q2 | Should must-have skills be a hard filter or a strong boost? (Decide from P1 data) | HR + Tech | P1 |
| Q3 | Is a remark mandatory only for shortlist / reject / hold / blacklist, or for every status change? | HR | P4 |
| Q4 | Who may blacklist, and who may unblacklist? Is the reason list above right? | HR Head | P6 |
| Q5 | Do candidates need to be told the call is recorded (script line / SMS)? How long are recordings kept? | HR + compliance | P3, P7 |
| Q6 | Which languages are calls in? Are recordings from the phone's built-in recorder good enough? | HR | P7 |
| Q7 | Is the OpenAI key used for CRM coaching approved for candidate call audio too? | Tech | P7 |
| Q8 | Does a shortlist belong to a position (needs a candidate-position link) or stay a status on the record, as today? | HR | P2, P4 |
| Q9 | When will the CSV of numbers that failed to go through be shared? Is Shwetha required to fill the standard tracker? (From the meeting) | HR | — |

---

## 8. Working rules

- Small PRs, one per step in §4, from `feat/hr-ats-update` or its sub-branches. No commits or pushes without being asked.
- Migrations are **additive** files with a rollback block, applied by a person. Scripts against real data are **read-only**.
- Existing Candidate Search behaviour, auth and roles are unchanged, except where an item above says so explicitly.
- Every AI step stays advisory and is traced. A prompt change to an existing AI job (`candidate_parse`, `candidate_rank`) needs its own Agent Spec Block.
- Type check, lint and `tests/candidates` must pass on every step; results are reported as they are.
