-- Ticket sorting review (owner 2026-11-15): the Tech team checks how the AI sorted a ticket, in Brain → Review → Tickets.
-- NOT applied automatically: a person runs this migration.
--
--   ticket_sort_reviews   one row per ticket the Tech team judged: what the AI (or, when every model failed, the keyword
--                         rules) chose, and whether it was right. When it was wrong, the right category, and whether the
--                         ticket itself was moved to it. The wrong ones are shown to the AI as past corrections when it
--                         sorts the organisation's next tickets (backend/lib/ticketing/aiClassifier.ts), so it learns.
--
-- Privacy: the row keeps the ticket's words with phone numbers, emails and ids masked, and NO column that says who raised
-- the ticket (owner: "i dont want to see who the user is, just their messages").
--
-- Until this runs, tickets are sorted exactly as before (with no past corrections), and the Tickets review says that
-- judging is not available yet.
--
-- Safety:   ADDITIVE ONLY. One new table; no existing table, row or policy is changed.
--           RLS on and NO policies: only the server (service role) reads and writes it, after the Tech-team check.
-- Safe to re-run.
-- Rollback: DROP TABLE public.ticket_sort_reviews;

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_sort_reviews (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- The judged ticket, so it is judged once. NULL if the ticket is ever removed; the masked words are kept.
    ticket_id           uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
    ticket_text         text NOT NULL,
    -- What was chosen when the ticket was sorted
    sorted_by           text NOT NULL CHECK (sorted_by IN ('ai', 'rules')),
    chosen_code         text,
    chosen_team         text,
    chosen_confidence   integer,
    verdict             text NOT NULL CHECK (verdict IN ('right', 'wrong')),
    -- When wrong: the right answer
    right_code          text,
    right_team          text,
    ticket_moved        boolean NOT NULL DEFAULT false,
    -- The Tech reviewer, for the record of who judged. Never the person who raised the ticket.
    reviewed_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ticket_sort_reviews_wrong_has_answer CHECK (verdict = 'right' OR right_code IS NOT NULL)
);
-- One judgement per ticket. (Rows whose ticket is gone have NULL here; NULLs never collide in a unique index.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sort_reviews_ticket ON public.ticket_sort_reviews (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sort_reviews_org ON public.ticket_sort_reviews (organization_id, verdict, created_at DESC);
ALTER TABLE public.ticket_sort_reviews ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
