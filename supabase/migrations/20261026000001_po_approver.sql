-- PO approvals in the org super admin login.
--
--   po_approver_connections  each approver's OWN Zoho Books link, so an approval made in the FMS is
--                            recorded in Zoho under the person who clicked, not under a shared login.
--                            The refresh token is stored ENCRYPTED (same key and helper as the mailbox
--                            tokens) and is never returned to a browser.
--   po_approval_decisions    append-only: every approve, reject and question, with what Zoho answered.
--
-- RLS is on with no policies: only the service role (the API routes) reads or writes these.
-- Written, not applied: a person runs it.

CREATE TABLE IF NOT EXISTS public.po_approver_connections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    zoho_email          TEXT,                       -- the Zoho account that granted access, as Zoho reports it
    zoho_user_name      TEXT,
    refresh_token_enc   TEXT NOT NULL,              -- aes-256-gcm, never plain
    dc                  TEXT NOT NULL DEFAULT 'in',
    scopes              TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    last_used_at        TIMESTAMPTZ,
    last_error          TEXT,
    connected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);
ALTER TABLE public.po_approver_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.po_approval_decisions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL,                 -- no FK: a log row must never be touched by a cascade
    po_id            UUID,                          -- no FK on purpose: the decision outlives any PO clean-up
    zoho_po_id       TEXT,
    po_number        TEXT,
    vendor_name      TEXT,
    amount           NUMERIC(14,2),
    decision         TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'question', 'refused')),
    reason           TEXT,
    decided_by       UUID,                          -- no FK (SET NULL would edit an append-only row); the name is kept below
    decided_by_name  TEXT,
    zoho_http        INTEGER,
    zoho_message     TEXT,
    zoho_status_after TEXT,                         -- what Zoho said the PO's status was afterwards
    ok               BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_approval_decisions_po ON public.po_approval_decisions (organization_id, po_id, created_at DESC);
ALTER TABLE public.po_approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.po_approval_decisions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_po_approval_decisions_append_only ON public.po_approval_decisions;
CREATE TRIGGER trg_po_approval_decisions_append_only
    BEFORE UPDATE OR DELETE ON public.po_approval_decisions
    FOR EACH ROW EXECUTE FUNCTION public.po_approval_decisions_append_only();
