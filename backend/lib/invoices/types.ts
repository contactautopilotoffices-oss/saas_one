/**
 * Shared shapes for Invoice Control. Pure types and constants only (no server
 * imports) so the matching engine and the client components can both use them.
 */

export type Severity = 'info' | 'warning' | 'blocking';
export type Outcome = 'pass' | 'fail' | 'unknown';

export type MatchStatus = 'pending' | 'matched' | 'mismatched' | 'needs_review' | 'duplicate_suspected';
export type ReviewStatus = 'pending' | 'in_review' | 'accepted' | 'rejected' | 'resubmission_required';
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type FastTrackStatus =
    | 'pending_approval' | 'approved' | 'rejected' | 'needs_information'
    | 'alignment_in_progress' | 'aligned' | 'cancelled';

/** Not stored: derived on read from the linked po_payments row. */
export type FastTrackEffectiveStatus = FastTrackStatus | 'payment_recorded';

export type DocumentationState =
    | 'pending' | 'link_sent' | 'invoice_received' | 'matched'
    | 'reconciled' | 'closed' | 'disputed' | 'waived_by_policy';

export interface InvoiceSettings {
    link_expiry_hours: number;
    max_file_mb: number;
    amount_tolerance: number;
    rate_tolerance_pct: number;
    qty_tolerance_pct: number;
    min_confidence: number;
    approver_roles: string[];
    approval_limit: number;
    escalation_roles: string[];
    evidence_required: boolean;
    doc_deadline_days: number;
    policy_version: number;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
    link_expiry_hours: 72,
    max_file_mb: 10,
    amount_tolerance: 1,
    rate_tolerance_pct: 0,
    qty_tolerance_pct: 0,
    min_confidence: 70,
    approver_roles: ['org_super_admin', 'master_admin', 'accounts'],
    approval_limit: 100000,
    escalation_roles: ['org_super_admin', 'master_admin'],
    evidence_required: true,
    doc_deadline_days: 7,
    policy_version: 1,
};

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedContentType = typeof ALLOWED_CONTENT_TYPES[number];

/** Zoho PO statuses that cannot take an invoice yet, or any more. */
const INELIGIBLE_PO_STATUSES = new Set(['draft', 'cancelled', 'canceled', 'void', 'rejected', 'pending_approval', 'submitted']);

export function isPoEligible(status: string | null | undefined): boolean {
    const s = (status ?? '').trim().toLowerCase();
    // An empty status is not evidence of eligibility.
    if (!s) return false;
    return !INELIGIBLE_PO_STATUSES.has(s);
}

/** What the matching engine and the review screen both need to say about one rule. */
export interface RuleResult {
    rule_code: string;
    severity: Severity;
    outcome: Outcome;
    invoice_line_no?: number | null;
    po_line_item_id?: string | null;
    expected?: unknown;
    actual?: unknown;
    difference?: number | null;
    explanation: string;
}

/** A stored rule result as the summariser sees it: `resolved` once a person has overridden it. */
export type SummarisableResult = Pick<RuleResult, 'rule_code' | 'severity' | 'outcome'> & { resolved?: boolean };

export const RULE_LABELS: Record<string, string> = {
    VENDOR_MATCH: 'Vendor matches PO',
    PO_ELIGIBLE: 'PO can take an invoice',
    INVOICE_IDENTITY: 'Invoice number and date',
    DUPLICATE_CHECK: 'Not a duplicate',
    LINE_ITEM_MAPPING: 'Lines map to PO lines',
    QUANTITY_CHECK: 'Quantity within PO',
    UNIT_RATE_CHECK: 'Rate matches PO',
    TAX_CHECK: 'Tax is consistent',
    TOTAL_CHECK: 'Totals add up',
    PO_BALANCE_CHECK: 'Within remaining PO value',
    EXTRA_CHARGES_CHECK: 'Extra charges supported',
    EXTRACTION_CONFIDENCE: 'Fields read with confidence',
};
