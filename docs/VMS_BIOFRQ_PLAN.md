# VMS + BioFRQ face verification — plan

Status: **Phases 1–5 built (2026-10-26), not yet run end to end.** Phase 0 (security) dropped for
the testing module by the owner. Phase 6 (trial) is operational. Agreed with the owner 2026-10-16,
revised 2026-10-26. The owner applies every migration; no DB writes by the agent.

## Goal

Add face verification to a **testing VMS inside the Tech Team dashboard** so reception can
recognise returning visitors, pre-fill their fixed details and check them out by face.
First-time visitors give consent by a **WhatsApp OTP** before their face is stored.
Host approval moves to a Bolna voice call the host answers by voice (keypad not built, see Phase 4).

## What was built

| Piece | Where |
|---|---|
| Migrations (owner applies, in order) | `supabase/migrations/20261026000001_vms_face_visits.sql`, `20261026000002_vms_face_phase2.sql` |
| BioFRQ client | `backend/services/BioFrqService.ts` |
| Face, OTP, host call, settings | `backend/lib/vms-face/` |
| API | `app/api/vms-face/**`, `app/api/cron/vms-face-retention` |
| UI | `frontend/components/vms-face/` — tab "VMS Face (Testing)" in `TechDashboard` |
| Voice agent spec block | `docs/vms-face/AGENT_SPEC.md` |
| Voice agent creation (owner runs) | `scripts/vms-face-create-bolna-agent.ts` |
| Tests | `tests/vms-face/hostDecision.test.ts` (`npx tsx --test tests/vms-face/*.test.ts`) |

### Setup checklist (owner)

1. Apply both migrations.
2. Env: `BIOFRQ_API_KEY`. Face recognition stays off until it is set.
3. WhatsApp OTP: once the AiSensy authentication template is approved, set `VMS_FACE_OTP_CAMPAIGN`
   (one variable: the 6-digit code) and switch **Send OTP on WhatsApp** on in *Face Settings*.
   Until then the OTP is shown on the Tech screen and the consent row is flagged `is_test_delivery`.
4. Host call (optional): set `VMS_FACE_BOLNA_WEBHOOK_TOKEN` (long random string) and
   `VMS_FACE_PUBLIC_BASE_URL`, run the script with `--create`, set `VMS_FACE_BOLNA_AGENT_ID`,
   then switch **Call host for approval** on. Optional `VMS_FACE_BOLNA_FROM_NUMBER`.
5. Host WhatsApp fallback (optional): an AiSensy template with 5 variables
   (host name, visitor name, company, purpose, building) as `VMS_FACE_HOST_WA_CAMPAIGN`.
6. Retention cron: add `{ "path": "/api/cron/vms-face-retention", "schedule": "0 21 * * *" }` to
   `vercel.json` (not added by the agent — deployment config).

## Decisions

| Topic | Decision |
|---|---|
| Face provider | BioFRQ, Free plan first; measure real per-action cost before rollout |
| Who operates | A receptionist / VMS user. Visitors never scan themselves |
| Where (testing phase) | **Tech Team dashboard only** (`role === 'tech'` → `TechDashboard`), as its own tab. Face API routes check the `tech` role server-side |
| Existing VMS (`VMSAdminDashboard` in Security / Admin / MST / Staff / Tenant dashboards) | **Unchanged** during testing |
| Public kiosk / QR (`app/kiosk/[propertyId]`) | **Unchanged** — in use. No face recognition there (a public face lookup would leak names and phone numbers) |
| Consent | **WhatsApp OTP** to the visitor's mobile, first visit only. Visitor reads the OTP out; reception types it. No "consent ticked by reception" |
| OTP channel | WhatsApp only (existing Meta WhatsApp integration, authentication template). No SMS for now |
| Return visits | **Face match only** — no OTP |
| Pre-filled on match | **Fixed details only:** name, mobile, coming from (company). Purpose and host are always picked fresh |
| Purpose of visit | Picked by reception every visit: Meeting / Interview / Delivery / Vendor work / Personal / Other |
| Decline / OTP fails | Normal manual check-in, face not stored. Never blocks entry |
| Liveness | Off by default, per-organisation toggle |
| Face retention | Auto-delete after **12 months** without a visit |
| Host approval | Bolna AI voice agent — spoken "approve/reject" or keypad `1#` / `2#` |
| Security fix | Approved as Phase 0 |

## Process flow

**Consent comes before any photo of a new visitor** (owner, 2026-10-26). Reception first asks
"Have you visited before?". Only people who say yes, and so already consented, are scanned straight
away, like DigiYatra, where only enrolled travellers use the face gate.

**Returning visitor** (button *Returning visitor*)
1. Take the photo → BioFRQ searches this organisation's saved faces (all consented).
2. Found → name, mobile, company pre-filled. Reception picks purpose + host → send. No phone number, no OTP.
3. Not found → the photo is discarded and the visitor continues as a new visitor (below).

**First visit** (button *New visitor*)
1. Reception types the mobile. If that mobile already has a saved face, the visitor is verified
   against that one face instead (1:1); no match → manual check-in.
2. Otherwise reception enters name and company → WhatsApp OTP sent; the message carries the consent line.
3. Visitor reads the OTP out → reception enters it → consent verified.
4. **Only now** the photo is taken → face enrolled, `subjectId` saved, consent recorded.
5. Reception picks purpose + host → send for approval.
6. Visitor declines / OTP fails / no WhatsApp → manual check-in; a normal log photo only, nothing sent to BioFRQ.

**Check-out:** reception clicks **Check Out** in the visitor list, or enters the Visitor ID. No face
check-out (removed 2026-10-26: reception can do it in one click, and it would send faces of people
who never consented).

## OTP rules

- 6 digits, valid 5 minutes, max 3 attempts, resend at most once per 30 seconds.
- Only a hash of the OTP is stored, never the code.
- Consent record: mobile, consent text version, timestamp, reception user, OTP verification ID.
- Draft consent text: *"Your Autopilot visitor OTP is 482913. Sharing this code means you agree
  to us storing your face image to speed up future visits. It is deleted after 12 months without
  a visit, or earlier on request."* (Final wording to be checked against DPDP Act 2023.)
- Needs a new WhatsApp **authentication** template approved by Meta before Phase 3.

## BioFRQ facts (from official docs)

- `POST https://api.biofrq.com/v1/face/execute`, header `X-Api-Key`, body `{ action, params }`.
- Actions used: `biofrq.identify`, `biofrq.enroll`, `biofrq.deleteSubject`, `biofrq.liveness`.
- Images: `{ kind: "image", bytes: <base64>, contentType: "image/jpeg" | "image/png" }`. **No WebP.**
- **One gallery per API key** → every face is tagged `groupNames: ["org:<organizationId>"]` and every
  identify passes `predicate.groupNames: ["org:<organizationId>"]`. Never identify without it.
- `externalId` = our own random UUID (no phone/name sent as an ID).
- Delete works **only by `subjectId`** → we must store it.
- Enroll returns `CONFLICT` if the face is already enrolled (dedup) — treat as "known visitor".
- Billing: successful calls billed, including identify with no match. Errors / 429 not billed.
- Retry only `RATE_LIMITED` (429) and `SERVICE_UNAVAILABLE` (503). Branch on `code`, not message.
- Free plan: 2 req/s sustained, burst 10. Per-action prices are not public — read from usage ledger.

Docs: [enroll](https://biofrq.com/docs/api-reference/enroll/) ·
[identify](https://biofrq.com/docs/api-reference/identify/) ·
[delete](https://biofrq.com/docs/api-reference/delete-subject/) ·
[liveness](https://biofrq.com/docs/api-reference/liveness/) ·
[errors](https://biofrq.com/docs/api-reference/errors/) ·
[pricing](https://biofrq.com/pricing/)

## Phases

### Phase 0 — Security lockdown — **dropped for the testing module (owner, 2026-10-26)**
The `vms-face` routes require a login but do not check the `tech` role. Revisit before rollout.
The original item, for the live VMS, is kept below for reference.

Today most `app/api/vms/**` routes use the service-role client with no auth check.

- **Require login + active `property_memberships` for the property (or org admin):**
  visitor list (GET), `propertyId=all` (org admins only), approval PATCH (host or admin only),
  `vms/org/[orgId]`, `properties/[id]/vms-summary`, `organizations/[id]/vms-summary`.
- **Left open for the public kiosk:** check-in POST, photo upload, host list, check-out by visitor ID.
  Add basic guards only (valid property, size limits).
- RLS `OR true` on `visitor_logs` stays for now (kiosk depends on it).
- Verify with `api-route-reviewer` and `rbac-auditor`; test on localhost.

### Phase 1 — Purpose of visit + live status — **built**
- Built on the new table `vms_face_visits.purpose`, not `visitor_logs` (live VMS untouched).
  Host notifications: the host voice call says the purpose.
- New nullable `purpose` column on `visitor_logs` (**migration — owner applies**).
- Purpose picker in the **Tech Team testing VMS only**; existing VMS and kiosk untouched.
- Purpose shown in the visitor list and in host notifications.
- Live status after "Send for approval": Pending → Approved / Rejected / Host not answering.

### Phase 2 — Groundwork (no visible change) — **built**
- As built, tables are `vms_face_settings`, `vms_face_profiles`, `vms_face_otp_challenges`,
  `vms_face_consents`, `vms_face_deletions` (prefix `vms_face_`). RLS on, service role only.
  Settings default: face recognition **on** (the tab exists only for testing), liveness off,
  OTP `screen_test`, host call off.
- `backend/services/BioFrqService.ts` — server-only wrapper: identify, enroll, deleteSubject, liveness.
  Timeouts, retry on 429/503, never blocks check-in.
- New table `visitor_face_profiles` (**migration — owner applies**):
  `id`, `organization_id`, `property_id` (first seen), `biofrq_subject_id`, `external_id`,
  fixed details `name` / `mobile` / `coming_from`, `last_seen_at`, `created_at`. RLS scoped to organisation.
- New table `visitor_face_consents` (**migration — owner applies**):
  `id`, `face_profile_id`, `mobile`, `consent_text_version`, `otp_verification_id`,
  `captured_by` (reception user), `consented_at`.
- New table `visitor_otp_challenges` (**migration — owner applies**):
  `id`, `mobile`, `otp_hash`, `attempts`, `expires_at`, `verified_at`, `created_by`, `created_at`.
- OTP send via the existing WhatsApp service + new authentication template.
- Per-organisation settings: `face_recognition_enabled` (default off), `face_liveness_enabled` (default off).
- Camera produces a JPEG copy for BioFRQ; stored photo stays WebP.
- API key read from env `BIOFRQ_API_KEY` server-side only.

### Phase 3 — Face VMS tab in the Tech Team dashboard — **built**
New tab "VMS Face (Testing)" in `TechDashboard`. Flow as in *Process flow* above.

- Routes: `face/lookup` (mobile → has a saved face or not), `face/verify` (returning visitor: search saved faces, or 1:1 with a mobile), `face/otp`
  (send / verify consent code), `face/enroll` (only with a verified, unused OTP; one face per mobile).
- BioFRQ down / out of credit → manual form, with a small notice.
- No face check-out; check-out stays manual.
- Existing check-in / check-out API routes reused; routes require a login (no `tech` role check — Phase 0 dropped).

### Phase 4 — Host approval by Bolna voice agent — **built (voice only)**
- As built: a **new** Bolna agent with its own webhook `app/api/vms-face/bolna?token=` (not the existing
  voice webhook). The server reads only the agent's fixed final sentence; unclear = never approved.
  Spec block: `docs/vms-face/AGENT_SPEC.md`.
- **Keypad `1#` / `2#` not built:** calls go out on Plivo, but nothing in the repo uses Bolna DTMF and the
  webhook payload has no keypad field to read. Voice only.
- Call script includes visitor name, company and purpose; host says approve/reject or presses `1#` / `2#`.
- Result arrives at the existing voice webhook, is verified, and updates **only that visit**.
- No answer → one retry → WhatsApp → reception sees "Host not answering".
- **Agent Spec Block** required (docs/AGENT_DOCTRINE.md §3).
- Pre-check: Bolna DTMF works only on Plivo / Twilio lines — confirm `BOLNA_TELEPHONY`.

### Phase 5 — Privacy and retention — **built** (cron entry still to be added to `vercel.json`)
- Daily job: delete faces with `last_seen_at` older than 12 months (BioFRQ + our table).
- Admin "Delete face" button for visitor requests.
- Deletion log kept for audit (BioFRQ returns a `deletionId`).

### Phase 6 — Trial, then rollout
- Tech Team, one property, BioFRQ Free plan.
- Record real per-action cost from the BioFRQ usage ledger; estimate monthly cost from visitor volume.
- Rollout to other dashboards is a separate decision after the trial.

## Open checks

- Bolna telephony: Plivo (`BOLNA_TELEPHONY`). Keypad input still unverified on Bolna, so voice only.
- Final consent wording (DPDP Act 2023).
- Meta approval of the WhatsApp OTP authentication template.
- Which property the Tech Team trial runs on.
