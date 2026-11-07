# Connect Claude to the FMS

The FMS has an MCP server at `https://<your FMS domain>/api/mcp`. When you connect Claude to it,
Claude can **read** what you can see in the FMS, signed in as you. It can also **create** records
(tickets, HR tickets, ticket comments, CRM leads, notes and activities, tasks, diesel, electricity
and water readings, stock movements, petty cash drafts, meeting room bookings) and **update** one
existing record (close or change a ticket, reassign it, move an HR ticket on, update a CRM lead,
mark a task done), one at a time and only after it shows you a preview and you say yes. There are
no delete tools.

## For users (anyone with an FMS login, clients included)

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name: `Autopilot FMS`. URL: `https://<your FMS domain>/api/mcp`. Leave the OAuth fields empty.
3. Click **Connect**. The FMS login opens. Sign in with your normal FMS account.
4. You will see "Connect Claude to the FMS?". Check it says you go back to `claude.ai`, then click **Allow**.
5. Ask Claude things like "what open tickets do I have at Andheri?", "raise a ticket: the AC on the
   3rd floor is leaking" or "book a room for 6 people tomorrow 3 to 4 pm".

For a ticket or a booking, Claude first shows what it will do ("Book Board Room, tomorrow 15:00 to
16:00, uses 1 hour of credits?"). Nothing happens until you reply yes. The same app rules apply as
always: credits, double bookings, and who may cancel what.

What Claude sees is exactly what you see when you log in: your organisations and properties only.
If your FMS access is removed, Claude's access stops with it.

**To disconnect:** remove the connector in Claude's settings.

**Claude Code / desktop config:** `claude mcp add --transport http autopilot-fms https://<your FMS domain>/api/mcp`
then sign in when asked.

## For the admin (one-time setup)

1. **Apply the migrations, in order:** `supabase/migrations/20261105000001_mcp_call_log.sql` (call log
   and used codes), then `supabase/migrations/20261106000001_mcp_action_limits.sql` (the per-person
   limits and duplicate check). Without the second one, every create action is refused.
2. **Supabase dashboard → Authentication → OAuth Server:**
   - Turn on **OAuth 2.1 server**.
   - Turn on **Dynamic client registration** (Claude registers itself).
   - **Authorization path:** `/oauth/consent`.
3. **Supabase dashboard → Authentication → URL Configuration:** the **Site URL** must be the FMS
   domain (the consent page is Site URL + `/oauth/consent`).
4. **Recommended:** Supabase dashboard → Project Settings → JWT signing keys: use asymmetric keys
   (RS256/ES256), as Supabase advises for OAuth.
5. **Environment (Vercel):** `NEXT_PUBLIC_APP_URL` must be the public FMS URL (already used by the
   app). Optional:
   - `MCP_PUBLIC_ORIGIN` overrides it for the MCP only.
   - `MCP_INTERNAL_ORIGIN` sets where the MCP calls FMS routes (default: the same URL).
   - `MCP_ALLOWED_REDIRECT_HOSTS`: extra assistant hosts allowed on the consent screen, comma
     separated. Default: `claude.ai, claude.com`, plus localhost.
   - `MCP_RATE_LIMIT_PER_MINUTE`: default 60 per user.
6. Deploy, then connect one account and check that `mcp_call_log` gets rows.

## How it works

- **Sign-in:** Supabase Auth's OAuth 2.1 server (public beta). `/.well-known/oauth-protected-resource`
  tells Claude where to sign in. Only tokens issued through this consent screen are accepted. A
  normal browser session token is refused.
- **Same permissions as the app:** each tool calls one of the FMS's own GET routes as you, so the
  route's own role and property checks decide what comes back.
- **Second fence:** any organisation or property id outside your memberships is refused before
  the route is called. A user with no active membership reads nothing.
- **Only some routes:** `backend/lib/mcp/catalog.generated.json` lists the read routes Claude may
  call. It leaves out cron, webhooks, internal, auth and file routes, any route with no visible
  sign-in check, and any GET that looks like it writes or sends messages. After adding routes, run
  `npm run mcp:catalog` and commit the result.
- **Log:** every tool call is written to `mcp_call_log` (who, which tool, which route, result). No
  FMS data is stored in it.
- **Read tools:** `whoami`, `find_endpoints`, `fetch_endpoint` (any catalogued route), and one tool per area:
  - Tickets: `list_tickets`, `ticket_comments`, `list_hr_tickets` (grievances, HR queries)
  - Sites and people: `list_properties`, `list_users`, `property_vendors`, `visitor_summary`, `command_center`
  - Maintenance: `list_assets`, `ppm`, `amc_contracts`, `document_bank`
  - Utilities: `electricity`
  - Purchasing and money: `list_requisitions`, `finance`, `po_details`, `po_approval_queue`, `invoices`, `aop`
  - Sales: `list_crm_leads`, `crm_reports`
  - Work: `my_tasks`, `my_pending_actions`, `find_meeting_rooms`, `my_bookings`

  Related screens share one tool with a `view` (for example `finance` with `purchase_orders`,
  `payment_tracker`, `payments`, `summary`). Every tool goes through the same checks as
  `fetch_endpoint`. Routes the scan leaves out but a person reviewed and allowed are listed, with
  the reason, in `REVIEWED_ROUTES` in `backend/lib/mcp/catalog.ts` (today: `/api/hr/tickets`).
- **Create actions (preview, then confirm):** `create_ticket`, `raise_hr_ticket`, `add_ticket_comment`,
  `create_crm_lead`, `add_crm_note`, `log_crm_activity`, `assign_task`, `record_diesel_reading`,
  `record_electricity_reading`, `record_water_reading`, `record_stock_movement`,
  `draft_petty_cash_request` (saved as a draft only), `book_meeting_room`, `cancel_booking`.
  Each only returns a preview and a one-time code; `confirm_action` carries it out through the
  app's own route as the user. No delete tools.
- **Every action checks the real flow before it prepares anything.** It reads the record and
  applies the same rules as the FMS screen; when the action does not fit, nothing is prepared and
  Claude is given the reason to tell you. For example:
  - bookings: not in the past, at most 14 days ahead, at least 30 minutes, enough credits (shown);
    cancelling only before the booking starts;
  - comments: the preview names the ticket, its status and assignee;
  - HR tickets: confidential or anonymous only through such a category; priority medium, as the form;
  - CRM: no CRM access, no lead; a lead with the same email, phone or company is shown as a possible
    duplicate; notes and activities only on a lead you can see; Lost or Disqualified need a reason
    (saved as a note, as on the lead screen); follow-ups today or later;
  - tasks: only reporting managers and superusers assign to others, and only to people on their
    list; you change your own tasks (managers: their team's);
  - readings: staff only, no future dates; diesel needs closing hours, kWh and diesel level, and
    openings come from the last reading; closing cannot be below opening; an existing reading for
    that day is shown as replaced;
  - stock: staff only; you cannot issue more than is in stock;
  - petty cash: only a property the petty cash screen offers you; saved as a draft.
- **Update actions (preview, then confirm):** one existing record each, only the listed fields:
  - `update_ticket`: follows the ticket screen's flow, checked on the ticket as it is now (who it is
    assigned to, its status, the user's role). "Close" works out the right step:
    - assigned to you and in progress: **complete** it (it closes, or waits for the client's approval
      if the property uses that);
    - not yours, but you are an org or property admin: the preview asks **"FORCE CLOSE this ticket?
      It is assigned to Ramesh, not to you"** and closes only after your yes;
    - you are the client and the work waits for your approval: **approve** it;
    - otherwise nothing is prepared and Claude tells you who can close it.
    Also: start work (assignee), set priority (admins), reject completed work (client, with a note).
    A ticket can be named by its number (TKT-42); the FMS finds it among the tickets you can see,
    and stops if none or several match.
  - `reassign_ticket`: give a service ticket to another staff member at its property. Only
    organisation or property admins.
  - `update_hr_ticket`: start, resolve (with a note), accept the resolution, or reopen. The status is
    checked first (for example, only a resolved ticket can be accepted, and only by the person who
    raised it); the HR route then decides the rest (current handler or HR to resolve).
  - `update_crm_lead`: status, owner, next follow-up date, priority.
  - `update_task_status`: pending, in progress, completed.
  - Claude is told never to guess ids, numbers, names or statuses, to ask when several records
    match, and not to switch to another action (such as a force close) when one is refused unless
    you ask for it. The preview text itself is written by the FMS from the real record.
  - The preview shows "current value -> new value". Just before acting, the record is read again;
    if it changed since the preview (someone else closed or reassigned it), nothing is sent and
    Claude has to prepare a new preview. Updates count towards the same per-person limits.
  - Read one HR ticket with `hr_ticket_details`.
- **Guardrails against bulk inserts and bulk changes** ("create 100 test tickets", "close all my tickets"):
  - one record per action: no tool accepts a list, every request sent holds exactly one record;
  - every record needs its own preview and the user's own yes; each code works once, expires after
    10 minutes and is bound to one user and one connection (signed by the server);
  - per-user limit, all actions together: **10 per hour, 30 per day** by default
    (`MCP_WRITE_LIMIT_PER_HOUR`, `MCP_WRITE_LIMIT_PER_DAY`); the same action with the same details
    within 15 minutes is refused (`MCP_DUPLICATE_WINDOW_MINUTES`), except raising a service ticket,
    which may be repeated (it still counts towards the hourly and daily limits);
  - checked and recorded in one locked database step (`mcp_consume_action`, migration
    `20261106000001_mcp_action_limits.sql`), so many confirmations at once cannot slip past;
  - text length caps and number ranges on every field.
  Optional `MCP_CONFIRM_SECRET` (32+ characters) sets the signing key; otherwise it is derived from
  the service role key.

Code: `app/api/mcp/route.ts`, `backend/lib/mcp/`, `app/oauth/consent/page.tsx`,
`app/api/oauth/decision/route.ts`. Tests: `npm run test:mcp`.
