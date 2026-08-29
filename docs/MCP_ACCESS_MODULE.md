# MCP Access — module guide

Route `/{orgId}/mcp-access` (sidebar: **MCP Access**, org_super_admin only).
Endpoint `POST /api/mcp`.

## What shipped

| File | Role |
|---|---|
| `supabase/migrations/20260829000001_mcp_access.sql` | `mcp_connections`, `mcp_audit_log`, org-scoped RLS |
| `backend/lib/mcp/roles.ts` | Which roles may hold a connection. **Code constant, not a DB toggle** |
| `backend/lib/mcp/token.ts` | Token generation, SHA-256 hashing, constant-time compare |
| `backend/lib/mcp/registry.ts` | The read-only query registry — the five tools |
| `app/api/mcp/route.ts` | The MCP endpoint. JSON-RPC 2.0, stateless |
| `app/api/mcp-access/connections/route.ts` | Issue / list / revoke, behind session auth |
| `frontend/components/mcp-access/McpAccessPanel.tsx` | The UI |

## Protocol

Stateless per the 2026-07-28 revision: no session, no `Mcp-Session-Id`, no SSE. Every request
carries its own bearer token, so any request can land on any serverless instance.

`initialize` is still answered for clients that have not migrated off the older handshake. It
returns no data and requires no auth, so a client can discover the server and be told how to
authenticate.

Methods: `initialize`, `ping`, `notifications/initialized`, `tools/list`, `tools/call`.

## The six guardrails

1. **No write queries exist.** Read-only is not a flag that can be flipped — the registry contains
   only SELECTs. `readOnlyHint` is advertised, but the guarantee is structural.
2. **No free-form SQL.** Only the five named, parameterised tools. "Read-only SQL" would still be an
   exfiltration tool.
3. **`organization_id` comes from the token.** Never from a tool argument. A call that supplies
   `organization_id` or `org_id` is rejected outright.
4. **Role is re-checked on every call**, against the caller's *current* membership — not the role
   stored at issue time. Demote someone in the app and their MCP access closes on the next call.
5. **No sensitive columns are registered.** Personal contact, salary, disciplinary and medical
   fields are absent from every query, so they cannot be reached however the tool is prompted.
6. **Every call is audited** — who, which tool, which arguments, row count, latency, outcome — and
   rate limited to 60 calls/minute per connection.

Tokens: shown once at creation, stored only as a SHA-256 hash, expiry required (default 90 days,
max 365), max 5 active per user, revocable immediately.

## Why org_super_admin only

Scoping is by `organization_id` from the token. That is safe for org_super_admin because the role is
already entitled to the whole organization in the app — the MCP link grants nothing new.

**It is not safe for any narrower role.** 30 of the repo's RLS policies are
`USING (auth.role() = 'authenticated')` against 11 that scope by membership, so a property admin's
link would return the whole organization. `backend/lib/mcp/roles.ts` is a code constant precisely so
that enabling another role needs a commit and a review, and cannot be switched on from a UI before
the policy repair lands.

## The five tools

| Tool | Returns |
|---|---|
| `list_goals` | Goals with current value, target, progress, expected vs actual rate, data freshness |
| `get_goal_measurements` | The period time series behind one goal's number |
| `list_tasks` | Tasks with status and how completion was proven (system / artifact / claim) |
| `org_progress_summary` | Per-level progress across the five levels |
| `list_agents` | Registered agents, department, status, prompt version |

All capped at 200 rows.

## Connecting a client

Settings → MCP Access → New connection → copy the token (shown once). The UI emits a ready-made
config block:

```json
{
  "mcpServers": {
    "autopilot-offices": {
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer oem_mcp_..." }
    }
  }
}
```

## Not done yet

- **Not tested against a live database.** Types and lint are clean; the migration has not been run.
- Phase 1 issues tokens in-app. A full OAuth 2.1 authorization server with RFC 9728 metadata and
  CIMD is what external customers will need — see `MCP_ENDPOINT_V2_DESIGN.md`.
- Agents deliberately do not use this endpoint; they call the registry in-process.
