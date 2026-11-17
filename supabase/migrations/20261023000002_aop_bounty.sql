-- ============================================================================
-- AOP BOUNTY — every AOP line at every site, every month, is something the system must
-- collect: an invoice, a decision, an approval, a payment term, an expected date. A bounty
-- names what is missing, who owes it and by when, and the system keeps asking until it has
-- it. The month is "closed" when no bounty for it is open.
-- ----------------------------------------------------------------------------
-- WHY
--   Today the AOP sheet is filled at month end by chasing people over mail and WhatsApp. The
--   facts needed to fill it already appear in the app one by one (an invoice accepted, a
--   fast-track decided, a PO classified). The bounty turns "what is still missing" into a
--   list with an owner and a clock, instead of a memory in one person's head.
--
-- WHAT A BOUNTY IS NOT
--   It never writes an AOP number itself. It is closed by the fact arriving (an actual on the
--   cell, an invoice accepted, a decision taken) or by its owner answering it ("no spend this
--   month", "vendor bills every 60 days").
--
-- ACCESS: RLS on, no policies. Reads and writes go through API routes on the service role,
-- which admit org super admins, ops super admins, accounts and purchase, never property admins.
-- ============================================================================

-- Who owns a line item (and optionally only at one site). Null line = every line; null site
-- = every site. The most specific row wins. With no row, the bounty kind's default role owns it.
CREATE TABLE IF NOT EXISTS public.aop_line_owners (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    line_item_id     UUID REFERENCES public.aop_line_items(id) ON DELETE CASCADE,
    site_id          UUID REFERENCES public.aop_sites(id) ON DELETE CASCADE,
    owner_user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- purchase | accounts | operations | approver — a role group, resolved to people at ping time.
    owner_role       TEXT CHECK (owner_role IS NULL OR owner_role IN ('purchase','accounts','operations','approver')),
    set_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (owner_user_id IS NOT NULL OR owner_role IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aop_line_owners_cell
    ON public.aop_line_owners (organization_id, COALESCE(line_item_id, '00000000-0000-0000-0000-000000000000'), COALESCE(site_id, '00000000-0000-0000-0000-000000000000'));

-- "When to start scanning": the day of the month the invoice for this cell is normally in by,
-- and the vendor's billing cadence if it is not monthly. Asked once by the bounty, remembered.
CREATE TABLE IF NOT EXISTS public.aop_expected_dates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    site_id           UUID NOT NULL REFERENCES public.aop_sites(id) ON DELETE CASCADE,
    line_item_id      UUID NOT NULL REFERENCES public.aop_line_items(id) ON DELETE CASCADE,
    expected_day      INTEGER CHECK (expected_day IS NULL OR (expected_day BETWEEN 1 AND 31)),
    -- 1 = monthly; 2 = every other month; 3 = quarterly; 0 = not a recurring cost
    cadence_months    INTEGER NOT NULL DEFAULT 1 CHECK (cadence_months BETWEEN 0 AND 12),
    -- The month the cadence counts from (1st of month), so "every 60 days from August" is known.
    cadence_anchor    DATE CHECK (cadence_anchor IS NULL OR date_trunc('month', cadence_anchor) = cadence_anchor),
    vendor_name       TEXT,
    note              TEXT,
    set_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, line_item_id)
);

CREATE TABLE IF NOT EXISTS public.aop_bounties (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_month     DATE NOT NULL CHECK (date_trunc('month', period_month) = period_month),
    -- actual        the month's figure for a site x line (closed when an actual lands or the owner answers)
    -- decision      an invoice that does not agree with its PO needs a person
    -- approval      a fast-track payment is waiting for an approver
    -- mapping       a PO has no site or no Capex/Opex, so it cannot be filed
    -- phone         an approved PO's vendor has no WhatsApp number
    kind             TEXT NOT NULL CHECK (kind IN ('actual','decision','approval','mapping','phone')),
    site_id          UUID REFERENCES public.aop_sites(id) ON DELETE CASCADE,
    line_item_id     UUID REFERENCES public.aop_line_items(id) ON DELETE CASCADE,
    -- The record behind a decision/approval/mapping/phone bounty: invoice id, request id, PO id.
    source_type      TEXT,
    source_id        TEXT,
    title            TEXT NOT NULL,
    detail           TEXT,
    -- Two months of context for the row: [{month, actual}], never a total.
    compare          JSONB NOT NULL DEFAULT '[]'::jsonb,
    owner_role       TEXT NOT NULL CHECK (owner_role IN ('purchase','accounts','operations','approver')),
    owner_user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- waiting: before the expected date, not yet asked. open: asked or past expected. answered: the
    -- owner replied (no spend / will come on). closed: the fact arrived. (overdue is derived from due_at)
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('waiting','open','answered','closed')),
    expected_at      TIMESTAMPTZ,
    due_at           TIMESTAMPTZ NOT NULL,
    ping_count       INTEGER NOT NULL DEFAULT 0,
    last_pinged_at   TIMESTAMPTZ,
    escalated_at     TIMESTAMPTZ,
    answer           JSONB,
    answered_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    answered_at      TIMESTAMPTZ,
    closed_reason    TEXT,
    closed_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One bounty per thing per month, whichever of the keys the kind uses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aop_bounties_key
    ON public.aop_bounties (organization_id, period_month, kind,
        COALESCE(site_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(line_item_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(source_id, ''));
CREATE INDEX IF NOT EXISTS idx_aop_bounties_open ON public.aop_bounties (organization_id, status, due_at) WHERE status IN ('waiting','open');
CREATE INDEX IF NOT EXISTS idx_aop_bounties_month ON public.aop_bounties (organization_id, period_month);

-- Every time someone was asked. Append-only by convention (nothing updates it).
CREATE TABLE IF NOT EXISTS public.aop_bounty_pings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id        UUID NOT NULL REFERENCES public.aop_bounties(id) ON DELETE CASCADE,
    channel          TEXT NOT NULL CHECK (channel IN ('email','bell','whatsapp')),
    recipient_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sent_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- auto = the daily run; manual = someone pressed Ping; escalation = past due, sent one level up
    trigger          TEXT NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto','manual','escalation')),
    ok               BOOLEAN NOT NULL DEFAULT true,
    error            TEXT,
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aop_bounty_pings_bounty ON public.aop_bounty_pings (bounty_id, sent_at DESC);

ALTER TABLE public.aop_line_owners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_expected_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_bounties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aop_bounty_pings   ENABLE ROW LEVEL SECURITY;
