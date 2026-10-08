# Autopilot WhatsApp assistant — AiSensy setup and template pack

Branch: `feat/aisensy-greeting-replies`. Webhook path: `/api/webhooks/aisensy`.

The assistant supports Create Ticket and Book Meeting Room entirely in WhatsApp.
Photos are optional. Captioned photos use their caption as the ticket title;
uncaptioned photos wait for a title. Text-only requests offer Submit Ticket and
Add Photo. Tickets reuse existing classification, assignment, and notifications.

Org super admins and ops super admins see active properties in their organizations.
Property admins see their assigned active properties. Multiple organizations are
supported. One property is selected automatically; multiple properties, rooms,
and slots use numbered choices, five per page, with NEXT/PREVIOUS navigation.
Property access is rechecked on every step and booking confirmation.

Booking flow: property → date → room → available predefined slot → review → confirm.
Times are in IST (Asia/Kolkata). Credits follow the current app rules, with company
membership scoped to the selected property. Availability and credit deduction are
validated in one database transaction. Confirmed booking overlaps are prevented
across both the website and WhatsApp.

## Templates to submit in AiSensy

Use **English (`en`)**, no media header, and no footer for all templates. The main
menu is a generic welcome: submit as **Marketing**. Follow-up templates concern
user-initiated requests: submit as **Utility**, subject to Meta's final category
and approval decision. Approval is not guaranteed. Buttons below are **Quick Reply**
buttons, not URL buttons. Use the button labels exactly; the backend also accepts
matching underscore payloads, such as `create_ticket` and `confirm_booking`.

Create an active **API campaign for each approved template**. Use the template name
as the campaign name unless configuring the overrides below. The campaign API
sends the approved template; it does not send arbitrary message text.

### 1. `fms_whatsapp_menu_v1`

Body:

```text
Hello! Welcome to Autopilot. How can we help you today? Share your request or facility issue here, and we’ll help you get started.

Choose an option below, or reply 1 to Create Ticket or 2 to Book Meeting Room.
```

Buttons, in order: **Create Ticket**, **Book Meeting Room**.
Variables: none.

### 2. `fms_whatsapp_select_v1`

Body:

```text
For your Autopilot {{1}} request, please choose {{2}}:

{{3}}

Reply with the option number shown. Reply NEXT or PREVIOUS for more choices, or CANCEL to stop.
```

Buttons: none. Sample variables, in order:

1. `Create Ticket`
2. `a property`
3. `1. Hub One; 2. Hub Two`

The same template lists properties, rooms, and available slots. Lists are generated
from the selected user's accessible properties and live availability. Reply numbers
refer to the currently displayed page.

### 3. `fms_whatsapp_ticket_title_v1`

Body:

```text
You are creating an Autopilot ticket for {{1}}.

Send a short title describing your issue. You can also send a photo with a caption; the caption will be your ticket title.

A photo is optional. Reply CANCEL to stop.
```

Buttons: none. Sample `{{1}}`: `Hub One`.

### 4. `fms_whatsapp_ticket_photo_choice_v1`

Body:

```text
Your Autopilot ticket for {{1}} is ready to submit.

Title: {{2}}

A photo is optional. Choose Submit Ticket to submit without a photo, or Add Photo to attach one.

You can also reply 1 to submit or 2 to add a photo.
```

Buttons, in order: **Submit Ticket**, **Add Photo**.
Samples: `{{1}}` = `Hub One`; `{{2}}` = `AC is not cooling on the second floor`.

### 5. `fms_whatsapp_ticket_photo_v1`

Body:

```text
You chose to add a photo to your Autopilot ticket for {{1}}.

Send the photo here. If you include a caption, it will replace the ticket title.

You can still submit without a photo by choosing Submit Ticket or replying 1. Reply CANCEL to stop.
```

Button: **Submit Ticket**. Sample `{{1}}`: `Hub One`.

### 6. `fms_whatsapp_booking_date_v1`

Body:

```text
You are booking an Autopilot meeting room at {{1}}.

Choose Today or Tomorrow, or send another date in DD-MM-YYYY format.

You can also reply 1 for Today or 2 for Tomorrow. Booking times will be shown in IST. Reply CANCEL to stop.
```

Buttons, in order: **Today**, **Tomorrow**. Sample `{{1}}`: `Hub One`.

### 7. `fms_whatsapp_booking_review_v1`

Body:

```text
Please review your Autopilot meeting-room booking:

Property: {{1}}
Room: {{2}}
Date: {{3}}
Time: {{4}}
Credits: {{5}}

Choose Confirm Booking to book this slot, or Cancel to stop. You can also reply 1 to confirm.

Availability and credits will be checked again when you confirm.
```

Buttons, in order: **Confirm Booking**, **Cancel**.
Samples, in order:

1. `Hub One`
2. `Boardroom`
3. `2026-10-02`
4. `10:00–11:00 IST`
5. `1 hours required; 2 hours remaining`

### 8. `fms_whatsapp_ticket_created_v1`

Body:

```text
Your Autopilot ticket has been created.

Reference: {{1}}
Property: {{2}}
Title: {{3}}

The request has been processed through our ticket-assignment workflow. Reply MENU to start another request.
```

Buttons: none. Samples: `{{1}}` = `TKT-123456789`; `{{2}}` = `Hub One`;
`{{3}}` = `AC is not cooling on the second floor`.

### 9. `fms_whatsapp_booking_created_v1`

Body:

```text
Your Autopilot meeting-room booking is confirmed.

Reference: {{1}}
Property: {{2}}
Room: {{3}}
Date: {{4}}
Time: {{5}}

Reply MENU to start another request.
```

Buttons: none. Samples, in order:

1. `00000000-0000-4000-8000-000000000100`
2. `Hub One`
3. `Boardroom`
4. `2026-10-02`
5. `10:00–11:00 IST`

### 10. `fms_whatsapp_notice_v1`

Body:

```text
We have an update about your request in the Autopilot WhatsApp assistant:

{{1}}

You can reply MENU to start another request, or CANCEL to stop your current request.
```

Buttons: none. Sample `{{1}}`:
`Your current request has been cancelled. Reply MENU to start again.`

## Deployment steps

1. Apply `supabase/migrations/20261001000001_whatsapp_assistant.sql` to the target
   Supabase database before deploying the code. It depends on the existing company
   credit tables and the existing `deduct_meeting_room_credit` function.
2. Submit the ten templates above and activate their API campaigns after approval.
3. Retain the existing `AISENSY_API_KEY` and optional `AISENSY_API_URL` in Vercel.
   Use the plain webhook URL below; no webhook secret, authentication header, or
   query parameter is required. `AISENSY_WEBHOOK_SECRET` is no longer used.
4. Set `AISENSY_ASSISTANT_ENABLED=true` after the migration and campaigns are ready.
   Ensure `CRON_SECRET` is configured; the retry cron is included in `vercel.json`.
5. Deploy the branch. Test with a registered, approved WhatsApp number with active
   property access. Confirm the first two quick-reply button callbacks are delivered
   to this webhook with their text/payload and a stable, unique message ID.

The endpoint remains:

```text
https://fms-dev-saas-one.vercel.app/api/webhooks/aisensy
```

The inbound webhook is public and does not verify that requests originate from
AiSensy. Registered-user and property access checks still apply, but a caller can
forge a registered sender phone number. `CRON_SECRET` remains required for the
separate recovery cron endpoint.

Optional `AISENSY_ASSISTANT_CAMPAIGNS` overrides **campaign names**, by reply key:

```json
{
  "menu": "fms_whatsapp_menu_v1",
  "select": "fms_whatsapp_select_v1",
  "ticket_title": "fms_whatsapp_ticket_title_v1",
  "ticket_photo_choice": "fms_whatsapp_ticket_photo_choice_v1",
  "ticket_photo": "fms_whatsapp_ticket_photo_v1",
  "booking_date": "fms_whatsapp_booking_date_v1",
  "booking_review": "fms_whatsapp_booking_review_v1",
  "ticket_created": "fms_whatsapp_ticket_created_v1",
  "booking_created": "fms_whatsapp_booking_created_v1",
  "notice": "fms_whatsapp_notice_v1"
}
```

## Delivery and session behavior

The normal path saves the inbound event, acknowledges the webhook, and sends the
reply directly through AiSensy in Next.js `after()`. It does not wait for the old
60-second notification queue. The cron is a recovery path for failed sends or
interrupted workers. API-call durations and inbound event timestamps are logged
without message contents. AiSensy/Meta delivery time still needs live measurement;
this code cannot promise instant provider delivery.

Sessions expire after 20 minutes of inactivity. MENU starts over; CANCEL stops.
Message IDs are deduplicated per sender, and request IDs prevent duplicate tickets
and bookings. Saved outgoing replies are retried up to five times without repeating
submission. An ambiguous provider timeout can still result in a repeated reply:
the campaign API does not expose an idempotency key in the configured integration.

Unregistered/unapproved users can see the greeting but cannot create tickets or
book rooms. Deactivated memberships and inactive/deleted properties are excluded.

If the migration reports existing overlapping confirmed bookings, review and
resolve those rows before applying the exclusion constraint:

```sql
SELECT a.id AS booking_a, b.id AS booking_b, a.meeting_room_id, a.booking_date
FROM public.meeting_room_bookings a
JOIN public.meeting_room_bookings b
  ON a.id < b.id AND a.meeting_room_id = b.meeting_room_id
 AND a.booking_date = b.booking_date
 AND a.start_time < b.end_time AND a.end_time > b.start_time
WHERE a.status = 'confirmed' AND b.status = 'confirmed';
```

## Verification

Use Node.js 22.18+ for the tests (native TypeScript loading).

```bash
npm run test:whatsapp
node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint:sql
```

The database tests apply the real migration in an isolated PostgreSQL-compatible
PGlite database and exercise property scope, booking/credit rollback, overlapping
bookings, request replay, sender leases, and service-only RPC grants. They do not
connect to the production database or send actual WhatsApp messages.


## Permanent delivery failures

Apply `supabase/migrations/20261002000001_whatsapp_assistant_permanent_failures.sql`
before deploying the permanent-failure worker change. This adds one service-only,
lease-protected RPC; it does not alter tickets, bookings, or credits. It can be
reapplied. We only execute migration tests in an isolated local database.

Missing/inactive campaigns, missing API keys and non-transient HTTP client errors
are recorded as failed rather than retried. Later inbound messages can continue,
so sending Hi or MENU can return the menu even after an unavailable action
campaign. Timeouts, rate limits, conflicts and server errors keep the existing
ordered retry behavior. A failed confirmation does not undo a created ticket or
booking, and the durable record remains available for investigation.

The remaining approved templates and active campaigns are required to complete
ticket and booking conversations. API acceptance time is not WhatsApp delivery
time: compare webhook receipt, `[AiSensy] API response`, and worker duration logs
before attributing a delay to backend processing.
