# Turning the SaaS into a read-only MCP endpoint

Scope: this endpoint only. No changes to any existing module.

---

## 1. The thing that changes your plan

You asked for **a persistent session with a rotating token, so the server stays connected**.

The MCP spec revision of **2026-07-28 deleted sessions.**

- The `initialize` / `initialized` handshake is retired.
- The `Mcp-Session-Id` header is gone.
- `Last-Event-ID` / SSE resumability is gone. Legacy HTTP+SSE is deprecated with a 12-month offramp.
- Every request now carries its own protocol version, client identity and capabilities in `_meta`.

> "Any request can now land on any server instance behind a plain round-robin load balancer
> without needing shared storage."

**This is good news for you, not bad.** You wanted "always connected and one tool call away."
There is now no connection to keep alive and nothing to reconnect. Every tool call is a standalone
authenticated HTTPS request. On Vercel that is just a serverless function — no session store, no
sticky routing, no keep-alive.

So the requirement splits into two real ones:

| You asked for | What actually delivers it |
|---|---|
| Persistent session | **Delete this.** Stateless requests. Nothing to persist |
| Changing token | **Correct — keep it.** OAuth 2.1: short-lived access token + rotating refresh token |
| Always connected | A durable OAuth *grant*, not a durable connection |
| One tool call away | Latency + a small `tools/list`. Not a session problem |

Two more changes worth knowing:

- **Routable headers.** Requests carry `Mcp-Method` and `Mcp-Name`, so a gateway or WAF can route,
  rate-limit and authorize per tool **without parsing the JSON body**. Useful for us: a read-only
  endpoint can reject anything that is not an allowlisted tool name at the edge.
- **Multi-round-trip requests.** Stateless replacement for elicitation: the server returns
  `resultType: "input_required"` and the client retries with `inputResponses`. We will not need it
  for read-only, but it is why sessions could be dropped.

---

## 2. Two things in the current repo to correct first

**a. What exists today is the opposite direction.** `lib/mcp-client.ts` makes this app an MCP
*client* consuming Supabase's MCP server. The ask is to make it an MCP *server*. Different job;
nothing to reuse.

**b. It authenticates with the service role key.** `lib/mcp-client.ts:12` reads
`SUPABASE_SERVICE_ROLE_KEY` and sends it as both `apikey` and `Bearer`. That key bypasses RLS
entirely. And `app/api/test-mcp/route.ts` is an unauthenticated `GET` that instantiates it. Today it
only lists tools, so exposure is limited — but the service role key must never be anywhere near the
new endpoint. The read-only server gets its own restricted database role.

**c. The SDK is on the old package.** You have `@modelcontextprotocol/sdk@1.26.0`. That monolithic
package tops out at 1.30.0 (published 2026-07-27, one day *before* the new spec). The 2026-07-28
revision ships as split packages: **`@modelcontextprotocol/server@2.0.0`** and
`@modelcontextprotocol/client@2.0.0`, both published 2026-07-28. Build the endpoint on
`@modelcontextprotocol/server@2`. Leave the existing `sdk@1.26.0` dependency alone so nothing else
moves.

---

## 3. What "credible read-only" has to mean

A `readOnlyHint` annotation is a **hint to the model**, not a control. Anyone can call the endpoint
directly. So read-only is enforced in three independent places, and each one alone is sufficient:

| Layer | Control | Why it is separate |
|---|---|---|
| **Database** | A dedicated Postgres role with `SELECT` only. `REVOKE INSERT/UPDATE/DELETE`. RLS on. | Even a total application bug cannot write |
| **Query layer** | Named, parameterised queries only. No free-form SQL tool, ever | Stops read-only-but-everything: joins out of scope, cross-tenant reads |
| **Protocol** | Only read tools registered. `readOnlyHint: true`. Gateway rejects any `Mcp-Name` outside the allowlist | Stops it at the edge, before any code runs |

**The named-query rule is the one that matters most.** A "read-only SQL" tool is still a data
exfiltration tool. This is the same containment pattern already used for agent bundles in
`backend/lib/oem/bundle.ts` — a registry of named, parameterised queries, org scope injected by the
server, never by the caller.

**Tenant isolation comes from the token, never from an argument.** `organization_id` is read from a
validated token claim and injected server-side. If a tool takes an `organization_id` parameter, any
caller can read any org. This is exactly the bug fixed in the bundle guard.

---

## 4. The shape of it

Three routes. That is the whole surface.

```
POST /api/mcp                                  the single stateless MCP endpoint
GET  /.well-known/oauth-protected-resource     RFC 9728 metadata (required by spec)
GET  /api/mcp/health                           liveness, no auth, no data
```

**Request path for every tool call:**

```
1. Verify the bearer token   signature, exp, issuer, and audience == our resource URI
2. Extract claims            organization_id, scopes, subject
3. Check the tool name        against the read-only allowlist (also checkable at the edge via Mcp-Name)
4. Run the named query        as the read-only DB role, org injected from the token
5. Log the call               who, which tool, which args, row count, latency
6. Return                     structured content
```

On a missing or bad token, return `401` with a `WWW-Authenticate` header pointing at the protected
resource metadata. That is how a client discovers where to authenticate.

**Audience validation is not optional.** If the endpoint accepts any valid token from the issuer, a
token minted for a different service works here too. Validate `aud` equals this resource's URI.

---

## 5. Authorization — the part with a real decision in it

Under 2026-07-28 the server is a formal **OAuth 2.1 resource server**. It does not issue tokens. It
validates them. Something else has to be the authorization server.

Also new: **Dynamic Client Registration is deprecated in favour of CIMD** (Client ID Metadata
Documents, SEP-991). Instead of clients POSTing to a registration endpoint, a client hosts a static
JSON document at an HTTPS URL and *that URL is its `client_id`*. DCR still works during the 12-month
window. Plus RFC 9207: the AS returns `iss` and clients must validate it before redeeming a code.

### The decision: who is the authorization server?

| Option | Effort | Trade-off |
|---|---|---|
| **A. Managed AS with MCP support** (Auth0, WorkOS, Stytch, Scalekit) | Low | Costs money. Gets you OAuth 2.1 + PRM + CIMD + rotation correctly, today. **Recommended for "credible"** |
| **B. Build on Supabase Auth** | High | You already have it, but it is not an OAuth 2.1 AS — no PRM, no CIMD, no client registration. You would be writing an AS. Do not |
| **C. Self-host an AS** | High | Only if there is a compliance reason |

**Recommendation: A.** The endpoint is meant to be credible to outside callers. Hand-rolling an
authorization server is the single fastest way to lose that.

### Token lifecycle — your "changing token", done properly

```
Access token    JWT, ~15-60 min, audience-bound to this endpoint, carries org + scopes
Refresh token   long-lived, ROTATED on every use, reuse detection revokes the family
Scopes          read:goals  read:tasks  read:measurements  (one per data area, no write scopes exist)
```

Rotating refresh tokens are what make it "always connected": the caller refreshes silently and never
re-authorises. Reuse detection means a stolen refresh token kills the whole chain on next use.

---

## 6. Build order

| Step | Work | Depends on |
|---|---|---|
| 1 | Create the read-only Postgres role + grants. Verify a write fails | — |
| 2 | Write the named-query registry: tool name → SQL + typed params + scope | 1 |
| 3 | `POST /api/mcp` on `@modelcontextprotocol/server@2`, tools registered read-only, **auth stubbed** | 2 |
| 4 | Test locally with an MCP client. Confirm `tools/list` and one `tools/call` | 3 |
| 5 | Stand up the authorization server (option A). Configure audience + scopes | — |
| 6 | Add token validation + `/.well-known/oauth-protected-resource` + `WWW-Authenticate` | 3, 5 |
| 7 | Audit log table + per-token rate limits | 6 |
| 8 | Edge allowlist on `Mcp-Name`; reject unknown tool names before the function runs | 6 |
| 9 | Red-team it: expired token, wrong audience, another org's id in args, unknown tool, write attempt | all |

Steps 1-4 are useful on their own — a working read-only MCP server on a stubbed auth, testable
locally. Do not expose it publicly until step 6.

**Step 9 is the gate**, not a formality. The endpoint is credible only once a wrong-audience token
and a cross-tenant argument both provably fail.

---

## 7. Questions I need answered

1. **What should it expose?** My assumption: the OEM goal chain — goals, tasks, measurements,
   progress. Not procurement, not CRM, not tickets. Confirm the list, because it defines the whole
   query registry.
2. **Who calls it?** Only your own agents (IRA, Pratiksha)? Your customers? Any MCP client with a
   token? This decides whether CIMD open registration matters at all — if it is only your own
   agents, you can pre-register two clients and skip that complexity entirely.
3. **One tenant or many?** If the endpoint is only ever your own org, tenant isolation is one
   constant. If customers connect, it is the hardest part of the build.
4. **Budget for a managed auth server?** If no, we do steps 1-4 and stop, and it stays internal-only
   behind a static key until there is budget. That is an honest interim, not a failure.
5. **Latency target for "one tool call away"?** Vercel cold start plus query is realistically
   300-800ms. If you need sub-100ms that is a different hosting decision.

---

## 8. Sources

- [The 2026-07-28 Specification — MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [The 2026-07-28 MCP Specification Release Candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [2026-07-28 MCP: stateless, multi-round-trip, routable headers, authorization hardening — 4sysops](https://4sysops.com/archives/2026-07-28-model-context-protocol-mcp-stateless-multi-round-trip-routable-headers-authorization-hardening/)
- [CIMD vs DCR for MCP registration — Auth0](https://auth0.com/blog/cimd-vs-dcr-mcp-registration/)
- [Client ID Metadata: Dynamic Client Registration for MCP OAuth — Scalekit](https://www.scalekit.com/blog/what-is-cimd)
- [Building MCP with OAuth Client ID Metadata (CIMD) — Stytch](https://stytch.com/blog/oauth-client-id-metadata-mcp/)
- [MCP Authentication Explained: OAuth 2.1, DCR & CIMD (2026) — Datawiza](https://www.datawiza.com/blog/mcp-authentication-explained)
