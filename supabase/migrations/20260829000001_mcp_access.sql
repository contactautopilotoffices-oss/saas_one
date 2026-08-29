-- ============================================================================
-- MCP ACCESS
-- Per-user, read-only MCP connections. Phase 1: org_super_admin only.
--
-- Guardrail note: queries are scoped to the connection's organization_id,
-- which is captured at issue time and never taken from a tool argument.
-- This is safe for org_super_admin because that role is already entitled to
-- the whole organization in the app. Enabling any narrower role REQUIRES the
-- row-level-security repair first — see MCP_ENDPOINT_V2_DESIGN.md section 2.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mcp_connections (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name             text NOT NULL,
    -- The raw token is shown once at creation and never stored.
    token_hash       text NOT NULL UNIQUE,
    token_prefix     text NOT NULL,              -- first chars, for display only
    role_at_issue    text NOT NULL,              -- role the token was minted against
    scopes           text[] NOT NULL DEFAULT ARRAY['read:all']::text[],
    status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
    expires_at       timestamptz NOT NULL,
    last_used_at     timestamptz,
    use_count        bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz,
    revoked_by       uuid REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_conn_org   ON public.mcp_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_mcp_conn_user  ON public.mcp_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_conn_hash  ON public.mcp_connections(token_hash) WHERE status = 'active';

-- Every tool call is recorded. This is the accountability half of "credible".
CREATE TABLE IF NOT EXISTS public.mcp_audit_log (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id    uuid REFERENCES public.mcp_connections(id) ON DELETE SET NULL,
    organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
    method           text NOT NULL,              -- tools/list | tools/call | initialize
    tool_name        text,
    arguments        jsonb DEFAULT '{}'::jsonb,
    outcome          text NOT NULL CHECK (outcome IN ('ok','denied','error','rate_limited')),
    row_count        integer,
    latency_ms       integer,
    error_message    text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_conn ON public.mcp_audit_log(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_org  ON public.mcp_audit_log(organization_id, created_at DESC);

-- RLS: reuse the org-membership helper added with the OEM scoping fix.
ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['mcp_connections','mcp_audit_log']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "mcp_select_org_member" ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY "mcp_select_org_member" ON public.%I FOR SELECT
             USING (public.oem_is_org_member(organization_id))', t);
        EXECUTE format('DROP POLICY IF EXISTS "mcp_insert_org_member" ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY "mcp_insert_org_member" ON public.%I FOR INSERT
             WITH CHECK (public.oem_is_org_member(organization_id))', t);
        EXECUTE format('DROP POLICY IF EXISTS "mcp_update_org_member" ON public.%I', t);
        EXECUTE format(
            'CREATE POLICY "mcp_update_org_member" ON public.%I FOR UPDATE
             USING (public.oem_is_org_member(organization_id))', t);
    END LOOP;
END $$;

COMMENT ON TABLE public.mcp_connections IS
    'Per-user read-only MCP tokens. Raw token never stored; only its SHA-256 hash.';
