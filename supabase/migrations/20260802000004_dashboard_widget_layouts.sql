-- Per-user dashboard widget layout + usage ranking.
--
-- The ops dashboard is a customizable board: users add, remove, reorder and resize cards,
-- and the layout follows them between sessions and devices. Two tables, because the two
-- things have completely different write patterns — layout changes a few times ever, usage
-- ticks constantly, and mixing them would rewrite the whole layout blob on every click.
--
-- WHY LAYOUT IS JSONB AND NOT A ROW PER WIDGET
-- A board is read and written as a whole: the client always has the complete ordered list,
-- and a partial write is meaningless (positions must stay consistent). One row per board is
-- one round trip, is atomic, and cannot half-apply. The cost is that we cannot query "who
-- uses the electricity widget" from this table — which is exactly what the usage table is
-- for, so nothing is actually lost.

CREATE TABLE IF NOT EXISTS public.dashboard_widget_layouts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Namespaces the layout so a future procurement or property board can reuse this table.
    board            text NOT NULL DEFAULT 'ops',
    -- [{ widget_id, size, position, is_visible, is_pinned }]
    items            jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dashboard_widget_layouts_unique UNIQUE (user_id, organization_id, board),
    CONSTRAINT dashboard_widget_layouts_items_is_array CHECK (jsonb_typeof(items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_lookup
    ON public.dashboard_widget_layouts(user_id, organization_id, board);

-- ---------------------------------------------------------------------------
-- Usage, for the "most-used cards float to the top" behaviour.
--
-- Stored as a running count plus a last-used timestamp rather than an event log: the board
-- only ever needs a ranking, and an append-only log of every card click would be the
-- highest-volume table in the schema within a week for no added value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_widget_usage (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    widget_id        text NOT NULL,
    opens            integer NOT NULL DEFAULT 0,
    last_used_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dashboard_widget_usage_unique UNIQUE (user_id, organization_id, widget_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_usage_rank
    ON public.dashboard_widget_usage(user_id, organization_id, opens DESC);

-- ---------------------------------------------------------------------------
-- Usage score with recency decay.
--
-- A raw open-count ossifies: whatever someone used heavily in their first week outranks
-- everything forever. Halving the weight every 14 days means a card has to stay useful to
-- stay near the top, and an abandoned one sinks on its own without anybody curating it.
--
-- The score is ONLY ever used to order cards the user has never touched. Anything the user
-- has dragged, resized or explicitly added carries is_pinned and is left exactly where they
-- put it — see the anti-jitter note in the layout API route.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_widget_score(opens integer, last_used timestamptz)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT GREATEST(opens, 0)::numeric
         * power(0.5, EXTRACT(EPOCH FROM (now() - last_used)) / (14 * 86400));
$$;

-- ---------------------------------------------------------------------------
-- RLS — a layout is private to its owner. No org-admin override: another admin reading or
-- rewriting your board arrangement is never legitimate, and there is nothing here worth
-- auditing across users.
-- ---------------------------------------------------------------------------
ALTER TABLE public.dashboard_widget_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_widget_usage   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own layout read"   ON public.dashboard_widget_layouts
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own layout insert" ON public.dashboard_widget_layouts
    FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "own layout update" ON public.dashboard_widget_layouts
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own layout delete" ON public.dashboard_widget_layouts
    FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "own usage read"    ON public.dashboard_widget_usage
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own usage insert"  ON public.dashboard_widget_usage
    FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "own usage update"  ON public.dashboard_widget_usage
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
