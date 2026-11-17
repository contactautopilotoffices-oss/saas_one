-- Invoice-aware alignment.
--
-- The invoice track and the payment track stay separate (see 20261020000001): accepting
-- an invoice never aligns money, and aligning money never marks an invoice verified.
-- What was missing is that the person aligning could not SEE the invoice verdict. These
-- two columns record what was known at the moment of alignment, and why the person went
-- ahead anyway when the invoice did not agree with the PO.
--
-- Soft by design. Nothing here blocks a payment; the API asks for a reason and stores it.

ALTER TABLE public.po_payments
    ADD COLUMN IF NOT EXISTS invoice_match_at_align text,
    ADD COLUMN IF NOT EXISTS invoice_override_reason text;

COMMENT ON COLUMN public.po_payments.invoice_match_at_align IS
    'Invoice match_status for this PO when the tranche was aligned: matched, mismatched, needs_review, duplicate_suspected, or none when no invoice had been received. Frozen at align time, never recomputed.';
COMMENT ON COLUMN public.po_payments.invoice_override_reason IS
    'Why the aligner proceeded although the invoice did not agree with the PO (or had not arrived). Required by the API whenever invoice_match_at_align is not "matched". Shown to whoever completes the payment.';

-- Lets the Payment Tracker and any audit pull the overrides without a scan.
CREATE INDEX IF NOT EXISTS idx_po_payments_invoice_override
    ON public.po_payments(organization_id, aligned_at DESC)
    WHERE invoice_override_reason IS NOT NULL;
