-- Ticket sorting learning + sorting rules: all three database changes, in order.
-- Paste the whole file into the Supabase SQL Editor and press Run. Safe to run more than once.
-- Only adds new tables, one search function, and widens the AI models job list. Nothing existing is changed.

-- ====================================================================================
-- 20261119000001_ticket_sort_learning.sql
-- ====================================================================================
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

-- ====================================================================================
-- 20261119000002_ticket_sort_rules.sql
-- ====================================================================================
-- Ticket sorting rules (owner 2026-11-19: "improve the prompt for learning loop ... like the learning loop for task
-- manager", drafted "daily automatic as well as on button click"). Code: backend/lib/ticketing/sortRules.ts and
-- sortRulesStore.ts. NOT applied automatically: a person runs this in the Supabase SQL Editor, after 20261119000001.
--
--   ticket_sort_rule_versions   every version of an organisation's sorting rules: offered (tested, waiting for a person),
--                               active (used for every new ticket; at most one), retired (replaced or switched off; can
--                               be put back), rejected. With the test that let it be offered and who decided.
--   ticket_sort_rule_runs       every drafting run: daily, the button, or a person's own rules. While "testing" it holds
--                               its progress (state) and a lease so two workers never test the same run. A daily run is
--                               recorded once per India-time day.
--
-- Safety:   ADDITIVE ONLY. Two new tables; nothing existing changes. RLS on, NO policies: only the server (service role)
--           reads and writes them, after the Tech-team check. Until this runs, no rules are used.
-- Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.ticket_sort_rule_versions; DROP TABLE IF EXISTS public.ticket_sort_rule_runs;

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_sort_rule_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    trigger             text NOT NULL CHECK (trigger IN ('daily', 'button', 'person')),
    -- India-time day the run started (one daily run per day)
    day                 date NOT NULL,
    status              text NOT NULL CHECK (status IN ('testing', 'offered', 'not_offered', 'no_change', 'failed')),
    message             text,
    model               text,
    started_by          uuid,
    state               jsonb,
    test                jsonb,
    done                integer NOT NULL DEFAULT 0,
    total               integer NOT NULL DEFAULT 0,
    lease_until         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_sort_rule_runs_org ON public.ticket_sort_rule_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_sort_rule_runs_testing ON public.ticket_sort_rule_runs (status) WHERE status = 'testing';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sort_rule_runs_daily ON public.ticket_sort_rule_runs (organization_id, day) WHERE trigger = 'daily';
ALTER TABLE public.ticket_sort_rule_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ticket_sort_rule_versions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    version             integer NOT NULL,
    status              text NOT NULL CHECK (status IN ('offered', 'active', 'retired', 'rejected')),
    -- What the sorting prompt shows (numbered lines), and each rule with the tickets it came from
    rules_text          text NOT NULL CHECK (char_length(rules_text) <= 2000),
    rules               jsonb NOT NULL DEFAULT '[]'::jsonb,
    summary             text,
    test                jsonb,
    run_id              uuid REFERENCES public.ticket_sort_rule_runs(id) ON DELETE SET NULL,
    source              text NOT NULL CHECK (source IN ('daily', 'button', 'person')),
    model               text,
    created_by          uuid,
    decided_by          uuid,
    decided_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, version)
);
-- At most one version in use per organisation
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sort_rule_versions_active ON public.ticket_sort_rule_versions (organization_id) WHERE status = 'active';
ALTER TABLE public.ticket_sort_rule_versions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ====================================================================================
-- 20261119000003_ai_models_ticket_rules_job.sql
-- ====================================================================================
-- Owner 2026-11-19: ticket sorting rules add one model call (docs/AI_MODELS.md, step 3):
--   ticket_rules_draft : drafts sorting rules from the team's corrections (daily and on the button)
-- It appears on the Tech console's Brain → AI models screen. This lets a choice for it be saved.
-- NOT applied automatically: a person runs this migration.
--
-- Until this runs nothing changes for anyone: the drafting uses its default models, and the screen says the choice could
-- not be saved. Every name that was allowed before (20261116000002) is still allowed.
--
-- Safety:   one CHECK constraint is replaced by a wider one (it accepts everything the old one did). No row, column,
--           table or policy is changed.
-- Safe to re-run.
-- Rollback: delete any rows for the new job, then re-run 20261116000002_ai_models_call_jobs.sql.

BEGIN;

ALTER TABLE public.task_manager_ai_models DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup', 'import_image', 'import_text',
        'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix', 'candidate_suggest', 'candidate_extract',
        'brain_turn',
        'assistant_interpret', 'hr_plan', 'hr_answer', 'wiki_answer', 'document_ocr', 'invoice_text', 'ocr_vision',
        'bill_ocr', 'meter_ocr', 'electricity_explain', 'sop_photo', 'sop_layout',
        'ticket_classify', 'admin_chatbot', 'coaching_feedback', 'mailbox_digest', 'satej_fast', 'satej_smart',
        'council_default',
        'call_transcribe', 'call_analyse',
        'ticket_rules_draft'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;

