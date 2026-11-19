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
