-- The "To Align" queue, computed in SQL instead of in the API.
--
-- The route previously pulled a capped candidate set (.limit(1000)) out of
-- zoho_purchase_orders, fetched po_payments separately, then filtered/sorted/paginated
-- in TypeScript. Two defects followed from that, both silent:
--
--   1. With 5248 POs in this org, ~4200 could never appear in the queue at all — the
--      cap was applied BEFORE the pending-amount filter, so only the newest 1000 POs
--      were ever candidates.
--   2. The payments lookup used .in('po_id', ...) with no paging. PostgREST clamps at
--      1000 rows, so once a PO set has more than 1000 payment tranches the totals come
--      back short — which OVERSTATES pending_amount and re-opens already-paid POs.
--
-- Aggregating here fixes both by construction: there is no row cap on a view, the
-- filter is applied over the whole table, and .range() on the view is true pagination
-- with an accurate exact count.
--
-- `raw` is deliberately excluded — it is the whole Zoho API payload per PO and is never
-- used by the list UI.

CREATE OR REPLACE VIEW public.po_alignment_queue
WITH (security_invoker = on) AS      -- respects the underlying tables' RLS for client reads
SELECT
    po.id,
    po.organization_id,
    po.po_number,
    po.vendor_name,
    po.vendor_id,
    po.zoho_po_id,
    po.po_amount,
    po.status,
    po.department,
    po.project_name,
    po.property_id,
    po.category,
    po.currency,
    po.po_date,
    po.delivery_date,
    po.source,
    po.synced_at,
    po.created_at,
    po.updated_at,

    COALESCE(pay.aligned_total, 0)::NUMERIC(14,2)   AS aligned_total,
    COALESCE(pay.completed_total, 0)::NUMERIC(14,2) AS completed_total,
    GREATEST(
        0,
        po.po_amount - COALESCE(pay.aligned_total, 0) - COALESCE(pay.completed_total, 0)
    )::NUMERIC(14,2)                                AS pending_amount,

    COALESCE(w.is_critical, false)                  AS is_critical,
    w.critical_reason,
    w.critical_raised_at,
    w.assigned_spoc,

    -- A PO nobody will ever pay must not sit in the To Align queue inflating the
    -- backlog. zohoBooksSync.ts:38 stores Zoho's status verbatim and zohoService.ts:95
    -- pulls every status, so cancelled/draft rows do reach this table.
    -- NULL status stays payable: manual and CSV rows routinely have no status, and
    -- `status NOT IN (...)` would evaluate to NULL and silently drop every one of them.
    (po.status IS NULL OR lower(po.status) NOT IN ('cancelled', 'draft'))
                                                    AS is_payable
FROM public.zoho_purchase_orders po
LEFT JOIN LATERAL (
    -- Mirrors the previous TypeScript exactly: cancelled tranches are ignored, and
    -- anything not yet completed ('aligned' or 'to_align') counts as reserved.
    SELECT
        SUM(p.requested_amount) FILTER (WHERE p.status =  'completed') AS completed_total,
        SUM(p.requested_amount) FILTER (WHERE p.status <> 'completed') AS aligned_total
    FROM public.po_payments p
    WHERE p.po_id = po.id
      AND p.status <> 'cancelled'
) pay ON TRUE
LEFT JOIN public.po_workflow_state w
       ON w.po_id = po.id
      AND w.organization_id = po.organization_id;

COMMENT ON VIEW public.po_alignment_queue IS
    'zoho_purchase_orders with payment totals, pending amount and workflow flags resolved in SQL. Backs the Payment Tracker To Align queue.';

-- The LATERAL aggregate is driven by this; idx_pop_po already covers po_id but the
-- status predicate makes a composite worthwhile at 5k+ POs.
CREATE INDEX IF NOT EXISTS idx_pop_po_status
    ON public.po_payments (po_id, status);

-- EXPLAIN ANALYZE against the live 5265-row org showed a Parallel Seq Scan plus a full
-- sort of every PO to satisfy the queue's ORDER BY (32.8ms/page). The existing
-- idx_zpo_org is (organization_id, status) and cannot serve it. This matches the
-- ordering the API asks for, so the scan and sort collapse as the table grows.
CREATE INDEX IF NOT EXISTS idx_zpo_org_po_date
    ON public.zoho_purchase_orders (organization_id, po_date DESC NULLS LAST, created_at DESC);
