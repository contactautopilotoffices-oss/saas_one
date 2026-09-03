// Client-side petty-cash capabilities, derived from the user's membership.
// Mirrors backend/lib/pettyCash/access.ts so the UI shows the right tabs/actions.
// (The API still enforces permissions server-side.)

const TENANT_LIKE = new Set(['tenant', 'tenant_user', 'super_tenant', 'vendor']);
const ORG_ADMIN = new Set(['org_super_admin', 'org_admin', 'master_admin']);
const APPROVER = new Set([
    'org_super_admin', 'org_admin', 'master_admin',
    'property_admin', 'manager_executive', 'soft_service_manager', 'soft_service_supervisor',
]);
const FINANCE = new Set(['accounts', 'org_super_admin', 'master_admin']);

export interface PettyCashCaps {
    canSee: boolean;
    isAdmin: boolean;
    canApprove: boolean;
    canDisburse: boolean;
    properties: { id: string; name: string; code?: string; role?: string }[];
}

interface MembershipLike {
    org_role?: string | null;
    is_master_admin?: boolean;
    properties?: { id: string; name: string; code?: string; role?: string; organization_id?: string | null }[];
}

export function pettyCashCaps(membership: MembershipLike | null | undefined): PettyCashCaps {
    const roles = [membership?.org_role, ...(membership?.properties?.map(p => p.role) || [])].filter(Boolean) as string[];
    const isMaster = !!membership?.is_master_admin;
    const isAdmin = isMaster || roles.some(r => ORG_ADMIN.has(r));
    return {
        canSee: isMaster || roles.some(r => !TENANT_LIKE.has(r)),
        isAdmin,
        canApprove: isAdmin || roles.some(r => APPROVER.has(r)),
        canDisburse: isMaster || roles.some(r => FINANCE.has(r)),
        properties: membership?.properties || [],
    };
}

export const PC_STATUS_META: Record<string, { label: string; color: string }> = {
    draft: { label: 'Draft', color: '#6B7280' },
    submitted: { label: 'Pending Approval', color: '#F59E0B' },
    approved: { label: 'Approved', color: '#3B82F6' },
    rejected: { label: 'Rejected', color: '#EF4444' },
    sent_back: { label: 'Sent Back', color: '#F97316' },
    paid: { label: 'Paid', color: '#8B5CF6' },
    settlement_submitted: { label: 'Settlement Submitted', color: '#0EA5E9' },
    closed: { label: 'Closed', color: '#22C55E' },
    cancelled: { label: 'Cancelled', color: '#94A3B8' },
};

export const PC_CATEGORIES = [
    'Travel', 'Food & Beverages', 'Office Supplies', 'Repairs & Maintenance',
    'Housekeeping', 'Fuel', 'Courier', 'Printing & Stationery', 'Utilities', 'Miscellaneous',
];
export const PC_PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Company Card', 'Other'];
export const PC_DEPARTMENTS = ['Operations', 'Admin', 'Projects', 'HR', 'IT', 'Finance', 'Sales', 'Security'];

export interface PettyCashRequest {
    id: string;
    request_no: string;
    organization_id: string;
    property_id: string;
    requester_id: string;
    request_type: string;
    department?: string | null;
    category?: string | null;
    amount_requested: number;
    purpose: string;
    payment_mode?: string | null;
    expected_date?: string | null;
    vendor_name?: string | null;
    /** Custodian — who physically receives the cash. Often not the requester. */
    recipient_name?: string | null;
    recipient_phone?: string | null;
    status: string;
    approved_amount?: number | null;
    approved_at?: string | null;
    approval_remarks?: string | null;
    paid_amount?: number | null;
    paid_mode?: string | null;
    payment_ref?: string | null;
    paid_at?: string | null;
    actual_spent?: number | null;
    amount_returned?: number | null;
    extra_claimed?: number | null;
    settlement_remarks?: string | null;
    settled_at?: string | null;
    closed_at?: string | null;
    close_remarks?: string | null;
    remarks?: string | null;
    created_at: string;
    requester?: { id: string; full_name?: string; email?: string } | null;
    approver?: { id: string; full_name?: string } | null;
    payer?: { id: string; full_name?: string } | null;
    property?: { id: string; name?: string; code?: string } | null;
}

export interface PettyCashDocument {
    id: string; request_id: string; stage: string; file_url: string; file_name?: string | null; file_type?: string | null; created_at: string;
    /** Settlement bills carry their own value/date/vendor; other attachments leave these null. */
    amount?: number | null;
    bill_date?: string | null;
    vendor?: string | null;
    review_status?: 'pending' | 'accepted' | 'rejected';
    review_remarks?: string | null;
    reviewed_at?: string | null;
}

/** One row of petty_cash_settlement_status — disbursed vs bills vs cash returned. */
export interface PettyCashReconciliation {
    request_id: string;
    disbursed: number;
    bills_total: number;
    bills_count: number;
    bills_pending_review: number;
    bills_rejected: number;
    amount_returned: number;
    accounted: number;
    unaccounted: number;
    accounted_pct: number | null;
    is_open_advance: boolean;
    days_outstanding: number | null;
    recipient_name?: string | null;
    recipient_phone?: string | null;
    property_name?: string | null;
    request_no?: string;
    status?: string;
}
export interface PettyCashActivity {
    id: string; action: string; from_status?: string | null; to_status?: string | null; remark?: string | null; created_at: string;
    actor?: { id: string; full_name?: string } | null;
}

export const inr = (n: number | null | undefined) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
