/**
 * Payment Tracker response contracts.
 *
 * Every shape returned by /api/accounts/tracker, /api/accounts/po/[id],
 * /api/accounts/po/[id]/documents and /api/accounts/vendor-profiles/* lives here so the
 * UI imports the same types the routes return, instead of re-declaring them and drifting.
 *
 * Convention across this module: a value that is not known is `null`, never a default.
 * `percent_committed: null` means nobody recorded a percentage; it does not mean 0%.
 */

// ---------------------------------------------------------------------------
// Enumerations — mirror the CHECK constraints in
// 20260805000001_payment_tracker_compliance.sql and 20260723000003_payment_tracker.sql.
// ---------------------------------------------------------------------------

export type PaymentStatus = 'to_align' | 'aligned' | 'completed' | 'cancelled';

/** Per-PO tracker state. Precedence is defined in po_tracker_rows.payment_state. */
export type PaymentState =
    | 'not_requested'   // no tranche raised yet
    | 'to_align'        // requested, waiting for procurement to align it
    | 'aligned'         // aligned, waiting on accounts + a UTR
    | 'partially_paid'  // some tranches paid, PO value not fully covered
    | 'paid'
    | 'cancelled';      // every tranche ever raised was cancelled

/** Zoho's status vocabulary normalised. `null` = a status this app does not recognise. */
export type PoApprovalState = 'draft' | 'pending_approval' | 'approved' | 'cancelled' | null;

/**
 * Payment readiness. Three explicit states, never a score.
 *   blocked_no_vendor_profile — no vendor_profiles row matches the PO's Zoho vendor id.
 *   blocked_docs_missing      — profile exists, required docs not all verified-and-current.
 *   ready                     — profile exists and GST + PAN + cancelled cheque are verified.
 * The tax invoice is NOT an input: advances are paid before one exists. Read
 * `has_tax_invoice` separately.
 */
export type PoReadiness = 'blocked_no_vendor_profile' | 'blocked_docs_missing' | 'ready';

export type ComplianceStatus = 'unverified' | 'in_review' | 'verified' | 'rejected' | 'expired';
export type MsmeCategory = 'micro' | 'small' | 'medium' | 'not_registered';
export type DocumentStatus = 'pending' | 'uploaded' | 'verified' | 'rejected';

export type VendorDocType =
    | 'gst_certificate' | 'pan_card' | 'udyam_certificate' | 'msme_certificate'
    | 'cancelled_cheque' | 'agreement' | 'insurance' | 'other';

export type PoDocType =
    | 'tax_invoice' | 'proforma_invoice' | 'delivery_challan'
    | 'grn' | 'work_completion' | 'payment_proof' | 'other';

export type PoActivityAction =
    | 'po_synced' | 'payment_requested' | 'aligned' | 'completed' | 'cancelled'
    | 'utr_recorded' | 'document_uploaded' | 'document_verified' | 'vendor_updated'
    | 'critical_raised' | 'critical_cleared' | 'comment' | 'email_sent' | 'email_action';

export type ActorChannel = 'app' | 'email' | 'system' | 'cron';

/** The required-document set, defined in po_tracker_rows and mirrored here for the UI. */
export const REQUIRED_VENDOR_DOCS: VendorDocType[] = ['gst_certificate', 'pan_card', 'cancelled_cheque'];

/**
 * Collapse the six-state payment_state into the four states the existing UI colour maps
 * know. Deliberately identical to derivePoPaymentStatus() in frontend/lib/accounts/roles.ts
 * — two functions answering the same question differently is how a row ends up green in one
 * place and orange in another.
 */
export function legacyPaymentStatus(counts: {
    tranche_count: number; aligned_count: number; completed_count: number; cancelled_count: number;
}): PaymentStatus {
    if (counts.tranche_count === 0) return counts.cancelled_count > 0 ? 'cancelled' : 'to_align';
    if (counts.completed_count === counts.tranche_count) return 'completed';
    if (counts.aligned_count > 0 || counts.completed_count > 0) return 'aligned';
    return 'to_align';
}

// ---------------------------------------------------------------------------
// po_tracker_rows — the shared sheet
// ---------------------------------------------------------------------------

export interface PoTrackerRow {
    po_id: string;
    organization_id: string;
    po_number: string;
    vendor_name: string | null;
    /** Zoho contact id (TEXT). null on manually added POs — such a PO can never resolve a vendor profile. */
    vendor_id: string | null;
    zoho_po_id: string | null;
    po_amount: number;
    currency: string;
    po_date: string | null;
    delivery_date: string | null;
    department: string | null;
    project_name: string | null;
    property_id: string | null;
    category: string | null;
    source: 'manual' | 'zoho' | 'csv';
    /** Zoho's raw status string, unmodified. */
    po_status: string | null;
    po_approval_state: PoApprovalState;
    is_payable: boolean;
    po_created_at: string;
    po_updated_at: string;

    // payment rollup — counts exclude cancelled tranches except cancelled_count
    tranche_count: number;
    to_align_count: number;
    aligned_count: number;
    completed_count: number;
    cancelled_count: number;
    requested_total: number;
    paid_total: number;
    /** PO value with no tranche raised against it yet — procurement's queue. */
    unaligned_amount: number;
    /** PO value still owed to the vendor (po_amount − paid_total) — accounts' exposure. */
    outstanding_amount: number;
    /** Sum of percent_of_po over live tranches. null = no tranche recorded a percentage. */
    percent_committed: number | null;

    latest_payment_status: PaymentStatus | null;
    latest_tranche_no: number | null;
    latest_requested_amount: number | null;
    latest_percent_of_po: number | null;
    latest_payment_updated_at: string | null;
    latest_utr: string | null;
    latest_payment_date: string | null;
    latest_completed_at: string | null;
    /** At least one tranche is aligned and still waiting for payment + UTR. */
    awaiting_utr: boolean;
    payment_state: PaymentState;

    // vendor compliance
    vendor_profile_id: string | null;
    vendor_compliance_status: ComplianceStatus | null;
    gstin: string | null;
    pan: string | null;
    udyam_number: string | null;
    msme_category: MsmeCategory | null;
    vendor_verified_at: string | null;
    vendor_has_bank_details: boolean;

    // document readiness
    required_docs_total: number;
    required_docs_verified: number;
    /** Named missing doc types. null when there is no vendor profile to check against. */
    missing_required_docs: VendorDocType[] | null;
    expired_docs_count: number;
    rejected_docs_count: number;
    po_document_count: number;
    has_tax_invoice: boolean;
    tax_invoice_verified: boolean;
    readiness: PoReadiness;

    // workflow
    is_critical: boolean;
    critical_reason: string | null;
    critical_raised_at: string | null;
    assigned_spoc: string | null;
    last_activity_at: string | null;

    // ---------------------------------------------------------------------
    // Flat aliases, added by the route (not columns on the view).
    //
    // The sheet UI (frontend/components/accounts/PaymentTrackerTable.tsx) was written
    // against these names and against the four-state vocabulary its colour map knows.
    // Serving both keeps one contract instead of forcing a rename through a component that
    // is already correct — the precise fields above remain the source of truth.
    // ---------------------------------------------------------------------
    /**
     * payment_state collapsed into the four states PAY_STATUS_META / liveStatusMeta render.
     * Identical rules to derivePoPaymentStatus() in frontend/lib/accounts/roles.ts:
     * not_requested -> to_align, partially_paid -> aligned, paid -> completed.
     */
    status: PaymentStatus;
    /** Alias of outstanding_amount. */
    outstanding: number;
    /** Alias of latest_utr. */
    utr_no: string | null;
    /** Alias of vendor_compliance_status. */
    compliance_status: ComplianceStatus | null;
    /** Count of missing_required_docs. null when there is no vendor profile to check. */
    documents_missing: number | null;
    /** Most recent of the PO row and its latest payment — "when did this row last move". */
    updated_at: string;
}

export interface Pagination {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
}

export interface TrackerCapabilities {
    align: boolean;
    complete: boolean;
    admin: boolean;
}

export interface TrackerResponse {
    organization_id: string;
    /**
     * false when the tracker's migrations have not been applied yet. The response is a 200
     * with no rows — this is a setup state, not a failure, and the UI renders it as one.
     */
    provisioned: boolean;
    rows: PoTrackerRow[];
    pagination: Pagination;
    can: TrackerCapabilities;
    filters: {
        status: string | null;
        vendor: string | null;
        readiness: PoReadiness | null;
        search: string | null;
        critical_only: boolean;
        date_from: string | null;
        date_to: string | null;
    };
    generated_at: string;
}

// ---------------------------------------------------------------------------
// PO detail
// ---------------------------------------------------------------------------

export interface PaymentTranche {
    id: string;
    organization_id: string;
    po_id: string;
    po_number: string | null;
    vendor_name: string | null;
    tranche_no: number;
    requested_amount: number;
    /** Agreed share of the PO this tranche represents. Stored at request time, never recomputed. */
    percent_of_po: number | null;
    gst_hold: number;
    tds: number;
    payment_term: string | null;
    status: PaymentStatus;
    aligned_by: string | null;
    aligned_by_name: string | null;
    aligned_at: string | null;
    completed_by: string | null;
    completed_by_name: string | null;
    completed_at: string | null;
    payment_date: string | null;
    paid_amount: number | null;
    utr_no: string | null;
    payment_proof_url: string | null;
    remarks: string | null;
    created_by: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
}

export interface PoDocument {
    id: string;
    organization_id: string;
    po_id: string;
    payment_id: string | null;
    doc_type: PoDocType;
    /**
     * Storage object path inside the private `po_documents` bucket — NOT a browsable URL.
     * Render `signed_url` instead; it is minted per response and expires.
     */
    file_url: string | null;
    file_name: string | null;
    /** Time-limited download URL, null if the object could not be signed. */
    signed_url: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    invoice_amount: number | null;
    gst_amount: number | null;
    status: DocumentStatus;
    uploaded_by: string | null;
    uploaded_by_name: string | null;
    uploaded_at: string | null;
    verified_by: string | null;
    verified_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface VendorDocument {
    id: string;
    organization_id: string;
    vendor_profile_id: string;
    doc_type: VendorDocType;
    file_url: string | null;
    file_name: string | null;
    expires_on: string | null;
    /** True when status is 'verified' but expires_on is in the past — verified is not current. */
    is_expired: boolean;
    status: DocumentStatus;
    uploaded_by: string | null;
    uploaded_at: string | null;
    verified_by: string | null;
    verified_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface VendorProfile {
    id: string;
    organization_id: string;
    zoho_vendor_id: string | null;
    vendor_id: string | null;
    vendor_name: string;
    gstin: string | null;
    pan: string | null;
    udyam_number: string | null;
    msme_category: MsmeCategory | null;
    cin: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_ifsc: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    address: string | null;
    compliance_status: ComplianceStatus;
    verified_by: string | null;
    verified_at: string | null;
    notes: string | null;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;

    // --- Zoho Books mirror (20260806000001) ---------------------------------
    // Filled by backend/services/zohoVendorSync.ts. Optional on the type because a
    // deployment can be running this code before the migration is applied, and the sync
    // degrades to the base columns rather than failing.
    /** Name on the GST certificate, which is often not the trading name. */
    legal_name?: string | null;
    /** business_gst / business_none / overseas / consumer / sez … — says whether a GSTIN is even expected. */
    gst_treatment?: string | null;
    /** Two-letter state code from Zoho's place_of_contact ("MH"), the CGST/SGST vs IGST driver. */
    state_code?: string | null;
    /** Zoho custom field cf_vendor_code — the internal supplier code. */
    vendor_code?: string | null;
    /** Zoho validated this Udyam number against the registry. NOT a human verification. */
    udyam_verified?: boolean | null;
    udyam_verified_at?: string | null;
    tds_percentage?: number | null;
    /** Last per-vendor DETAIL fetch. null = never enriched. */
    zoho_synced_at?: string | null;
    zoho_raw?: Record<string, unknown> | null;
}

export interface PoActivityEntry {
    id: string;
    organization_id: string;
    /** null on vendor-level events, which belong to a vendor_profile rather than a PO. */
    po_id: string | null;
    vendor_profile_id?: string | null;
    payment_id: string | null;
    action: PoActivityAction;
    from_status: string | null;
    to_status: string | null;
    actor_id: string | null;
    /** Denormalised at write time — survives the user being deactivated or renamed. */
    actor_name: string | null;
    actor_role: string | null;
    actor_channel: ActorChannel;
    note: string | null;
    detail: Record<string, unknown> | null;
    created_at: string;
}

/**
 * The PO on the detail page: every tracker column, plus the aliases the detail workspace
 * inherited from the older PurchaseOrder shape.
 *
 * NOTE the deliberate difference from a tracker LIST row: here `status` is the PO's own
 * Zoho lifecycle status (PurchaseOrder semantics) and the payment lifecycle lives on
 * `payment_status`. On a list row there is no PO-lifecycle column in play, so `status`
 * carries the payment state. Each matches what its screen already reads.
 */
export interface PoDetailPo extends Omit<PoTrackerRow, 'status'> {
    /** Alias of po_id — PurchaseOrder.id. */
    id: string;
    /** The PO's raw Zoho status, same value as po_status. */
    status: string | null;
    /** The four-state payment vocabulary — same value a list row exposes as `status`. */
    payment_status: PaymentStatus;
    /** Alias of unaligned_amount — PO value with no tranche against it. */
    pending_amount: number;
    /** Live (non-cancelled, non-completed) tranche value. */
    aligned_total: number;
    /** Alias of paid_total. */
    completed_total: number;
}

export interface PoDetailResponse {
    organization_id: string;
    /** false when the compliance migration has not been applied — a setup state, not an error. */
    provisioned: boolean;
    po: PoDetailPo | null;
    payments: PaymentTranche[];
    documents: PoDocument[];
    vendor: VendorProfile | null;
    vendor_documents: VendorDocument[];
    /** Required doc types with no current verified document. null when there is no profile. */
    missing_required_docs: VendorDocType[] | null;
    activity: PoActivityEntry[];
    can: TrackerCapabilities;
    generated_at: string;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface PoDocumentCreateResponse {
    document: PoDocument;
}

/**
 * How current the Zoho mirror is, org-wide — NOT scoped to the page being displayed.
 * A per-page figure would say "everything on screen is fresh" while three quarters of the
 * roster had never been enriched.
 */
export interface VendorZohoSyncFreshness {
    /** false when 20260806000001 has not been applied — every field below is then null/0. */
    available: boolean;
    /** Profiles with a zoho_vendor_id: the population phase 2 can ever enrich. */
    linked: number;
    /** Of those, how many have never had their detail fetched (zoho_synced_at IS NULL). */
    never_enriched: number;
    oldest_synced_at: string | null;
    newest_synced_at: string | null;
}

export interface VendorProfileListResponse {
    organization_id: string;
    vendor_profiles: VendorProfile[];
    pagination: Pagination;
    can: TrackerCapabilities;
    zoho_sync?: VendorZohoSyncFreshness;
}

/**
 * One phase of the Zoho vendor sync. Counts are per-run, not cumulative.
 *
 * `remaining` is the whole point of the detail phase: 767 vendors at Zoho's ~100/min
 * rate limit cannot be done in one request, so every run has to say how much is left.
 */
export interface VendorZohoSyncResult {
    phase: 'list' | 'detail';
    organization_id: string;
    zoho_organization_id: string | null;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    /** Detail phase only: profiles still awaiting (or overdue) enrichment after this run. */
    remaining: number;
    /** Vendors whose detail call failed. Their zoho_synced_at is left alone so they retry. */
    failed: number;
    /**
     * true when 20260806000001 is not applied yet: the sync ran against the base columns
     * only, so gst_treatment / state_code / udyam_verified / zoho_raw were not written.
     */
    degraded: boolean;
    /** Set when the run stopped early — rate limit, token failure, or the batch cap. */
    stopped_reason?: string;
    duration_ms: number;
    error?: string;
}

export interface VendorProfileResponse {
    vendor_profile: VendorProfile;
}

export interface VendorBackfillResponse {
    organization_id: string;
    /** Distinct (vendor_id, vendor_name) pairs found on the org's POs. */
    distinct_vendors: number;
    created: number;
    already_present: number;
    /**
     * POs whose vendor_id is null/empty. These cannot get a profile: zoho_vendor_id is the
     * only join key, and a null one would match every other null. Reported, never guessed at.
     */
    pos_without_vendor_id: number;
    scanned_pos: number;
}
