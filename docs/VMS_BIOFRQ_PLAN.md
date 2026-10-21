# VMS + BioFRQ face verification — plan

Status: **plan only — nothing built.** Agreed with the owner 2026-10-16.
Each phase stops for approval. The owner applies every migration; no DB writes by the agent.

## Goal

Add face verification to the **logged-in dashboard VMS** so reception can recognise
returning visitors, pre-fill their details and check them out by face. Host approval
moves to a Bolna voice call the host can answer by voice or keypad.

## Decisions

| Topic | Decision |
|---|---|
| Face provider | BioFRQ, Free plan first; measure real per-action cost before rollout |
| Who operates | A receptionist / VMS user. Visitors never scan themselves |
| Where | Inside `VMSAdminDashboard` — anyone who already has VMS access (Security, Property Admin, MST, Staff dashboards) |
| Public kiosk / QR (`app/kiosk/[propertyId]`) | **Kept unchanged** — in use. No face recognition there (a public face lookup would leak names and phone numbers) |
| Purpose of visit | Logged by reception: Meeting / Interview / Delivery / Vendor work / Personal / Other |
| Liveness | Off by default, per-organisation toggle |
| Face retention | Auto-delete after **12 months** without a visit |
| Host approval | Bolna AI voice agent — spoken "approve/reject" or keypad `1#` / `2#` |
| Security fix | Approved as Phase 0 |

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
- New `purpose` column on `visitor_logs` (**migration — owner applies**).
- Purpose picker in the dashboard check-in form and the public kiosk form.
- Purpose shown in the visitor list and in host notifications.
- Live status after "Send for approval": Pending → Approved / Rejected / Host not answering.

### Phase 2 — BioFRQ groundwork (no visible change)
- `backend/services/BioFrqService.ts` — server-only wrapper: identify, enroll, deleteSubject, liveness.
  Timeouts, retry on 429/503, never blocks check-in.
- New table `visitor_face_profiles` (**migration — owner applies**):
  `id`, `organization_id`, `property_id` (first seen), `biofrq_subject_id`, `external_id`,
  last known `name` / `mobile` / `coming_from`, `last_host_id`, `consent_at`, `consent_by`,
  `last_seen_at`, `created_at`. RLS scoped to organisation.
- Per-organisation settings: `face_recognition_enabled` (default off), `face_liveness_enabled` (default off).
- Camera produces a JPEG copy for BioFRQ; stored photo stays WebP.
- API key read from env `BIOFRQ_API_KEY` server-side only.

### Phase 3 — Face verification in the dashboard VMS
New buttons in `VMSAdminDashboard`: **New visitor (face)** and **Check out (face)**.

- **Check-in:** capture → (liveness if toggle on) → identify within `org:<id>`.
  - Match → pre-fill details; reception picks purpose + host → send.
  - No match → reception enters details, ticks **Consent given** → enroll, save `subjectId`.
  - BioFRQ down / out of credit → normal manual form, with a small notice.
- **Check-out:** capture → identify → find the open visit → check out.
- Existing API routes reused; new server route for face actions, login-required.

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

### Phase 6 — Trial
- One property, BioFRQ Free plan.
- Record real per-action cost from the BioFRQ usage ledger; estimate monthly cost from visitor volume.
- Then roll out.

## Open checks

- Does `TenantDashboard` actually render `VMSAdminDashboard`? (It imports it.) If yes, tenants
  would also see the face screen — confirm that is wanted.
- Bolna telephony provider (Plivo / Twilio needed for keypad input).
- Visitor consent wording (DPDP Act 2023).
