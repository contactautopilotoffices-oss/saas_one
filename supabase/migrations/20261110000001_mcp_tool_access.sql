-- FMS MCP: which tools one person may use through a connected assistant (e.g. Claude).
--
-- Set by an organisation super admin on Settings > Claude tools (app/api/mcp/tool-access). One row
-- per person. No row, or mode 'all', means every tool, which is how the MCP behaved before this
-- setting existed. mode 'selected' means only the listed tools (the server always adds whoami,
-- and confirm_action when any create or update tool is listed).
--
-- This only narrows what the assistant can call. Every tool still runs as the person through the
-- app's own routes, so their role and property checks are unchanged.
--
-- RLS is on with no policies: only the server (service role) reads or writes it.
-- Written, not applied: a person runs it.

CREATE TABLE IF NOT EXISTS public.mcp_tool_access (
    user_id         UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,  -- the organisation whose admin last set it
    mode            TEXT NOT NULL DEFAULT 'selected' CHECK (mode IN ('all', 'selected')),
    tools           TEXT[] NOT NULL DEFAULT '{}',                                   -- tool names from backend/lib/mcp/toolCatalog.ts
    updated_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_access_org ON public.mcp_tool_access (organization_id);
ALTER TABLE public.mcp_tool_access ENABLE ROW LEVEL SECURITY;

-- Who changed what, when. Append-only, like mcp_call_log.
CREATE TABLE IF NOT EXISTS public.mcp_tool_access_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,                  -- no FK: a history row must never be touched by a cascade
    organization_id UUID,
    changed_by      UUID,
    before_mode     TEXT,
    before_tools    TEXT[],
    after_mode      TEXT NOT NULL,
    after_tools     TEXT[] NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_access_history_user ON public.mcp_tool_access_history (user_id, created_at DESC);
ALTER TABLE public.mcp_tool_access_history ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_mcp_tool_access_history_append_only ON public.mcp_tool_access_history;
CREATE TRIGGER trg_mcp_tool_access_history_append_only
    BEFORE UPDATE OR DELETE ON public.mcp_tool_access_history
    FOR EACH ROW EXECUTE FUNCTION public.mcp_call_log_append_only();
