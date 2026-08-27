-- One-click email actions (Approve / Reject straight from the mail body).
--
-- Each token is issued to ONE recipient for ONE action on ONE entity, so the audit
-- trail records who actually clicked rather than "someone with the link".
--
-- Security model:
--   * The raw token is never stored — only its SHA-256. A database leak therefore
--     does not yield usable action links.
--   * Single-use: consumption is an atomic UPDATE ... WHERE consumed_at IS NULL, so
--     a double-click or a replayed link cannot action twice.
--   * Short-lived: expires_at is enforced in the same statement.
--   * The link is a bearer credential — anyone holding it can act as the recipient.
--     That is inherent to one-click email approval and is why tokens are per-recipient,
--     single-use, expiring, and fully logged.
--
-- NOTE on mail scanners: the action route only mutates on POST. Outlook Safe Links,
-- Gmail prefetch and corporate gateways issue GETs, which render a page that
-- auto-submits the POST — so a scanner cannot silently approve anything.

CREATE TABLE IF NOT EXISTS public.email_action_tokens (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash       TEXT NOT NULL UNIQUE,           -- sha256 hex of the raw token
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type      TEXT NOT NULL,                  -- e.g. 'petty_cash_request'
    entity_id        UUID NOT NULL,
    action           TEXT NOT NULL,                  -- e.g. 'approve' | 'reject'
    payload          JSONB NOT NULL DEFAULT '{}'::JSONB,
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ,
    consumed_ip      TEXT,
    result           TEXT,                           -- 'ok' | error message, for forensics
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eat_entity  ON public.email_action_tokens (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_eat_expiry  ON public.email_action_tokens (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_eat_user    ON public.email_action_tokens (user_id, created_at DESC);

-- Service-role only. No policies are defined on purpose: every read/write goes
-- through the API layer with the service key, and nothing client-side may touch
-- these rows.
ALTER TABLE public.email_action_tokens ENABLE ROW LEVEL SECURITY;
