-- Ticket sorting that learns from the Tech team's judgements (owner 2026-11-19: "with corrections, it must improve the
-- classification accuracy and confidence"). Code: backend/lib/ticketing/sortLearning.ts and sortLearningStore.ts.
-- NOT applied automatically: a person runs this migration in the Supabase SQL Editor, after 20261115000003.
--
--   ticket_sort_examples   one learning example per ticket: a ticket judged right or wrong in Brain → Review → Tickets,
--                          or re-sorted with the Override button. Its words (phone numbers, emails and ids masked, never
--                          who raised it), the right category and team, and, when meaning search is on, its embedding.
--                          A new ticket is shown the most similar examples of its organisation. An example can be
--                          retired (a judgement was undone, or two examples disagreed and a person kept the other).
--   ticket_sort_traces     one row per new ticket while learning is "watch only" or "on": what the old way and the new
--                          way chose, the AI's own rating, the measured confidence and why, and the similar tickets used.
--                          Review → Tickets shows it, the measured confidence is calibrated from it, and the two ways
--                          are compared with it.
--   match_ticket_sort_examples(...)  meaning search over one organisation's examples of one embedding model.
--
-- After applying: run  npx tsx --env-file=.env.local scripts/tickets/build_learning_examples.ts --write
-- once, to turn the judgements and overrides made so far into examples (it only adds rows to the new table).
--
-- Safety:   ADDITIVE ONLY. Two new tables and one new function; no existing table, row or policy is changed.
--           RLS on and NO policies: only the server (service role) reads and writes them, after the Tech-team check.
--           Until this runs, learning stays as before whatever the setting says (the code treats the tables as missing).
-- Safe to re-run.
-- Rollback: DROP FUNCTION IF EXISTS public.match_ticket_sort_examples(uuid, extensions.vector, text, integer);
--           DROP TABLE IF EXISTS public.ticket_sort_traces; DROP TABLE IF EXISTS public.ticket_sort_examples;

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_sort_examples (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id         uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    -- One example per ticket. NULL if the ticket is ever removed; the masked words are kept.
    ticket_id           uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
    ticket_text         text NOT NULL,
    code                text NOT NULL,
    team                text,
    source              text NOT NULL CHECK (source IN ('judged_right', 'judged_wrong', 'override')),
    embedding           extensions.vector(768),
    embedding_model     text,
    retired_at          timestamptz,
    retired_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sort_examples_ticket ON public.ticket_sort_examples (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sort_examples_org ON public.ticket_sort_examples (organization_id, created_at DESC) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_sort_examples_embedding ON public.ticket_sort_examples USING hnsw (embedding extensions.vector_cosine_ops);
ALTER TABLE public.ticket_sort_examples ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ticket_sort_traces (
    ticket_id           uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- 'shadow' = watch only (the old way decided), 'live' = the new way decided
    mode                text NOT NULL CHECK (mode IN ('shadow', 'live')),
    -- How the new way sorted: 'ai' (with similar examples), 'shortcut' (a repeat, no AI), 'failed' (it could not)
    method              text NOT NULL CHECK (method IN ('ai', 'shortcut', 'failed')),
    search              text NOT NULL CHECK (search IN ('words', 'meaning', 'none')),
    old_code            text,
    old_confidence      integer,
    new_code            text,
    -- The AI's own rating in the new way (NULL for a shortcut), and the measured confidence
    model_confidence    integer,
    new_confidence      integer,
    why                 text,
    -- The similar tickets used: [{id, text (masked, short), code, source, strength, by}]
    neighbours          jsonb NOT NULL DEFAULT '[]'::jsonb,
    model               text,
    latency_ms          integer,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_sort_traces_org ON public.ticket_sort_traces (organization_id, created_at DESC);
ALTER TABLE public.ticket_sort_traces ENABLE ROW LEVEL SECURITY;

-- Meaning search: the organisation's examples embedded with the same model, closest first. Cosine similarity, 0 to 1.
CREATE OR REPLACE FUNCTION public.match_ticket_sort_examples(
    p_organization_id uuid,
    p_query_embedding extensions.vector(768),
    p_embedding_model text,
    p_match_count integer DEFAULT 8
)
RETURNS TABLE (id uuid, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT e.id, 1 - (e.embedding <=> p_query_embedding) AS similarity
    FROM public.ticket_sort_examples e
    WHERE e.organization_id = p_organization_id
      AND e.retired_at IS NULL
      AND e.embedding IS NOT NULL
      AND e.embedding_model = p_embedding_model
    ORDER BY e.embedding <=> p_query_embedding, e.id
    LIMIT least(greatest(coalesce(p_match_count, 8), 1), 20);
$$;

-- Only server code (service role) may call it.
REVOKE EXECUTE ON FUNCTION public.match_ticket_sort_examples(uuid, extensions.vector, text, integer) FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
