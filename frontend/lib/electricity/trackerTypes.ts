/**
 * Client-side contract for the electricity bill tracker.
 *
 * Hand-written mirror of what app/api/electricity/tracker/route.ts serialises (same
 * convention as frontend/lib/aop/types.ts) — never import the backend/lib server module
 * from a client component, or supabase-admin ends up in the browser bundle.
 */

export type Urgency = 'overdue' | 'due_soon' | 'discount_expiring' | 'discount_missed' | 'ok' | 'settled';
export type PaymentStatus = 'pending' | 'paid' | 'disputed';

/** Bill lifecycle pipeline (supabase/migrations/20260804000001), independent of payment_status. */
export type WorkflowStatus =
    | 'ingested' | 'needs_manual_entry' | 'parsed' | 'validating' | 'validated'
    | 'chasing' | 'disputed' | 'verified' | 'scenario_selected'
    | 'sent_to_accounts' | 'paid' | 'aop_linked';

// ---------------------------------------------------------------------------
// Phase 1 — Inbox (GET /api/electricity/documents)
// ---------------------------------------------------------------------------

export interface BillDocument {
    id: string;
    account_id: string | null;
    bill_id: string | null;
    mailbox_message_id: string | null;
    from_address: string | null;
    subject: string | null;
    received_at: string | null;
    storage_path: string | null;
    file_name: string | null;
    mime_type: string | null;
    ocr_status: 'pending' | 'parsed' | 'failed' | 'manual';
    ocr_payload: { raw?: Record<string, unknown> } | null;
    ocr_confidence: number | null;
    created_at: string;

    // Added by 20260804000006. Optional so the Inbox still renders against a database
    // where only the earlier ingestion migration is applied.
    /** Allow-list verdict on the sending address (REQ-E-01). */
    sender_status?: 'allowed' | 'quarantined' | 'released';
    quarantine_reason?: string | null;
    /** Per-field OCR confidence, 0–100 (REQ-E-02). */
    field_confidence?: Record<string, number> | null;
    lowest_confidence_field?: string | null;
    lowest_confidence?: number | null;
    needs_field_review?: boolean;
}

/** Human labels for the OCR field keys, for the confidence readout. */
export const OCR_FIELD_LABELS: Record<string, string> = {
    provider: 'Provider',
    consumer_number: 'Consumer number',
    billing_month: 'Billing month',
    bill_date: 'Bill date',
    due_date: 'Due date',
    total_amount: 'Amount on due date',
    early_payment_date: 'Early-payment date',
    early_payment_amount: 'Early-payment amount',
    after_due_amount: 'After-due amount',
    billed_units: 'Billed units',
    billed_units_unit: 'Unit',
};

export interface DocumentsPayload {
    provisioned: boolean;
    documents: BillDocument[];
}

// ---------------------------------------------------------------------------
// Phase 2 — Validation queue (GET /api/electricity/validations)
// ---------------------------------------------------------------------------

export interface ValidationRun {
    id: string;
    run_at: string;
    method: 'auto' | 'manual';
    billed_units: number | null;
    logged_units: number | null;
    variance_pct: number | null;
    tolerance_pct: number;
    missing_dates: string[] | null;
    readings_counted: number | null;
    readings_excluded: number | null;
    result: 'pass' | 'variance' | 'incomplete_data' | 'no_meter_link';
    checked_by: string | null;
    checked_at: string | null;
    checker_note: string | null;
}

export interface ValidationQueueRow {
    id: string;
    account_id: string;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    billed_units: number | null;
    billed_units_unit: string | null;
    workflow_status: WorkflowStatus;
    electricity_billing_accounts: { provider: string; site_label: string; consumer_ref: string | null } | null;
    latest_validation: ValidationRun | null;
}

export interface ValidationsPayload {
    provisioned: boolean;
    queue: ValidationQueueRow[];
    can_check: boolean;
}

// ---------------------------------------------------------------------------
// Phase 3 — Disputes (GET /api/electricity/disputes)
// ---------------------------------------------------------------------------

export interface DisputeAttachment {
    storage_path: string;
    file_name: string;
    mime_type: string;
}

export interface DisputeResponse {
    id: string;
    dispute_id: string;
    author_id: string | null;
    body: string;
    attachments: DisputeAttachment[] | null;
    created_at: string;
}

export interface Dispute {
    id: string;
    organization_id: string;
    bill_id: string;
    validation_id: string | null;
    raised_by: string | null;
    raised_at: string;
    reason: string;
    status: 'open' | 'responded' | 'accepted' | 'rejected' | 'withdrawn';
    assigned_property_admin: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_note: string | null;
    electricity_dispute_responses: DisputeResponse[];
}

export interface DisputesPayload {
    provisioned: boolean;
    scope?: 'org' | 'assigned';
    disputes: Dispute[];
}

// ---------------------------------------------------------------------------
// Phase 6 — Payment runs (GET /api/electricity/payment-runs)
// ---------------------------------------------------------------------------

export type PaymentScenario = 'early' | 'due' | 'late';

export interface PaymentRun {
    id: string;
    organization_id: string;
    period_month: string;
    status: 'draft' | 'submitted' | 'in_payment' | 'completed';
    submitted_by: string | null;
    submitted_at: string | null;
    completed_at: string | null;
}

export interface PaymentSelection {
    id: string;
    run_id: string;
    bill_id: string;
    scenario: PaymentScenario;
    scenario_amount: number;
    pay_by_date: string | null;
    note: string | null;
    selected_by: string | null;
    selected_at: string;
}

export interface PaymentFormRow {
    bill_id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    early_payment_date: string | null;
    due_date: string | null;
    early_payment_amount: number | null;
    total_amount: number | null;
    after_due_date_amount: number | null;
    selection: PaymentSelection | null;
}

export interface PaymentRunsPayload {
    provisioned: boolean;
    runs: PaymentRun[];
    draft_run?: PaymentRun | null;
    form: PaymentFormRow[] | null;
}

/** One line of the Accounts payment queue: a selection joined with its bill
 *  (GET /api/electricity/payment-runs?run_id=). */
export interface PaymentQueueBill {
    id: string;
    run_id: string;
    bill_id: string;
    scenario: PaymentScenario;
    scenario_amount: number;
    pay_by_date: string | null;
    note: string | null;
    bill: {
        id: string;
        billing_month: string;
        total_amount: number | null;
        payment_status: PaymentStatus;
        payment_date: string | null;
        paid_amount: number | null;
        account: { site_label: string; provider: string; consumer_ref: string | null } | null;
    } | null;
}

export interface PaymentRunQueuePayload {
    provisioned: boolean;
    run: PaymentRun;
    bills: PaymentQueueBill[];
}

/** Signed file view (private electricity-bills bucket) — redirects to a signed URL. */
export const electricityFileUrl = (storagePath: string) =>
    `/api/electricity/files?path=${encodeURIComponent(storagePath)}`;

/** Same, addressed by document id (the register's paperclip only has document_id). */
export const electricityDocUrl = (documentId: string) =>
    `/api/electricity/files?doc=${encodeURIComponent(documentId)}`;

export interface BillRow {
    id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    property_id: string | null;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    early_payment_date: string | null;
    early_payment_amount: number | null;
    after_due_date_amount: number | null;
    payment_status: PaymentStatus;
    payment_date: string | null;
    /** Phase 1+: pipeline-side status and the source PDF, merged in by the tracker
     *  route from electricity_bills (absent when the ingestion migration is not applied). */
    workflow_status?: WorkflowStatus | null;
    document_id?: string | null;
    days_to_early_payment: number | null;
    days_to_due: number | null;
    discount_at_risk: number | null;
    penalty_exposure: number | null;
    urgency: Urgency;
}

export interface AccountLite {
    id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    property_id: string | null;
    early_payment_discount_pct: number | null;
}

export interface DeadlineBucketRow {
    id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    cutoff_date: string | null;
    amount_due: number | null;
    money_at_risk: number;
    urgency: Urgency;
}

export interface Deadlines {
    overdue: DeadlineBucketRow[];
    due_soon: DeadlineBucketRow[];
    discount_expiring: DeadlineBucketRow[];
    upcoming: DeadlineBucketRow[];
    money_at_risk: { discount_at_risk: number; penalty_exposure: number };
    open_value: number;
}

export interface DiscountFigures {
    available: number;
    captured: number;
    missed: number;
    unverifiable: number;
}

export interface DiscountPerformance {
    totals: DiscountFigures;
    by_month: Array<{ month: string } & DiscountFigures>;
    by_account: Array<{
        account_id: string; site_label: string; provider: string; consumer_ref: string | null;
    } & DiscountFigures>;
}

export interface ReconciliationRow {
    month: string;
    billed_total: number | null;
    aop_actual: number | null;
    delta: number | null;
    delta_pct: number | null;
    flagged: boolean;
}

export interface Seasonality {
    months: string[];
    totals_by_month: Array<{ month: string; total: number }>;
    by_account: Array<{
        account_id: string; site_label: string; provider: string; consumer_ref: string | null;
        values: Array<number | null>;
    }>;
}

export interface TrackerPayload {
    provisioned: boolean;
    reason?: string;
    months: string[];
    accounts: AccountLite[];
    register: { rows: BillRow[]; total: number };
    deadlines: Deadlines;
    discount_performance: DiscountPerformance;
    reconciliation: { rows: ReconciliationRow[]; aop_provisioned: boolean; aop_line_item_found: boolean };
    seasonality: Seasonality;
}

// ---------------------------------------------------------------------------
// Formatting — Indian conventions throughout, same vocabulary as frontend/lib/aop/types.ts.
// ---------------------------------------------------------------------------

export function inr(value: number | null | undefined, compact = false): string {
    if (value === null || value === undefined) return '—';
    const v = Number(value) || 0;
    if (compact) {
        const abs = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 2)}cr`;
        if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
        if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export const monthLabel = (month: string | null | undefined): string =>
    month
        ? new Date(`${month.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
            month: 'short', year: 'numeric', timeZone: 'UTC',
        })
        : '—';

export const URGENCY_META: Record<Urgency, { label: string; color: string }> = {
    overdue: { label: 'Overdue', color: 'var(--error)' },
    due_soon: { label: 'Due soon', color: 'var(--warning)' },
    discount_expiring: { label: 'Discount expiring', color: 'var(--warning)' },
    discount_missed: { label: 'Discount missed', color: 'var(--text-tertiary)' },
    ok: { label: 'Open', color: 'var(--text-tertiary)' },
    settled: { label: 'Settled', color: 'var(--success)' },
};

export const STATUS_META: Record<PaymentStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'var(--warning)' },
    paid: { label: 'Paid', color: 'var(--success)' },
    disputed: { label: 'Disputed', color: 'var(--error)' },
};
