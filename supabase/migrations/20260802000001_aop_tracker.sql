-- AOP (Annual Operating Plan) Budget-vs-Actual tracker — the internal MIS spend hub.
--
-- This is the table every other spend source is meant to flow INTO over time: electricity
-- billing, petty cash, purchase orders, vendor invoices. Today it is populated by importing
-- AOP-BudgetVsActual.xlsx; the `source` column on aop_entries exists so that a later
-- automated feed can overwrite an imported cell without losing provenance.
--
-- THREE DELIBERATE MODELLING DECISIONS
--
-- 1. aop_sites is its OWN dimension, not properties.
--    The spreadsheet tracks 16 sites; the properties table has 12. The AOP granularity is
--    finer (Rabale splits 2nd/7th floor, Mafatlal splits A/B/C/D wing) and it includes a
--    Delhi site with no property row at all. Forcing these into properties would either
--    lose the floor/wing split or invent fake properties. Instead aop_sites.property_id is
--    a NULLABLE soft link, so sites map to properties where a mapping exists and the MIS
--    stays complete where it does not.
--
-- 2. aop_line_items covers more than cost categories.
--    The sheet's row axis mixes true costs (Electricity, Diesel, Pest Control) with derived
--    metrics (Seat Count, Sqft Area, Per Seat Budget, Per Sqft Cost), a revenue line
--    (Cafe Rent Recd, Electricity Revenue) and roll-ups (TOTAL OPS BUDGET, TOTAL SPEND).
--    `kind` keeps them apart so a "sum of costs" query never accidentally adds Seat Count
--    or double-counts a total.
--
-- 3. SIGN CONVENTION — read this before writing any query.
--    The spreadsheet labels its variance column "Var (Act-Bud)" but does NOT compute that.
--    Check it: Rabale 2nd Floor April budget 1,320,961.56, actual 1,319,544.21, sheet shows
--    +1,417.35 and "Under Budget". Actual minus budget is -1,417.35. The sheet is really
--    computing BUDGET - ACTUAL. So the header is wrong, and their sign means:
--        POSITIVE  = spent less than budget = good (under budget)
--        NEGATIVE  = overspend                = bad  (over budget)
--    We keep the users' semantics (so the UI matches the spreadsheet they already trust)
--    but name the column honestly: `saving` rather than `variance`.

-- ---------------------------------------------------------------------------
-- Site dimension
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aop_sites (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code             text NOT NULL,           -- stable slug, e.g. 'rabale-2nd-floor'
    name             text NOT NULL,           -- display, e.g. 'Rabale – 2nd Floor'
    property_id      uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    city             text,
    is_active        boolean NOT NULL DEFAULT true,
    sort_order       integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT aop_sites_org_code_key UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_aop_sites_org      ON public.aop_sites(organization_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_aop_sites_property ON public.aop_sites(property_id) WHERE property_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Line-item dimension (the sheet's row axis)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aop_line_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code             text NOT NULL,           -- 'electricity', 'seat_count'
    name             text NOT NULL,           -- 'Electricity'
    -- cost    : an OPS spend line that belongs in the ops roll-up
    -- rent    : Rent + CAM to Landlord. Kept apart from 'cost' because the business's own
    --           headline number ("PAN INDIA COST" on the Summary tab) is ops-only. Rent is
    --           a flat Rs 3,00,00,055/month and including it overstates ops spend by ~2x —
    --           verified: ops + rent reproduces the sheet's TOTAL SPEND row exactly, while
    --           ops alone reproduces TOTAL OPS BUDGET exactly.
    -- revenue : money coming back in (Cafe Rent Recd, Electricity Revenue)
    -- metric  : a denominator or descriptor (Seat Count, Sqft Area, Per Seat Budget)
    -- total   : a roll-up the sheet already computed; NEVER include in a SUM of costs
    kind             text NOT NULL DEFAULT 'cost'
                     CHECK (kind IN ('cost', 'rent', 'revenue', 'metric', 'total')),
    unit             text NOT NULL DEFAULT 'INR'
                     CHECK (unit IN ('INR', 'count', 'sqft', 'INR_per_seat', 'INR_per_sqft')),
    -- Where an automated feed should eventually replace manual entry. Nullable = manual only.
    feed_source      text CHECK (feed_source IN ('electricity', 'petty_cash', 'purchase_orders', 'diesel', 'water')),
    sort_order       integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT aop_line_items_org_code_key UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_aop_line_items_org ON public.aop_line_items(organization_id);

-- ---------------------------------------------------------------------------
-- Fact table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aop_entries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    site_id          uuid NOT NULL REFERENCES public.aop_sites(id) ON DELETE CASCADE,
    line_item_id     uuid NOT NULL REFERENCES public.aop_line_items(id) ON DELETE CASCADE,
    period_month     date NOT NULL,           -- always the 1st of the month
    budget           numeric(16,2),
    actual           numeric(16,2),
    -- Positive = under budget (good) FOR COST LINES. See the sign-convention note above.
    --
    -- CAUTION on kind='revenue': the same arithmetic inverts its meaning. A positive saving
    -- on Cafe Rent Recd or Electricity Revenue means we collected LESS than planned, which
    -- is bad. Nothing here can encode that, because the column is shared — so any consumer
    -- that colours or ranks by `saving` must branch on the line item's kind first, or it
    -- will paint a revenue shortfall green.
    saving           numeric(16,2) GENERATED ALWAYS AS (COALESCE(budget,0) - COALESCE(actual,0)) STORED,
    remarks          text,
    source           text NOT NULL DEFAULT 'xlsx_import'
                     CHECK (source IN ('xlsx_import', 'manual', 'electricity', 'petty_cash', 'purchase_orders')),
    -- Import provenance: which sheet/file this cell came from, so a re-import is traceable.
    source_ref       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT aop_entries_unique_cell UNIQUE (site_id, line_item_id, period_month),
    CONSTRAINT aop_entries_month_is_first CHECK (date_trunc('month', period_month) = period_month)
);

CREATE INDEX IF NOT EXISTS idx_aop_entries_org_month  ON public.aop_entries(organization_id, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_aop_entries_site_month ON public.aop_entries(site_id, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_aop_entries_line       ON public.aop_entries(line_item_id, period_month DESC);

-- ---------------------------------------------------------------------------
-- Import warnings — surfaced in the UI rather than swallowed.
--
-- The June sheet's NOIDA SKYMARK column block is headed "May-26 Budget / May-26 Actual",
-- i.e. May's numbers were pasted into the June sheet, and the Summary tab repeats
-- 512,216 for both months. An importer that trusted the sheet NAME would silently file
-- May's figures as June. The importer reads the month from the column HEADER instead and
-- records the disagreement here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aop_import_warnings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    imported_at      timestamptz NOT NULL DEFAULT now(),
    severity         text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error')),
    sheet_name       text,
    site_label       text,
    message          text NOT NULL,
    is_acknowledged  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_aop_import_warnings_org
    ON public.aop_import_warnings(organization_id, imported_at DESC)
    WHERE NOT is_acknowledged;

-- ---------------------------------------------------------------------------
-- Reporting view: one row per site per month, costs only, with the roll-up recomputed
-- from the cost lines rather than trusting the sheet's own TOTAL row.
-- security_invoker keeps RLS applying as the calling user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.aop_site_month_summary
WITH (security_invoker = on) AS
SELECT
    e.organization_id,
    e.site_id,
    s.name              AS site_name,
    s.property_id,
    e.period_month,
    -- Ops only. Matches the workbook's "TOTAL OPS BUDGET" row and the Summary tab's
    -- PAN INDIA COST figure.
    SUM(e.budget) FILTER (WHERE li.kind = 'cost')  AS budget_total,
    SUM(e.actual) FILTER (WHERE li.kind = 'cost')  AS actual_total,
    SUM(e.saving) FILTER (WHERE li.kind = 'cost')  AS saving_total,
    COUNT(*)      FILTER (WHERE li.kind = 'cost' AND e.saving < 0) AS categories_over_budget,
    -- Rent kept separate; ops + rent reproduces the workbook's "TOTAL SPEND (Ops + Rent)".
    SUM(e.budget) FILTER (WHERE li.kind = 'rent')    AS rent_budget,
    SUM(e.actual) FILTER (WHERE li.kind = 'rent')    AS rent_actual,
    SUM(e.actual) FILTER (WHERE li.kind = 'revenue') AS revenue_actual,
    -- Codes are the importer's slugs (lowercase, non-alphanumerics collapsed to '-').
    MAX(e.actual) FILTER (WHERE li.code = 'seat-count') AS seat_count,
    MAX(e.actual) FILTER (WHERE li.code = 'sqft-area')  AS sqft_area
FROM public.aop_entries e
JOIN public.aop_line_items li ON li.id = e.line_item_id
JOIN public.aop_sites      s  ON s.id  = e.site_id
GROUP BY e.organization_id, e.site_id, s.name, s.property_id, e.period_month;

-- ---------------------------------------------------------------------------
-- RLS — the AOP is leadership/finance data: org super admins, master admins, accounts.
--
-- Procurement is deliberately EXCLUDED for now. They drive spend but this table exposes
-- every site's full P&L including per-seat economics and landlord rent. Narrowing is
-- recoverable by adding a role; over-sharing a P&L is not. Add 'purchase_manager' etc. to
-- both role lists below if that call changes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aop_sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_line_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_import_warnings  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_aop_access(target_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = target_org
          AND om.is_active
          AND om.role::text IN ('org_super_admin', 'master_admin', 'accounts')
    ) OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid()
          AND pm.organization_id = target_org
          AND pm.is_active
          AND pm.role::text IN ('org_super_admin', 'master_admin', 'accounts')
    );
$$;

CREATE POLICY "aop access reads sites"        ON public.aop_sites
    FOR SELECT USING (public.has_aop_access(organization_id));
CREATE POLICY "aop access reads line items"   ON public.aop_line_items
    FOR SELECT USING (public.has_aop_access(organization_id));
CREATE POLICY "aop access reads entries"      ON public.aop_entries
    FOR SELECT USING (public.has_aop_access(organization_id));
CREATE POLICY "aop access reads warnings"     ON public.aop_import_warnings
    FOR SELECT USING (public.has_aop_access(organization_id));

-- Writes go through the service role (importer + API routes), which bypasses RLS. No
-- INSERT/UPDATE policies are granted to end users on purpose: the MIS must not be editable
-- straight from the browser.
