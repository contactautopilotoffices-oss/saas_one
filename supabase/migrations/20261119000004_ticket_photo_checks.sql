-- The AI reads a ticket's photo (owner 2026-11-19: "link the uploaded image with query raised in the ticket").
-- Code: backend/lib/ticketing/ticketPhoto.ts. NOT applied automatically: a person runs this in the Supabase SQL Editor.
--
--   ticket_photo_checks   one row per ticket whose photo was read: what the photo shows (equipment and problem only,
--                         never people), the category and priority it points to, whether it agrees with the ticket's
--                         category, and what was changed (On only: confidence lowered so it goes to Review, priority
--                         raised). In Watch only, changed stays empty: the row is a record and nothing else.
--
-- Safety:   ADDITIVE ONLY. One new table; nothing existing changes. RLS on, NO policies: only the server reads and writes
--           it. The photo itself is never copied here, only a short description.
-- Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.ticket_photo_checks;

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_photo_checks (
    ticket_id           uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    mode                text NOT NULL CHECK (mode IN ('shadow', 'live')),
    status              text NOT NULL CHECK (status IN ('read', 'unusable', 'failed')),
    description         text,
    photo_code          text,
    photo_priority      text,
    photo_risk          text,
    photo_confidence    integer,
    ticket_code         text,
    ticket_priority     text,
    ticket_confidence   integer,
    agrees              boolean,
    -- What was changed on the ticket (On only): {"confidence":[from,to],"priority":[from,to]}
    changed             jsonb NOT NULL DEFAULT '{}'::jsonb,
    model               text,
    latency_ms          integer,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_photo_checks_org ON public.ticket_photo_checks (organization_id, created_at DESC);
ALTER TABLE public.ticket_photo_checks ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
