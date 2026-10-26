# WhatsApp AI pilot: meeting rooms and tickets

Implemented on `feat/whatsapp-llm-interpreter`. This pilot uses the existing AiSensy webhook, assistant queue, account/property access logic, meeting-room transaction RPC and ticket classification/assignment service. It does not give the model database credentials or mutation tools.

## Try the interpreter without creating anything

After deploying the branch and applying its additive migration to your test database, open **Account Settings → WhatsApp (AiSensy) Service → WhatsApp AI** as an approved **Organization Super Admin**. The preview works independently of pilot enablement. Enter a booking or ticket message and click **Preview interpretation**. It shows extracted source phrases and `executed: false`; it never books, creates a ticket or saves a draft.

Example: `Book conference room 1 tomorrow from 2.30 PM to 3 PM`. Preview should return room/date/start/end phrases. An omitted property stays null. The real conversation resolves IDs only from the sender's current app permissions.

## Deployment configuration

The worktree does not contain live Groq/AiSensy credentials. Use your existing server-only Vercel environment variables; do not put keys in client code or template parameters.

```dotenv
GROQ_TASK_CHAT_API_KEY=<your existing dedicated Groq task chat key>
# Optional; default below:
GROQ_TASK_CHAT_MODEL=llama-3.3-70b-versatile
AISENSY_PROJECT_ID=<same project as the incoming webhook>
AISENSY_PROJECT_API_KEY=<existing Project API password>
AISENSY_API_KEY=<existing campaign key>
AISENSY_ASSISTANT_ENABLED=true
# Keep false while configuring, then enable in the test deployment:
WHATSAPP_LLM_INTERPRETER_ENABLED=false
```

The interpreter reads **only `GROQ_TASK_CHAT_API_KEY`**; it never falls back to other Groq keys. Existing ticket classification and Task Manager retain their own current providers. Redeploy after changing Vercel variables. The new pilot does not require `AISENSY_MESSAGE_BOOKING_ENABLED`; non-pilot callers retain that switch's existing behavior.

Apply `supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql` after the existing assistant and message-booking migrations. It adds organization settings, private outgoing reply aliases, `tickets.wa_assistant_completed` to distinguish a fully processed ticket from an interrupted attachment/assignment pipeline, and `wa_assistant_input_hash` to keep committed ticket details immutable during recovery. It does not replace booking/ticket RPCs or migrate existing records. No live database migration was run from this workspace.

In organization settings, choose **Selected users — testing**, search organization users by name, email or phone, and add the accounts you want to test. **Add my account to testing** remains a shortcut. Enable the desired actions and save. Enable `WHATSAPP_LLM_INTERPRETER_ENABLED=true` in the test deployment after the keys, migration and campaigns are ready. Both the global switch and organization enablement must be on; selected-user mode additionally requires the matched account in the saved test selection. Incoming messages must carry the configured AiSensy project ID. Non-pilot senders continue through existing routing.

## Selecting test users and enabling everyone

**Who can use WhatsApp AI** has two saved modes:

- **Selected users — testing**: search all active organization/property members by name, email or phone, then add or remove testers. Pending users or users missing a valid profile phone number are shown but cannot be added. Deleted profiles are excluded. Up to 100 testers can be selected; all-user mode has no tester-list limit.
- **All authorized users — live**: explicitly select this after testing and save. Approved, uniquely matched senders can use only the enabled services in properties they already have access to. Organization enablement, global switches, the AiSensy project check, booking credits, availability and explicit confirmations still apply. Anonymous or ambiguous-number senders gain no access.

Existing settings without a mode remain **selected users** and preserve their selections. Switching to all users preserves that list so you can return to testing. Unavailable selections are shown for removal and cannot be saved in selected-user mode. The picker and settings updates require an approved, active Super Admin membership in the same organization. Both ingress and conversation execution enforce the saved audience mode.

This user-selection update uses the existing JSON settings column; no additional SQL or environment variables are needed. Changing the audience only takes effect after **Save AI settings**. Other organizations retain their own audience and service settings.

## Controlled testing on production

Use the same existing AiSensy project and webhook URL. Do not change Task Manager campaign names, credentials, testing whitelist, cron schedules or notification settings. The branch includes `main` through `26c6ce9` and retains its Task Manager handlers, router and notification logic.

1. Keep `WHATSAPP_LLM_INTERPRETER_ENABLED=false` in Vercel **Production** while preparing. Keep the existing `AISENSY_ASSISTANT_ENABLED` value; enable it before activating this pilot if it is currently false.
2. In the production Supabase SQL Editor, run the complete additive migration **`supabase/migrations/20261005000002_whatsapp_llm_interpreter.sql`** once. It is safe to reapply and does not modify task tables or enable any account. Existing assistant/message-booking and Task Manager migrations must already be installed; do not blindly reapply those earlier migrations.
3. Run **`docs/sql/whatsapp_llm_production_checks.sql`**. Every `ready` result must be true. It only checks schema objects; it does not read user messages, change data or contact providers.
4. After the branch is pushed, reviewed and merged, deploy it with the flag still false. In **Account Settings → WhatsApp (AiSensy) Service → WhatsApp AI**, use **Preview interpretation** first, then enable the organization, choose **Selected users — testing**, and add the desired testers using the user search. Save. UUID entry is no longer required.
5. Set `WHATSAPP_LLM_INTERPRETER_ENABLED=true` in Vercel **Production** and redeploy. In selected-user mode, users outside the test selection retain their existing routing. Keep menu/notice and all current Task Manager/Omnichannel campaigns active.
6. Send HI → Book Meeting Room, supply a real room and future date/time, review, and Confirm Booking. Send HI → Create Ticket, describe the issue, and Submit Ticket. These confirmations create real production records and consume real booking credits. Verify the app records and existing requester notifications.
7. Also send TASKS, DONE 1, TEAM STATUS (with the appropriate manager role) and CANCEL TASKS. Test Task Manager's numbered system choices when it has a pending choice and no facility request. During a pending booking, explicit task commands use the current Task Manager handler and leave the facility draft intact. An unquoted number with both contexts requires clarification. Unknown task-only replies retain Task Manager's existing help response. Old quoted task mutations still ask you to retrieve today's list instead of applying stale task numbering.

The route inspects active task state and pilot drafts without clearing or renewing them; pending pilot events reserve the facility conversation until the worker processes them. A Task Manager execution error cannot advance a facility action. This does not replace Task Manager's existing idempotency or add new natural-language task actions. Disable only `WHATSAPP_LLM_INTERPRETER_ENABLED` to stop the pilot; existing Task Manager routing continues.

Offline verification covers the real Task Manager router/command handlers with isolated data. Live Groq accuracy, provider delivery, production schema readiness and requester notifications still require the above account-restricted production test. No production SQL was executed from this workspace.

## Diagnosing a failed interpretation preview

The approved Org Super Admin preview includes safe diagnostics for a rejected Groq request: the selected model, HTTP status, an allowlisted error code and a locally written explanation. It never returns the provider's raw error message, failed generation, API key or prompt. Normal WhatsApp interpretation retains its existing error response and does not request these diagnostics.

- `401`: verify `GROQ_TASK_CHAT_API_KEY` in the Vercel environment serving this deployment.
- `403`: verify Groq account/project/model access.
- `404`, `model_not_found` or `model_decommissioned`: verify the selected model is available to this account.
- `400` with `json_validate_failed`: the provider could not produce the required JSON; no interpretation was accepted.
- Other `400`/`422` failures: investigate the request format/model parameters.
- `429`: check Groq's account limits and retry after reset.
- `5xx`: retry after the temporary provider failure.

Redeploy after changing Vercel environment variables. An absent `GROQ_TASK_CHAT_MODEL` still selects the existing default, `llama-3.3-70b-versatile`; diagnostics do not switch models, change credentials, add fallback attempts or modify Task Manager. `executed: false` always means the preview did not create a booking or ticket, even when interpretation succeeds. Keep the global pilot disabled while diagnosing failed previews.

## Diagnosing messages that still use the old templates

For each normalized inbound message, Vercel logs include `[WhatsAppInterpreter] Routing decision` with `route: ai` or `route: legacy` and a reason. `llm_disabled` / `assistant_disabled` refer to the environment serving the webhook. `project_not_configured` / `project_mismatch` refer to the configured and inbound AiSensy project. `sender_not_approved_or_not_unique` means the sender could not be linked to exactly one approved app profile; `no_active_properties` means it has no permitted active property. `organization_disabled` means none of the accessible organizations enables the pilot; `sender_not_in_pilot` means an accessible organization enables it but the matched app account is not in its saved allowlist. `eligible` confirms the AI route passed these checks.

These diagnostics do not change routing, grant access or disclose phone numbers, project IDs, account IDs, messages or credentials. If the AI route is eligible but old messages continue arriving, inspect persisted events and other notification sources before changing account permissions.

## Templates and notifications

### Tenant-only WhatsApp booking credits and message formatting

Apply `supabase/migrations/20261006000001_whatsapp_tenant_booking_credits.sql` before deploying the tenant-credit update. It adds a service-role-only `whatsapp_assistant_requires_credits(uuid,uuid)` policy function and replaces both WhatsApp booking RPC definitions. It does not change tables, existing bookings or balances. Reapplying it preserves data. This SQL has only been tested in isolated PGlite databases; it was not run against production here.

The selected property's active tenant, super-tenant and legacy tenant-user roles require credits. A master admin or active organization admin/owner with scope over that property books without tenant credits. A tenant role or admin role in another property/organization does not determine this property's credit policy. Non-tenants skip company-credit lookup and deduction. Tenants use the property's company allocation, or their individual allocation when no company is linked. Missing or insufficient allocation prevents booking. Atomic availability checks, credit deductions and idempotency remain enforced by the database.

The AI follow-ups use WhatsApp bold headings, blank lines, numbered choices, emojis and 12-hour times with IST. Property, room, date and time are shown separately in the review; the credit line appears only for tenants. Ticket review uses the same formatting and retains optional photos. An unclear message after review repeats the exact confirmation instruction; it cannot create a booking. Existing menu and notification campaigns remain in use. Formatted free-form replies do not require new approved templates; existing notice-template fallback keeps its one text parameter.

After applying the migration, this read-only check should return true:

```sql
SELECT to_regprocedure('public.whatsapp_assistant_requires_credits(uuid,uuid)') IS NOT NULL AS tenant_credit_policy_ready;
```

| Message | Delivery |
| --- | --- |
| HI greeting and Create Ticket / Book Meeting Room buttons | Existing `fms_whatsapp_menu_v1` API campaign |
| Property/room choices, missing information, review, corrections and validation | Free-form Project API inside the 24-hour inbound service window |
| Follow-up if that window has closed, or Project API reports a permanent failure | Existing approved `fms_whatsapp_notice_v1` campaign; one parameter with the same factual message |
| Ticket created/assigned | Existing omnichannel `ticket_created` / `ticket_assigned` event configuration and campaigns |
| Meeting room booked | Existing omnichannel `meeting_room_booked` event configuration and campaign |

Keep menu and notice campaigns active. Ensure **requester** delivery is enabled in Omnichannel for ticket creation and meeting-room booking; the interpreter does not send a second completion message. Existing campaign-name overrides in `AISENSY_ASSISTANT_CAMPAIGNS` still apply. Do not disable old campaigns globally: non-pilot users still use the guided template flow.

For ticket photos, set `WHATSAPP_MEDIA_ALLOWED_HOSTS` to a comma-separated list of the **exact HTTPS media hostnames your AiSensy webhooks deliver**. Without it, the two existing documented S3 media-library hostnames are permitted. No wildcard host or arbitrary URL is allowed. Downloads pin a public IPv4 DNS result, reject redirects, allow JPEG/PNG/WebP/GIF, cap bytes at 10 MiB, time out after 10 seconds and decode/recompress with a 20-million-pixel limit before ticket creation. A binary or missing content type is accepted only when bytes have a supported image signature and the image then decodes successfully. If your provider uses a redirecting media URL, use its permitted final media URL integration or continue with a text-only ticket; never allow private hosts.

The ticket review says a photo was received, with verification at submission. A rejected photo cannot be reviewed as attached again until the user replaces it or sends **No Photo**. Check `[WhatsAppInterpreter] Ticket photo rejected` for `hostname`, `stage`, `reason` and `httpStatus`: `host_not_allowed` means configure the exact provider hostname; HTTP 401/403 can indicate authorization or an expired media link; `unsupported_type` means the response is not an accepted image; `decode_failed` means the bytes could not be decoded within the image limits. Logs exclude the raw signed URL and its query tokens.

When an organization uses **All authorized users — live**, the selected test-user list no longer limits access. Phone lookup accepts spaces/hyphens in stored profile numbers but still requires one exact canonical match, an approved account and current property access. A shared phone number is not resolved by choosing a profile. If a sender receives the legacy flow, check `[WhatsAppInterpreter] Routing decision`: account/phone uniqueness, active properties, project matching, the global switches and the saved organization's settings still apply. The HI/menu campaign is intentionally templated even for AI users; receiving that menu alone does not indicate legacy routing.

If Vercel logs are unavailable, open the exact configured AiSensy webhook URL in a browser. The health response for this fix includes `routingVersion: "ticket-photo-submit-v1"`, `assistantEnabled` and `interpreterEnabled`. Both switches must be true; the version marker confirms this code is deployed on that URL, without displaying credentials. This health response does not authenticate a particular sender or inspect their organization settings. In Vercel Logs, include Info logs and filter to `/api/webhooks/aisensy`, then send a fresh message. If no POST reaches that route, check AiSensy's configured webhook URL and deployment domain.

## Live conversation tests

1. Send `HI` and choose **Book Meeting Room**. Send `Book conference room 1 tomorrow from 2.30 PM to 3 PM`. If you have several properties, choose the property by name/number. Confirm the displayed room, date, time and credit summary with **Confirm Booking**. Verify the actual app booking, one credit deduction and your standard notification.
2. Start another booking and send only `3 PM to 4 PM`. The supplied times stay saved while the bot asks for date/room. Change the time, then confirm the updated review. Missing AM/PM, past times, invalid dates and unavailable slots never execute.
3. Send `HI` → **Create Ticket** → `Floor lighting is not working` → **Submit Ticket**. **Submit** also confirms a current ticket review when the context is unambiguous; with competing conversations, use **Submit Ticket** or quote the latest mapped ticket review. Photo is optional. Verify the ticket reference in the standard notification and existing classification/assignment in the app.
4. Repeat with a photo caption describing the issue. A bare photo asks for a description. **Add Photo** requests an attachment; **No Photo** removes it and produces a new review. Unsupported media cannot create a photo-backed ticket.
5. While a booking is pending, send `TASKS` or `DONE 1`. Existing Task Manager handles those explicit commands; the facility draft remains saved. Return with the booking menu option or quote its latest mapped prompt. A bare `yes`, `done` or numbered answer with competing contexts asks clarification. Use **Cancel Tasks** to cancel only Task Manager; **Cancel** cancels a facility request when unambiguous. A task-quoted Cancel also routes to Task Manager.
6. Quote an old/completed prompt, another recipient's message, or an unknown notification. The bot asks you to use the latest prompt. A quoted task completion cannot use today's task numbering from an old digest; send TASKS to get the current list and issue an explicit unquoted command instead.

Drafts expire after 20 minutes of inactivity per workflow. Booking and ticket drafts are separate. Review fingerprints include resolved IDs/date/time; changes in default-today date or singleton room require another review. Successful resources are recovered by stable request IDs on a worker retry; the model cannot create a duplicate resource by proposing an action ID. Stored ticket photos are reused even after a provider URL expires. Once a domain row exists, a correction cannot repurpose that operation ID for another property/issue/room/time; start a new menu request for changed details.

Ticket recovery preserves an existing assignee and escalation progress. An interrupted open, unassigned ticket resumes the existing assignment service using its stored classification.

## Boundaries and verification

This is a menu-led pilot, not automatic intent dispatch for every incoming message. Arbitrary messages do not become tickets. Only booking and ticket details are passed to Groq, with no other users' records, resource lists, phone number or credentials in the prompt. The model proposes source-grounded phrases; backend code asks questions, validates fresh scope and executes existing services only after explicit confirmation. The parser supports explicit AM/PM (including `2.30 PM`) and 24-hour `HH:MM`; it asks again for ambiguous times. Dates currently support today/tomorrow, ISO or DD-MM-YYYY. Optional attendee/comment fields and autonomous Task Manager interpretation are future adapters.

An LLM can misinterpret text; schema validation, source grounding, backend permission checks and exact-action confirmation limit its effects. They do not prove perfect NLP accuracy. Model failure/invalid output asks for clarification and never executes. The plain webhook/account-by-phone association preserves the existing requested integration; project-ID matching is a routing check, not cryptographic authentication of the sender. The new feature does not change that existing trust boundary.

`npm run test:whatsapp` includes both legacy and pilot tests; `npm run test:whatsapp-interpreter` runs the focused pilot suites. Tests cover Groq request/response boundaries, invented fields, cross-workflow fields, access revocation, missing details, photos, review changes, task ambiguity, old quotes, operation recovery, delivery retries, 24-hour windows, media limits, organization API authorization and database RLS. Existing database tests exercise real atomic booking/credit/overlap RPCs in isolated PGlite. Fixtures are offline: live model accuracy, provider-returned ID/context alias matching, template availability, outbox requester settings and delivery latency still need the above Vercel tests.

Vercel logs report `[WhatsAppInterpreter]` workflow/accepted/reason/duration and `[WhatsAppAssistant]` event completion duration. Message bodies, account/property data and Groq credentials are not logged by the interpreter.

## Disable / rollback

Set `WHATSAPP_LLM_INTERPRETER_ENABLED=false` and redeploy to return new messages to the existing routing. Pending pilot events receive a standard pause notice; they do not run as legacy default tickets. Existing resources/outbox events remain intact. The additive migration can remain installed. Do not drop its completion-marker column while this branch is running. No push, merge, deployment or production migration is performed as part of this local implementation.
