-- =============================================================================
-- ORG WIKI — one place to ask questions about purchasing and about how FMS was built.
--
-- The wiki is a set of pages COMPILED BY CODE, not written by a model: one page per
-- vendor, site, repeat-bought item and month of POs, one per month of purchase@ mail,
-- one per development-journal entry, plus an overview and a red-flags page. A rebuild
-- (weekly cron, or the Rebuild button) recomputes every page from the source tables
-- and costs no tokens. A model is used only when someone asks a question, and it
-- answers from the few pages full-text search retrieves, citing them.
--
-- The shape follows Karpathy's "LLM wiki" pattern (raw sources stay untouched; a
-- compiled, interlinked wiki sits between them and the reader; the overview page is
-- the index; good answers are filed back as 'note' pages so questions compound).
-- One deliberate difference: the compiled pages are written by code, not by a model,
-- because they are mostly figures that must be exact and the founder asked that the
-- weekly refresh burn no tokens. Notes are the only pages a person (via a model) writes,
-- and a rebuild never touches them.
--
-- Super admins only (org_super_admin, master_admin): the journal records security
-- findings and the mail pages carry purchase@ snippets. The API guard enforces it;
-- RLS is on with no policies, so only the service role reads these tables.
--
-- Not applied by the agent that wrote it. Apply with the repo's usual script.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.wiki_pages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    slug            text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('overview', 'flags', 'vendor', 'site', 'item', 'month', 'mail', 'dev', 'note')),
    -- 'compiled' pages are rebuilt (and pruned) by the compiler; 'filed' pages are notes
    -- a super admin saved from an answer, and are never rebuilt or pruned.
    origin          text NOT NULL DEFAULT 'compiled' CHECK (origin IN ('compiled', 'filed')),
    filed_by        uuid,
    title           text NOT NULL,
    summary         text,
    body_md         text NOT NULL,
    -- slugs of the pages this one links to
    links           text[] NOT NULL DEFAULT '{}',
    -- what the page was computed from: [{ "table": "zoho_purchase_orders", "rows": 41 }, ...]
    sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
    search          tsvector GENERATED ALWAYS AS (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A')
                     || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
                     || setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
                    ) STORED,
    compiled_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS wiki_pages_search_idx ON public.wiki_pages USING gin (search);
CREATE INDEX IF NOT EXISTS wiki_pages_kind_idx ON public.wiki_pages (organization_id, kind, title);

-- Every question asked, what was retrieved, what was answered and what it cost.
CREATE TABLE IF NOT EXISTS public.wiki_questions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    asked_by        uuid,
    question        text NOT NULL,
    answer          text,
    status          text NOT NULL CHECK (status IN ('answered', 'not_found', 'failed')),
    retrieved       text[] NOT NULL DEFAULT '{}',
    cited           text[] NOT NULL DEFAULT '{}',
    model           text,
    cost_usd        numeric,
    latency_ms      integer,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiki_questions_recent_idx ON public.wiki_questions (organization_id, created_at DESC);

ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_questions ENABLE ROW LEVEL SECURITY;

-- Retrieval. Any word of the question may match (OR, not AND: a natural-language
-- question rarely has every word on one page), ranked by full-text rank with a boost
-- when a page's title appears in the question ("BVG India", "SS Plaza").
CREATE OR REPLACE FUNCTION public.wiki_search(p_org uuid, p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (slug text, kind text, title text, summary text, score real)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    WITH q AS (
        SELECT lower(coalesce(p_query, '')) AS raw,
               nullif(replace(plainto_tsquery('english', coalesce(p_query, ''))::text, ' & ', ' | '), '') AS qt
    ),
    scored AS (
        SELECT p.slug, p.kind, p.title, p.summary,
               (CASE WHEN q.qt IS NULL THEN 0
                     ELSE ts_rank_cd(p.search, to_tsquery('english', q.qt), 32) END)
             + (CASE WHEN length(p.title) >= 3 AND word_similarity(lower(p.title), q.raw) >= 0.5
                     THEN word_similarity(lower(p.title), q.raw) ELSE 0 END) AS score
        FROM public.wiki_pages p, q
        WHERE p.organization_id = p_org
    )
    SELECT slug, kind, title, summary, score::real
    FROM scored
    WHERE score > 0
    ORDER BY score DESC, title
    LIMIT greatest(1, least(coalesce(p_limit, 8), 20))
$$;

REVOKE ALL ON FUNCTION public.wiki_search(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- Agent Console registration, so every rebuild and every question is a traced run.
-- Guarded so this migration also runs where the agent runtime is not applied.
DO $$
BEGIN
    IF to_regclass('public.oem_agents') IS NOT NULL THEN
        INSERT INTO public.oem_agents (organization_id, agent_key, display_name, department, role_description, status)
        SELECT o.id,
               'wiki',
               'Wiki',
               'procurement',
               'Answers questions from the org wiki: pages compiled by code from Zoho POs and line items, '
               || 'the purchase@ digest and the development journal. Answers only from retrieved pages, cites them, '
               || 'and says so when the wiki does not hold the answer. Super admins only.',
               'shadow'
          FROM public.organizations o
        ON CONFLICT (organization_id, agent_key) DO NOTHING;
    END IF;
END $$;
