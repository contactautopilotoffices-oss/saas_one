-- Electricity automation — the parts the pipeline was missing: an immutable audit trail,
-- a sender allow-list, a contestable reliability strike, a cycle clock, and a savings
-- target the council member owns.
--
-- Runs AFTER 20260804000005 (payment runs). Everything here is additive.
--
-- FIVE THINGS, and why they belong in one migration: they are the difference between a
-- pipeline that moves a bill and a pipeline somebody can be held to. Four of them
-- (audit, allow-list, contest, per-field confidence) close requirement gaps in
-- SPEC-ELECTRICITY.md. Two of them (cycle clock, savings target) are new requirements
-- from the 03-Aug walkthrough: "this entire cycle from when the electricity bill is
-- recieved to when the bill is paid ... is a run against time and it has to be visible",
-- and "the electricity council memember be provided a target ... lets say 15 lacs to be
-- saved annually from electricity bills alone and he has to run with it".

-- ===========================================================================
-- 1. IMMUTABLE AUDIT TRAIL  (REQ-E-11)
--
-- The spec asks: "Six months from now, can I prove who checked and who approved?"
-- Until now the answer was no — workflow_status was an UPDATE in place, so the checker's
-- identity was overwritten by the next transition and nothing recorded the approver at
-- all. This table is append-only: no UPDATE, no DELETE, enforced by both a revoked grant
-- and a trigger, so a row cannot be quietly rewritten even by a service-role client.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- Every write path (cron, API route, importer, a human in the SQL editor) changes bills.
-- An application-level logger records only the paths someone remembered to instrument.
-- The trigger records all of them, including the ones written after this migration.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.electricity_bill_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    bill_id          uuid NOT NULL REFERENCES public.electricity_bills(id) ON DELETE CASCADE,

    -- 'workflow' | 'payment' | 'dispute' | 'validation' | 'note' | 'ingest'
    event_type       text NOT NULL,
    from_status      text,
    to_status        text,

    -- Who. Nullable because cron and the importer act with no human behind them; when
    -- that happens actor_label carries 'system:electricity-validate' etc. so the trail
    -- never contains an unexplained blank.
    actor_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    actor_label      text,

    note             text,
    metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elec_bill_events_bill
    ON public.electricity_bill_events(bill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_elec_bill_events_org
    ON public.electricity_bill_events(organization_id, created_at DESC);

-- Immutability, belt and braces. The REVOKE stops the ordinary paths; the trigger stops
-- anything that arrives with rights the REVOKE did not anticipate (a future superuser
-- migration, a role change). Deliberately RAISE rather than silently ignoring — FP-04.
-- TRUNCATE is revoked alongside UPDATE/DELETE. It was missed in the first draft and found
-- while verifying the applied schema: service_role retained TRUNCATE, and TRUNCATE does not
-- fire row-level triggers — so the row-level rule below would not have stopped a one-statement
-- wipe. An audit trail that can be truncated is not an audit trail.
REVOKE UPDATE, DELETE, TRUNCATE ON public.electricity_bill_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.electricity_bill_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'electricity_bill_events is append-only (attempted % on id %)',
        TG_OP, COALESCE(OLD.id::text, '?');
END;
$$;

DROP TRIGGER IF EXISTS trg_elec_bill_events_no_update ON public.electricity_bill_events;
CREATE TRIGGER trg_elec_bill_events_no_update
    BEFORE UPDATE OR DELETE ON public.electricity_bill_events
    FOR EACH ROW EXECUTE FUNCTION public.electricity_bill_events_immutable();

-- TRUNCATE needs its own STATEMENT-level trigger; the row-level one above never sees it.
CREATE OR REPLACE FUNCTION public.electricity_bill_events_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'electricity_bill_events is append-only and cannot be truncated';
END;
$$;

DROP TRIGGER IF EXISTS trg_elec_bill_events_no_truncate ON public.electricity_bill_events;
CREATE TRIGGER trg_elec_bill_events_no_truncate
    BEFORE TRUNCATE ON public.electricity_bill_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.electricity_bill_events_no_truncate();

-- ---------------------------------------------------------------------------
-- The recorder. Actor comes from a transaction-local GUC that API routes set
-- (select set_config('app.actor_id', <uid>, true)) — see backend/lib/electricity/audit.ts.
-- When it is absent the row is attributed to a system label instead of a person, which
-- is the honest record for a cron-driven transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.electricity_bills_record_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor_id   uuid;
    v_actor_lbl  text;
BEGIN
    BEGIN
        v_actor_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
    EXCEPTION WHEN others THEN
        v_actor_id := NULL;
    END;
    v_actor_lbl := NULLIF(current_setting('app.actor_label', true), '');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.electricity_bill_events
            (organization_id, bill_id, event_type, from_status, to_status, actor_id, actor_label, note)
        VALUES (NEW.organization_id, NEW.id, 'ingest', NULL, NEW.workflow_status,
                v_actor_id, COALESCE(v_actor_lbl, 'system:import'),
                'Bill record created (source ' || COALESCE(NEW.source, '?') || ')');
        RETURN NEW;
    END IF;

    IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
        INSERT INTO public.electricity_bill_events
            (organization_id, bill_id, event_type, from_status, to_status, actor_id, actor_label)
        VALUES (NEW.organization_id, NEW.id, 'workflow', OLD.workflow_status, NEW.workflow_status,
                v_actor_id, COALESCE(v_actor_lbl, 'system:pipeline'));
    END IF;

    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
        INSERT INTO public.electricity_bill_events
            (organization_id, bill_id, event_type, from_status, to_status, actor_id, actor_label, metadata)
        VALUES (NEW.organization_id, NEW.id, 'payment', OLD.payment_status, NEW.payment_status,
                v_actor_id, COALESCE(v_actor_lbl, 'system:pipeline'),
                jsonb_build_object('paid_amount', NEW.paid_amount, 'payment_date', NEW.payment_date));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elec_bills_record_event ON public.electricity_bills;
CREATE TRIGGER trg_elec_bills_record_event
    AFTER INSERT OR UPDATE ON public.electricity_bills
    FOR EACH ROW EXECUTE FUNCTION public.electricity_bills_record_event();

-- ---------------------------------------------------------------------------
-- Transitioning a bill WITH an actor attached.
--
-- PostgREST runs every call in its own transaction, so a client cannot set the actor GUC
-- in one request and have the next request's trigger see it. This function does both in
-- one transaction: stamp the actor transaction-locally, then update. Application code
-- goes through backend/lib/electricity/audit.ts -> transitionBill().
--
-- A direct UPDATE still works and is still recorded — it just lands attributed to
-- 'system:pipeline' instead of a person, which is the truthful record for a cron.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.electricity_transition_bill(
    p_bill_id      uuid,
    p_to_status    text,
    p_actor_id     uuid  DEFAULT NULL,
    p_actor_label  text  DEFAULT NULL,
    p_note         text  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_org  uuid;
    v_from text;
BEGIN
    SELECT organization_id, workflow_status INTO v_org, v_from
    FROM public.electricity_bills WHERE id = p_bill_id;

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'electricity_transition_bill: no bill %', p_bill_id;
    END IF;

    PERFORM set_config('app.actor_id',    COALESCE(p_actor_id::text, ''), true);
    PERFORM set_config('app.actor_label', COALESCE(p_actor_label, ''),    true);

    UPDATE public.electricity_bills
    SET workflow_status = p_to_status,
        cycle_completed_at = CASE
            WHEN p_to_status = 'paid' AND cycle_completed_at IS NULL THEN now()
            ELSE cycle_completed_at END,
        updated_at = now()
    WHERE id = p_bill_id;

    -- The status change itself is recorded by the AFTER trigger. A supplied note is a
    -- second, explicitly human row so the reason survives next to the transition.
    IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
        INSERT INTO public.electricity_bill_events
            (organization_id, bill_id, event_type, from_status, to_status,
             actor_id, actor_label, note)
        VALUES (v_org, p_bill_id, 'note', v_from, p_to_status,
                p_actor_id, p_actor_label, p_note);
    END IF;
END;
$$;

-- ===========================================================================
-- 2. SENDER ALLOW-LIST  (REQ-E-01)
--
-- Spec: "Sender allow-list: mail from an unrecognised sender is quarantined, never
-- auto-processed. Utility bill mail is a high-value phishing target and this inbox will
-- eventually touch payment amounts." A forged bill PDF that reaches the parser unchecked
-- becomes a payment instruction with a stranger's account number on it.
--
-- Match is on lower(from_address): exact address, or '@domain.com' suffix.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.electricity_sender_allowlist (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- 'billing@adani.com' (exact) or '@bescom.co.in' (whole domain)
    pattern          text NOT NULL,
    label            text,                      -- 'Adani Electricity Mumbai'
    is_active        boolean NOT NULL DEFAULT true,
    created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT elec_sender_allowlist_unique UNIQUE (organization_id, pattern)
);

CREATE INDEX IF NOT EXISTS idx_elec_sender_allowlist_org
    ON public.electricity_sender_allowlist(organization_id) WHERE is_active;

-- Quarantine state on the document. 'quarantined' rows are stored and shown in the Inbox
-- but never parsed and never forwarded, until a human releases them.
ALTER TABLE public.electricity_bill_documents
    ADD COLUMN IF NOT EXISTS sender_status text NOT NULL DEFAULT 'allowed'
        CHECK (sender_status IN ('allowed', 'quarantined', 'released')),
    ADD COLUMN IF NOT EXISTS quarantine_reason text,
    ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS released_at timestamptz,
    -- 3. PER-FIELD OCR CONFIDENCE (REQ-E-02). The spec is explicit that one number per
    -- document is the wrong shape: "A bill where the amount is crisp but the meter
    -- reading is smudged is not '90% confident' — it is confident about one thing and
    -- guessing about another." {"total_amount": 95, "due_date": 40, ...}
    ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Denormalised so the Inbox can sort and flag without unpacking jsonb per row.
    ADD COLUMN IF NOT EXISTS lowest_confidence_field text,
    ADD COLUMN IF NOT EXISTS lowest_confidence numeric(5,2),
    -- Set when any field falls below the review threshold: the doc must not auto-advance.
    ADD COLUMN IF NOT EXISTS needs_field_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_elec_bill_documents_quarantine
    ON public.electricity_bill_documents(organization_id, sender_status)
    WHERE sender_status = 'quarantined';

CREATE INDEX IF NOT EXISTS idx_elec_bill_documents_field_review
    ON public.electricity_bill_documents(organization_id)
    WHERE needs_field_review;

-- ===========================================================================
-- 4. CONTESTABLE STRIKE  (REQ-E-06)
--
-- Spec condition 2 of 4: "A strike is contestable. If someone was on leave, or the site
-- had no power, or the task was assigned to the wrong person, there must be a way to say
-- so and have the strike removed."
--
-- An overturned strike is NOT deleted — the contest and its outcome are part of the
-- record. employee_reliability_scores must exclude overturned events; the view is
-- replaced below to do exactly that.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.employee_reliability_contests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    event_id          uuid NOT NULL REFERENCES public.employee_reliability_events(id) ON DELETE CASCADE,
    -- Denormalised so a user can list their own contests without joining events.
    user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    reason            text NOT NULL,            -- free text, the employee's account
    attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,

    status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'upheld', 'overturned')),
    reviewed_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at       timestamptz,
    resolution_note   text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    -- One open contest per event; re-contesting a decided strike needs a new decision,
    -- not a second parallel case.
    CONSTRAINT employee_reliability_contests_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_reliability_contests_user
    ON public.employee_reliability_contests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reliability_contests_open
    ON public.employee_reliability_contests(organization_id) WHERE status = 'open';

-- Mark the event itself so score maths can exclude it with no join.
ALTER TABLE public.employee_reliability_events
    ADD COLUMN IF NOT EXISTS is_overturned boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS overturned_at timestamptz;

-- Score view, re-stated to honour overturned strikes.
--
-- DROP-then-CREATE rather than CREATE OR REPLACE: replacing a view requires the existing
-- column list in the existing ORDER, and 20260804000004 declared (user_id,
-- organization_id, …). Adding overturned_count is legal, but any future reordering would
-- fail on apply with a confusing "cannot change name of view column" error. Dropping first
-- makes this migration re-runnable and order-independent. Nothing else depends on the view.
DROP VIEW IF EXISTS public.employee_reliability_scores;

CREATE VIEW public.employee_reliability_scores
WITH (security_invoker = on) AS
SELECT
    e.user_id,
    e.organization_id,
    GREATEST(0, 100 - COALESCE(SUM(e.points) FILTER (
        WHERE e.kind IN ('default', 'strike')
          AND NOT e.is_overturned
          AND e.created_at >= now() - interval '12 months'), 0))::integer  AS score,
    COUNT(*) FILTER (
        WHERE e.kind = 'strike'
          AND NOT e.is_overturned
          AND e.created_at >= now() - interval '12 months')::integer       AS strike_count,
    MAX(e.created_at) FILTER (
        WHERE e.kind = 'strike' AND NOT e.is_overturned)                   AS last_strike_at,
    COUNT(*) FILTER (WHERE e.is_overturned)::integer                       AS overturned_count
FROM public.employee_reliability_events e
GROUP BY e.user_id, e.organization_id;

-- ===========================================================================
-- 5. THE CYCLE CLOCK  (new requirement, 03-Aug walkthrough)
--
-- "this entire cycle from when the electricity bill is recieved to when the bill is paid
-- the early due timeline is the one to track so everything here is a run against time and
-- it has to be visible here as well"
--
-- The insight this encodes: the deadline that matters is not the DUE date, it is the
-- EARLY-PAYMENT date, because that is the one with money attached. Every day a bill spends
-- in validation or dispute is a day eaten out of the discount window, and until now
-- nothing made that visible — the register showed a due date and said nothing about
-- whether the pipeline could still finish in time to beat it.
--
-- received_at starts the clock. For mailbox-ingested bills it is the mail's received_at;
-- for the 102 imported rows it is unknown and stays NULL, which the view reports honestly
-- rather than substituting the bill date and inventing a cycle time nobody measured.
-- ===========================================================================
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS received_at timestamptz,
    -- Stamped when workflow_status first reaches 'paid'. Denormalised from the event
    -- trail so cycle maths is one column read, not a window function per bill.
    ADD COLUMN IF NOT EXISTS cycle_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_elec_bills_cycle_open
    ON public.electricity_bills(organization_id, early_payment_date, due_date)
    WHERE workflow_status NOT IN ('paid', 'aop_linked');

-- The clock, per bill. One place computes "how long has this been sitting, how long is
-- left, and is the money still winnable" so the tracker, the PDF and any future alert
-- cannot disagree about it.
CREATE OR REPLACE VIEW public.electricity_bill_cycle
WITH (security_invoker = on) AS
WITH last_event AS (
    SELECT DISTINCT ON (bill_id)
           bill_id, created_at AS stage_entered_at
    FROM public.electricity_bill_events
    WHERE event_type = 'workflow'
    ORDER BY bill_id, created_at DESC
)
SELECT
    b.id,
    b.organization_id,
    b.account_id,
    a.site_label,
    a.provider,
    a.consumer_ref,
    b.billing_month,
    b.workflow_status,
    b.payment_status,
    b.received_at,
    b.early_payment_date,
    b.due_date,
    b.total_amount,
    b.early_payment_amount,
    b.after_due_date_amount,
    b.payment_date,
    b.cycle_completed_at,

    le.stage_entered_at,
    -- How long in the CURRENT stage. Falls back to created_at for bills that predate the
    -- event trail, so the column is never silently null for imported rows.
    EXTRACT(day FROM now() - COALESCE(le.stage_entered_at, b.created_at))::int AS days_in_stage,

    -- Cycle so far: received -> paid, or received -> now while still open. NULL when the
    -- bill never came through the mailbox, because no honest start time exists.
    CASE
        WHEN b.received_at IS NULL THEN NULL
        ELSE EXTRACT(day FROM COALESCE(b.cycle_completed_at, now()) - b.received_at)::int
    END AS cycle_days,

    (b.early_payment_date - CURRENT_DATE) AS days_to_early,
    (b.due_date           - CURRENT_DATE) AS days_to_due,

    -- The money still winnable today, and the money already forfeited.
    CASE
        WHEN b.payment_status = 'pending'
         AND b.early_payment_date >= CURRENT_DATE
         AND b.total_amount > b.early_payment_amount
        THEN b.total_amount - b.early_payment_amount ELSE 0
    END AS discount_still_winnable,

    -- clock_status: the race, in one word the UI can colour on.
    --   settled          — paid, clock stopped
    --   discount_lost    — early date gone, bill still open: the saving is forfeited
    --   overdue          — past the due date, now accruing penalty
    --   critical         — 2 days or less to the early date, and not yet verified
    --   tight            — 5 days or less to the early date
    --   on_track         — time in hand
    CASE
        WHEN b.payment_status = 'paid'                                   THEN 'settled'
        WHEN b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE        THEN 'overdue'
        WHEN b.early_payment_date IS NOT NULL
         AND b.early_payment_date < CURRENT_DATE                         THEN 'discount_lost'
        WHEN b.early_payment_date IS NOT NULL
         AND b.early_payment_date - CURRENT_DATE <= 2
         AND b.workflow_status NOT IN ('verified','scenario_selected','sent_to_accounts')
                                                                         THEN 'critical'
        WHEN b.early_payment_date IS NOT NULL
         AND b.early_payment_date - CURRENT_DATE <= 5                    THEN 'tight'
        ELSE 'on_track'
    END AS clock_status
FROM public.electricity_bills b
JOIN public.electricity_billing_accounts a ON a.id = b.account_id
LEFT JOIN last_event le ON le.bill_id = b.id;

-- ===========================================================================
-- 6. SAVINGS TARGET  (new requirement, 03-Aug walkthrough)
--
-- "it is also important that the electricity council memember be provided a target that
-- he has to ensure this much amount lets say 15 lacs to be saved annually from electricity
-- bills alone and he has to run with it"
--
-- The target is owned by a named person, not by the org in the abstract — "he has to run
-- with it" means the number needs a face against it. Attainment is computed from the same
-- captured/missed maths the discount performance view already uses, so the target cannot
-- drift from what the tracker reports.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.electricity_savings_targets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Indian FY by default: 01-Apr to 31-Mar. Stored as real dates so a part-year or a
    -- calendar-year target is expressible without a special case.
    period_start      date NOT NULL,
    period_end        date NOT NULL,
    label             text,                      -- 'FY 2026-27'

    target_amount     numeric(14,2) NOT NULL,    -- 1500000.00 for "15 lacs"
    -- The council member who runs with it.
    owner_user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    owner_label       text,                      -- 'Electricity Council Member' when unassigned

    notes             text,
    is_active         boolean NOT NULL DEFAULT true,
    created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT elec_savings_target_period CHECK (period_end > period_start),
    CONSTRAINT elec_savings_target_positive CHECK (target_amount > 0),
    -- One active target per org per period.
    CONSTRAINT elec_savings_target_unique UNIQUE (organization_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_elec_savings_targets_org
    ON public.electricity_savings_targets(organization_id) WHERE is_active;

-- ===========================================================================
-- RLS — the tracker audience reads; service role writes. Matches the other
-- electricity tables (has_aop_access is defined in 20260802000001).
-- ===========================================================================
ALTER TABLE public.electricity_bill_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electricity_sender_allowlist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electricity_savings_targets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_reliability_contests    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads bill events" ON public.electricity_bill_events
    FOR SELECT USING (public.has_aop_access(organization_id));

CREATE POLICY "aop access reads sender allowlist" ON public.electricity_sender_allowlist
    FOR SELECT USING (public.has_aop_access(organization_id));

CREATE POLICY "aop access reads savings targets" ON public.electricity_savings_targets
    FOR SELECT USING (public.has_aop_access(organization_id));

-- A contest is readable by its subject (so an employee can follow their own case) and by
-- the tracker audience (so a super admin can review it). The subject clause comes first
-- because it is the one that must never fail — an employee locked out of their own
-- contest would make the strike uncontestable in practice.
CREATE POLICY "subject or reviewers read contests" ON public.employee_reliability_contests
    FOR SELECT USING (user_id = auth.uid() OR public.has_aop_access(organization_id));
