// Payment Tracker "compliance" types — vendor profiles, documents, activity log.
//
// Mirrors supabase/migrations/20260805000001_payment_tracker_compliance.sql, which has NOT
// been applied yet. Every surface importing these types must treat a 404 or a
// `provisioned: false` response as a setup state, not an error.
//
// Deliberately NOT imported from backend/lib/accounts/trackerTypes.ts: a backend agent is
// writing the new API routes (and that file) in parallel, and importing a module that may
// not exist on disk yet would break `tsc` regardless of this file's own correctness. These
// are the frontend's own copy of the same shapes — keep in sync if the backend contract
// ends up shifting once it lands.

import { PurchaseOrder, PoPayment } from './roles';

export type ComplianceStatus = 'unverified' | 'in_review' | 'verified' | 'rejected' | 'expired';
export type MsmeCategory = 'micro' | 'small' | 'medium' | 'not_registered';
export type DocStatus = 'pending' | 'uploaded' | 'verified' | 'rejected';
export type ActorChannel = 'app' | 'email' | 'system' | 'cron';

export const VENDOR_DOC_TYPES = [
    { key: 'gst_certificate', label: 'GST certificate' },
    { key: 'pan_card', label: 'PAN card' },
    { key: 'udyam_certificate', label: 'Udyam certificate' },
    { key: 'msme_certificate', label: 'MSME certificate' },
    { key: 'cancelled_cheque', label: 'Cancelled cheque' },
    { key: 'agreement', label: 'Vendor agreement' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'other', label: 'Other' },
] as const;

export const PO_DOC_TYPES = [
    { key: 'tax_invoice', label: 'Tax invoice' },
    { key: 'proforma_invoice', label: 'Proforma invoice' },
    { key: 'delivery_challan', label: 'Delivery challan' },
    { key: 'grn', label: 'Goods receipt note (GRN)' },
    { key: 'work_completion', label: 'Work completion certificate' },
    { key: 'payment_proof', label: 'Payment proof' },
    { key: 'other', label: 'Other' },
] as const;

// Vendors take differing upfront terms; these are the presets called out for the slider.
export const TRANCHE_PRESETS = [25, 30, 50, 100] as const;

export interface VendorProfile {
    id: string;
    organization_id: string;
    zoho_vendor_id?: string | null;
    vendor_id?: string | null;
    vendor_name: string;
    gstin?: string | null;
    pan?: string | null;
    udyam_number?: string | null;
    msme_category?: MsmeCategory | null;
    cin?: string | null;
    bank_account_name?: string | null;
    bank_account_number?: string | null;
    bank_ifsc?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    address?: string | null;
    compliance_status: ComplianceStatus;
    verified_by?: string | null;
    verified_at?: string | null;
    notes?: string | null;
}

export interface VendorDocument {
    id: string;
    vendor_profile_id: string;
    doc_type: typeof VENDOR_DOC_TYPES[number]['key'];
    file_url?: string | null;
    file_name?: string | null;
    expires_on?: string | null;
    status: DocStatus;
    uploaded_at?: string | null;
    verified_at?: string | null;
    notes?: string | null;
}

export interface PoDocument {
    id: string;
    po_id: string;
    payment_id?: string | null;
    doc_type: typeof PO_DOC_TYPES[number]['key'];
    file_url?: string | null;
    file_name?: string | null;
    invoice_no?: string | null;
    invoice_date?: string | null;
    invoice_amount?: number | null;
    gst_amount?: number | null;
    status: DocStatus;
    uploaded_at?: string | null;
    uploaded_by_name?: string | null;
    verified_at?: string | null;
    notes?: string | null;
}

export interface PoActivityLogEntry {
    id: string;
    po_id: string;
    payment_id?: string | null;
    action: string;
    from_status?: string | null;
    to_status?: string | null;
    actor_id?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    actor_channel: ActorChannel;
    note?: string | null;
    detail?: Record<string, unknown> | null;
    created_at: string;
}

// One row of the shared "live sheet" — the whole point is that procurement, accounts and
// super admin see the exact same fields, so this stays flat rather than nested per-tranche.
export interface TrackerRow {
    po_id: string;
    po_number: string;
    vendor_name?: string | null;
    po_amount: number;
    tranche_count: number;
    paid_total: number;
    outstanding: number;
    status: 'to_align' | 'aligned' | 'completed' | 'cancelled' | string;
    utr_no?: string | null;
    compliance_status?: ComplianceStatus | null;
    documents_missing?: number | null;
    po_date?: string | null;
    updated_at?: string | null;
}

export interface TrackerCaps { align: boolean; complete: boolean; }

export interface TrackerResponse {
    provisioned?: boolean;
    rows: TrackerRow[];
    can?: TrackerCaps;
}

// GET /api/accounts/po/[id] response. `po` reuses the existing PurchaseOrder shape so the
// detail page can hand it straight to AlignPaymentModal / MarkPaidModal without remapping.
export interface PoDetail extends PurchaseOrder {
    gst_amount?: number | null;
    taxable_value?: number | null;
    department?: string | null;
    // Aggregate workflow status (to_align / aligned / completed) — distinct from `status`,
    // which is the PO's own Zoho lifecycle field. Falls back to derivePoPaymentStatus() in
    // roles.ts when the API hasn't computed it yet.
    payment_status?: 'to_align' | 'aligned' | 'completed' | 'cancelled' | string | null;
}

export interface PoDetailResponse {
    provisioned?: boolean;
    po: PoDetail | null;
    payments: PoPayment[];
    documents: PoDocument[];
    vendor: VendorProfile | null;
    vendor_documents: VendorDocument[];
    activity: PoActivityLogEntry[];
    can?: TrackerCaps;
}
