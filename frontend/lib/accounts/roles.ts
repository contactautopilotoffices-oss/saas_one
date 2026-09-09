// Client-side Payment Tracker capabilities + shared types.
// Mirrors backend/lib/accounts/access.ts (API still enforces server-side).

const ORG_ADMIN = new Set(['org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin']);
// property_admin is intentionally excluded — see backend/lib/accounts/access.ts.
const PROCUREMENT = new Set(['purchase_manager', 'purchase_executive', 'procurement']);
const VIEW = new Set([...ORG_ADMIN, ...PROCUREMENT, 'accounts', 'ops_super_admin']);
const ALIGN = new Set([...ORG_ADMIN, ...PROCUREMENT, 'accounts', 'ops_super_admin']);
const COMPLETE = new Set(['accounts', 'org_super_admin', 'master_admin', 'ops_super_admin']);

export interface AccountsCaps { canSee: boolean; isAdmin: boolean; canAlign: boolean; canComplete: boolean; }

interface MembershipLike {
    org_role?: string | null;
    is_master_admin?: boolean;
    properties?: { role?: string }[];
}

export function accountsCaps(m: MembershipLike | null | undefined): AccountsCaps {
    const roles = [m?.org_role, ...(m?.properties?.map(p => p.role) || [])].filter(Boolean) as string[];
    const isMaster = !!m?.is_master_admin;
    return {
        canSee: isMaster || roles.some(r => VIEW.has(r)),
        isAdmin: isMaster || roles.some(r => ORG_ADMIN.has(r)),
        canAlign: isMaster || roles.some(r => ALIGN.has(r)),
        canComplete: isMaster || roles.some(r => COMPLETE.has(r)),
    };
}

// Colours are the agreed Payment Tracker signal set:
//   To Align -> orange, Aligned -> yellow, Completed -> green.
export interface StatusMeta { label: string; color: string; }

export const PAY_STATUS_META: Record<string, StatusMeta> = {
    to_align: { label: 'To Align', color: '#F97316' },
    aligned: { label: 'Aligned', color: '#EAB308' },
    completed: { label: 'Completed', color: '#22C55E' },
    cancelled: { label: 'Cancelled', color: '#94A3B8' },
};

const UNKNOWN_STATUS: StatusMeta = { label: '—', color: '#94A3B8' };

// Criticality is a separate axis from status — red, and never reused for a status.
export const CRITICAL_META: StatusMeta = { label: 'Critical', color: '#DC2626' };

export function payStatusMeta(status?: string | null): StatusMeta {
    return PAY_STATUS_META[status || ''] ?? (status ? { label: status, color: UNKNOWN_STATUS.color } : UNKNOWN_STATUS);
}

// Tinted pill styling for a status/criticality meta — single source of truth so no
// component re-invents the palette.
export function statusPillStyle(meta: StatusMeta) {
    return { color: meta.color, backgroundColor: `${meta.color}1A`, borderColor: `${meta.color}40` };
}

// The "live sheet" status palette — locked to the CSS custom properties the user specified
// (--warning / --secondary / --success), distinct from the tinted orange/yellow/green
// PAY_STATUS_META above. Colour lives on TEXT, not as a card fill — see
// docs/design-references/awesome-design-md/binance/DESIGN.md ("price-up-cell ... never a
// card surface"). Shared by PaymentTrackerTable and the PO detail replica so the two never
// disagree on what "Aligned" looks like.
export interface LiveStatusMeta { label: string; text: string; dot: string; bg: string; }

const LIVE_STATUS: Record<string, LiveStatusMeta> = {
    to_align: { label: 'To Align', text: 'text-warning', dot: 'bg-warning', bg: 'bg-warning/10' },
    aligned: { label: 'Aligned', text: 'text-secondary', dot: 'bg-secondary', bg: 'bg-secondary/10' },
    completed: { label: 'Completed', text: 'text-success', dot: 'bg-success', bg: 'bg-success/10' },
    cancelled: { label: 'Cancelled', text: 'text-text-tertiary', dot: 'bg-text-tertiary', bg: 'bg-muted' },
};

export function liveStatusMeta(status?: string | null): LiveStatusMeta {
    return LIVE_STATUS[status || ''] || LIVE_STATUS.to_align;
}

// Fallback for when the detail API hasn't (yet) returned an aggregate payment_status on the
// PO itself — computed from the tranches the same way the tracker view's SQL would.
export function derivePoPaymentStatus(payments: { status: string }[] | undefined | null): 'to_align' | 'aligned' | 'completed' {
    if (!payments || payments.length === 0) return 'to_align';
    if (payments.every(p => p.status === 'completed')) return 'completed';
    if (payments.some(p => p.status === 'aligned' || p.status === 'completed')) return 'aligned';
    return 'to_align';
}

export const PAYMENT_TERMS = [
    '100% Advance', '50% Advance', '75% Payment', 'Balance + GST', 'Balance Payment',
    '100% After Delivery', '100% After Work Completion', 'Against Tax Invoice', 'Full Payment', 'Other',
];

export const inr = (n: number | null | undefined) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface PurchaseOrder {
    id: string;
    po_number: string;
    vendor_name?: string | null;
    po_amount: number;
    status?: string | null;
    department?: string | null;
    project_name?: string | null;
    category?: string | null;
    po_date?: string | null;
    source?: string | null;
    aligned_total?: number;
    completed_total?: number;
    pending_amount?: number;
}

// Human-authored per-PO state. Kept off zoho_purchase_orders because the Zoho sync
// overwrites that table wholesale — see supabase/migrations/20260801000001_po_workflow_state.sql.
export interface PoWorkflowState {
    id?: string;
    organization_id?: string;
    po_id: string;
    is_critical: boolean;
    critical_reason?: string | null;
    critical_raised_by?: string | null;
    critical_raised_at?: string | null;
    assigned_spoc?: string | null;
    updated_at?: string | null;
}

export interface PoPayment {
    id: string;
    po_id: string;
    po_number?: string | null;
    vendor_name?: string | null;
    tranche_no: number;
    requested_amount: number;
    // Agreed share of the PO this tranche represents (30 for a 30% advance) — stored at
    // request time, never recomputed. See po_payments.percent_of_po in the compliance migration.
    percent_of_po?: number | null;
    gst_hold?: number | null;
    tds?: number | null;
    payment_term?: string | null;
    status: string;
    aligned_at?: string | null;
    completed_at?: string | null;
    payment_date?: string | null;
    paid_amount?: number | null;
    utr_no?: string | null;
    payment_proof_url?: string | null;
    remarks?: string | null;
    po?: { po_number?: string; vendor_name?: string; department?: string; project_name?: string; category?: string; po_amount?: number } | null;
    aligner?: { full_name?: string } | null;
    completer?: { full_name?: string } | null;
}
