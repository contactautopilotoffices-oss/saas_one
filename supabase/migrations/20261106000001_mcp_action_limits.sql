-- FMS MCP: guardrails for actions an assistant (e.g. Claude) carries out for a user.
--
-- Every action (raise a ticket, book a room, record a reading, ...) is previewed first and only
-- runs when the user confirms it with a one-time code. This adds, in ONE locked step:
--   * the code works once (as before: the nonce is the primary key),
--   * a per-user limit: at most p_hour_limit actions per hour and p_day_limit per day, all kinds
--     together, so "create 100 test tickets" stops at the limit,
--   * no duplicates: the same action with the same details within p_dup_minutes is refused.
-- The per-user advisory lock makes simultaneous confirmations queue, so they cannot slip past
-- the limit together.
--
-- Requires 20261105000001_mcp_call_log.sql. Written, not applied: a person runs it.

ALTER TABLE public.mcp_action_confirmations ADD COLUMN IF NOT EXISTS params_hash TEXT;

-- New action kinds are validated by the application; the old fixed list no longer fits.
ALTER TABLE public.mcp_action_confirmations DROP CONSTRAINT IF EXISTS mcp_action_confirmations_action_check;
ALTER TABLE public.mcp_action_confirmations ADD CONSTRAINT mcp_action_confirmations_action_check
    CHECK (action ~ '^[a-z_]{3,60}$');

CREATE INDEX IF NOT EXISTS idx_mcp_action_confirmations_user_time
    ON public.mcp_action_confirmations (user_id, used_at DESC);

-- Returns 'ok' (recorded, go ahead) or why not: 'used', 'duplicate', 'hour_limit', 'day_limit'.
CREATE OR REPLACE FUNCTION public.mcp_consume_action(
    p_nonce        TEXT,
    p_user         UUID,
    p_action       TEXT,
    p_hash         TEXT,
    p_hour_limit   INTEGER,
    p_day_limit    INTEGER,
    p_dup_minutes  INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_hour INTEGER;
    v_day  INTEGER;
BEGIN
    -- One user's confirmations run one at a time (lock released at the end of the transaction).
    PERFORM pg_advisory_xact_lock(hashtext('mcp_action:' || p_user::text));

    IF EXISTS (SELECT 1 FROM public.mcp_action_confirmations WHERE nonce = p_nonce) THEN
        RETURN 'used';
    END IF;

    IF p_hash IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.mcp_action_confirmations
        WHERE user_id = p_user AND action = p_action AND params_hash = p_hash
          AND used_at > now() - make_interval(mins => p_dup_minutes)
    ) THEN
        RETURN 'duplicate';
    END IF;

    SELECT count(*) FILTER (WHERE used_at > now() - interval '1 hour'),
           count(*) FILTER (WHERE used_at > now() - interval '1 day')
      INTO v_hour, v_day
      FROM public.mcp_action_confirmations
     WHERE user_id = p_user AND used_at > now() - interval '1 day';

    IF v_hour >= p_hour_limit THEN RETURN 'hour_limit'; END IF;
    IF v_day  >= p_day_limit  THEN RETURN 'day_limit';  END IF;

    INSERT INTO public.mcp_action_confirmations (nonce, user_id, action, params_hash)
    VALUES (p_nonce, p_user, p_action, p_hash);
    RETURN 'ok';
END $$;

-- Only the server (service role) may call it.
REVOKE ALL ON FUNCTION public.mcp_consume_action(TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
