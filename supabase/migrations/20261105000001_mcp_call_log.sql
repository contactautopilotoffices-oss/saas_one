-- FMS MCP server (/api/mcp): one row per tool call an assistant (e.g. Claude) makes on a
-- signed-in user's behalf. Who, which tool, which FMS route, what happened.
--
--   mcp_call_log   append-only. Arguments are stored without response bodies, so FMS data
--                  itself is never copied into the log.
--
-- RLS is on with no policies: only the service role (the /api/mcp route) reads or writes it.
-- Written, not applied: a person runs it.

CREATE TABLE IF NOT EXISTS public.mcp_call_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,                  -- no FK: a log row must never be touched by a cascade
    client_id     TEXT,                           -- the OAuth client (which assistant connection) that called
    tool          TEXT NOT NULL,
    endpoint      TEXT,                           -- the FMS route called, path only, e.g. /api/tickets
    args          JSONB,                          -- tool arguments as sent (no response data)
    http_status   INTEGER,                        -- status the FMS route returned, when one was called
    ok            BOOLEAN NOT NULL DEFAULT false,
    error         TEXT,                           -- why it was refused or failed
    duration_ms   INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_call_log_user ON public.mcp_call_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_call_log_created ON public.mcp_call_log (created_at DESC);
ALTER TABLE public.mcp_call_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mcp_call_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_mcp_call_log_append_only ON public.mcp_call_log;
CREATE TRIGGER trg_mcp_call_log_append_only
    BEFORE UPDATE OR DELETE ON public.mcp_call_log
    FOR EACH ROW EXECUTE FUNCTION public.mcp_call_log_append_only();
