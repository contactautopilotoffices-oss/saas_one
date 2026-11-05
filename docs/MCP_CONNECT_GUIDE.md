# Connect Claude to the FMS

The FMS has an MCP server at `https://<your FMS domain>/api/mcp`. When you connect Claude to it,
Claude can **read** what you can see in the FMS, signed in as you. It cannot create, change,
approve or delete anything.

## For users (anyone with an FMS login, clients included)

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name: `Autopilot FMS`. URL: `https://<your FMS domain>/api/mcp`. Leave the OAuth fields empty.
3. Click **Connect**. The FMS login opens. Sign in with your normal FMS account.
4. You will see "Connect Claude to the FMS?". Check it says you go back to `claude.ai`, then click **Allow**.
5. Ask Claude things like "what open tickets do I have at Andheri?" or "which assets are graded P1?".

What Claude sees is exactly what you see when you log in: your organisations and properties only.
If your FMS access is removed, Claude's access stops with it.

**To disconnect:** remove the connector in Claude's settings.

**Claude Code / desktop config:** `claude mcp add --transport http autopilot-fms https://<your FMS domain>/api/mcp`
then sign in when asked.

## For the admin (one-time setup)

1. **Apply the migration** `supabase/migrations/20261105000001_mcp_call_log.sql` (creates the call log).
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
- **Tools:** `whoami`, `find_endpoints`, `fetch_endpoint`, `list_tickets`, `list_assets`,
  `list_crm_leads`, `po_approval_queue`, `my_pending_actions`.

Code: `app/api/mcp/route.ts`, `backend/lib/mcp/`, `app/oauth/consent/page.tsx`,
`app/api/oauth/decision/route.ts`. Tests: `npm run test:mcp`.
