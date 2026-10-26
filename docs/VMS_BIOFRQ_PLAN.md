# VMS + BioFRQ face verification — plan

Status: **plan only — nothing built.** Agreed with the owner 2026-10-16, revised 2026-10-26.
Each phase stops for approval. The owner applies every migration; no DB writes by the agent.

## Goal

Add face verification to a **testing VMS inside the Tech Team dashboard** so reception can
recognise returning visitors, pre-fill their fixed details and check them out by face.
First-time visitors give consent by a **WhatsApp OTP** before their face is stored.
Host approval moves to a Bolna voice call the host can answer by voice or keypad.

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

**First visit (no face match)**
1. Reception captures photo → BioFRQ identify within `org:<id>` → no match.
2. Reception enters the visitor's mobile → WhatsApp OTP sent, message carries the consent line.
3. Visitor reads the OTP out → reception enters it.
4. OTP correct → consent recorded → face enrolled, `subjectId` saved.
5. Reception fills name, company, purpose, host → send for approval.
6. Visitor declines / OTP wrong 3 times / no WhatsApp → manual check-in, no face stored.

**Return visit (face match)**
1. Capture photo → match → name, mobile, company pre-filled.
2. Reception picks purpose + host → send for approval. No OTP.

**Check-out**
Capture photo → match → find the open visit → check out.

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

### Phase 0 — Security lockdown
Today most `app/api/vms/**` routes use the service-role client with no auth check.

- **Require login + active `property_memberships` for the property (or org admin):**
  visitor list (GET), `propertyId=all` (org admins only), approval PATCH (host or admin only),
  `vms/org/[orgId]`, `properties/[id]/vms-summary`, `organizations/[id]/vms-summary`.
- **Left open for the public kiosk:** check-in POST, photo upload, host list, check-out by visitor ID.
  Add basic guards only (valid property, size limits).
- RLS `OR true` on `visitor_logs` stays for now (kiosk depends on it).
- Verify with `api-route-reviewer` and `rbac-auditor`; test on localhost.

### Phase 1 — Purpose of visit + live status
- New nullable `purpose` column on `visitor_logs` (**migration — owner applies**).
- Purpose picker in the **Tech Team testing VMS only**; existing VMS and kiosk untouched.
- Purpose shown in the visitor list and in host notifications.
- Live status after "Send for approval": Pending → Approved / Rejected / Host not answering.

### Phase 2 — Groundwork (no visible change)
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

### Phase 3 — Face VMS tab in the Tech Team dashboard
New tab in `TechDashboard` with **New visitor (face)** and **Check out (face)**.

- **Check-in:** capture → (liveness if toggle on) → identify within `org:<id>`.
  - Match → pre-fill name / mobile / company; reception picks purpose + host → send.
  - No match → mobile → WhatsApp OTP → reception enters it → consent recorded → enroll → details → send.
  - Declined / OTP failed → manual check-in, no enrollment.
  - BioFRQ down / out of credit → manual form, with a small notice.
- **Check-out:** capture → identify → find the open visit → check out.
- Existing check-in / check-out API routes reused; new server routes for face + OTP actions,
  login + `tech` role required.

### Phase 4 — Host approval by Bolna voice agent
- Call script includes visitor name, company and purpose; host says approve/reject or presses `1#` / `2#`.
- Result arrives at the existing voice webhook, is verified, and updates **only that visit**.
- No answer → one retry → WhatsApp → reception sees "Host not answering".
- **Agent Spec Block** required (docs/AGENT_DOCTRINE.md §3).
- Pre-check: Bolna DTMF works only on Plivo / Twilio lines — confirm `BOLNA_TELEPHONY`.

### Phase 5 — Privacy and retention
- Daily job: delete faces with `last_seen_at` older than 12 months (BioFRQ + our table).
- Admin "Delete face" button for visitor requests.
- Deletion log kept for audit (BioFRQ returns a `deletionId`).

### Phase 6 — Trial, then rollout
- Tech Team, one property, BioFRQ Free plan.
- Record real per-action cost from the BioFRQ usage ledger; estimate monthly cost from visitor volume.
- Rollout to other dashboards is a separate decision after the trial.

## Open checks

- Bolna telephony provider (Plivo / Twilio needed for keypad input).
- Final consent wording (DPDP Act 2023).
- Meta approval of the WhatsApp OTP authentication template.
- Which property the Tech Team trial runs on.
