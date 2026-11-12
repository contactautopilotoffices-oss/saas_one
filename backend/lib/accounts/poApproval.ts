import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { ensureInvoiceBucket, INVOICE_BUCKET } from '@/backend/lib/invoices/storage';
import { logPoActivity } from './activity';

/**
 * Simulated PO approval, and the approved-PO WhatsApp that goes with it.
 *
 * SIMULATED means exactly that: a super admin recorded "treat this PO as approved" inside
 * this app, because the real approval in Zoho is not available yet. Zoho is never written
 * to. Invoice Control and the payment plan read the EFFECTIVE status, which is "approved"
 * while a simulation exists and the PO is still pending in Zoho; a real approval from Zoho
 * takes over on the next sync without anyone doing anything.
 *
 * The WhatsApp goes ONLY to the test number set in po_notify_settings. There is no code path
 * here that reads a vendor's own phone number.
 */

export const PO_APPROVED_TEMPLATE = process.env.AISENSY_PO_APPROVED_CAMPAIGN || 'po_approved_vendor_notification';
export const INVOICE_DUE_HOURS = 48;

const SIMULATABLE = new Set(['pending_approval', 'submitted']);

// --- pure helpers ----------------------------------------------------------------------

/** 41200 -> "41,200"; 147500 -> "1,47,500". Indian grouping, no decimals, as the template wants. */
export function formatPoValue(total: number): string {
    return Math.round(total).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** 2026-10-22 -> "22-10-2026" */
export function formatPoDate(iso: string | null | undefined): string {
    const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export interface PoNoticeParams {
    vendorName: string; poNumber: string; poDate: string | null; poTotal: number;
}

/** {{1}} vendor, {{2}} PO number, {{3}} PO date, {{4}} PO value (tax-inclusive, the figure on the PDF). */
export function buildNoticeParams(p: PoNoticeParams): string[] {
    return [p.vendorName.trim(), p.poNumber, formatPoDate(p.poDate), formatPoValue(p.poTotal)];
}

/** Digits only, with country code. A bare 10-digit Indian number gets 91. Null if it cannot be a phone number. */
export function normalisePhone(input: string): string | null {
    const digits = String(input ?? '').replace(/\D+/g, '');
    const full = digits.length === 10 ? `91${digits}` : digits;
    return /^[0-9]{11,15}$/.test(full) ? full : null;
}

// --- effective status ----------------------------------------------------------------------

/** Zoho's status, upgraded to "approved" while a simulation exists. Never throws: no table means no simulation. */
export async function effectivePoStatus(orgId: string, poId: string, status: string | null): Promise<string | null> {
    if (!SIMULATABLE.has((status ?? '').toLowerCase())) return status;
    try {
        const { data } = await supabaseAdmin.from('po_simulated_approvals').select('id').eq('organization_id', orgId).eq('po_id', poId).maybeSingle();
        return data ? 'approved' : status;
    } catch {
        return status;
    }
}

// --- Zoho (read-only) --------------------------------------------------------------------------

export interface ZohoCtx { apiDomain: string; token: string; zohoOrgId: string }

/** A Zoho Books access token for the org. Null when Zoho is not configured or sign-in fails. */
export async function zohoContext(orgId: string): Promise<ZohoCtx | null> {
    const { data: cfg } = await supabaseAdmin.from('accounts_zoho_config').select('zoho_organization_id').eq('organization_id', orgId).maybeSingle();
    if (!cfg?.zoho_organization_id) return null;
    const { ZohoService } = await import('@/backend/services/zohoService');
    try {
        const a = await ZohoService.getAccessToken();
        return { apiDomain: a.apiDomain, token: a.token, zohoOrgId: cfg.zoho_organization_id };
    } catch { return null; }
}

/** GET against Zoho Books. Read-only by construction: there is no other verb in this module. */
export async function zohoGet(z: ZohoCtx, path: string, params: Record<string, string> = {}): Promise<Response> {
    const qs = new URLSearchParams({ organization_id: z.zohoOrgId, ...params });
    return fetch(`${z.apiDomain}/books/v3/${path}?${qs}`, { headers: { Authorization: `Zoho-oauthtoken ${z.token}` }, signal: AbortSignal.timeout(30_000) });
}

/**
 * The vendor's WhatsApp number: the app's vendor profile first, then the Zoho contact
 * (mobile before landline). Null when there is none, which is flagged to Purchase, never guessed.
 */
export async function resolveVendorPhone(orgId: string, z: ZohoCtx | null, zohoVendorId: string | null): Promise<string | null> {
    if (!zohoVendorId) return null;
    const { data: vp } = await supabaseAdmin.from('vendor_profiles').select('contact_phone').eq('organization_id', orgId).eq('zoho_vendor_id', zohoVendorId).limit(1).maybeSingle();
    const fromProfile = vp?.contact_phone ? normalisePhone(vp.contact_phone) : null;
    if (fromProfile) return fromProfile;
    if (!z) return null;
    try {
        const res = await zohoGet(z, `contacts/${encodeURIComponent(zohoVendorId)}`);
        const c = ((await res.json().catch(() => null)) as { contact?: { mobile?: string; phone?: string; contact_persons?: { mobile?: string; phone?: string }[] } } | null)?.contact;
        const candidates = [c?.mobile, ...(c?.contact_persons ?? []).map((p) => p.mobile), c?.phone, ...(c?.contact_persons ?? []).map((p) => p.phone)];
        for (const raw of candidates) { const n = raw ? normalisePhone(raw) : null; if (n) return n; }
    } catch { /* no number found */ }
    return null;
}

// --- the PO PDF --------------------------------------------------------------------------------

/** Fetch the PO as a PDF from Zoho (read-only) and keep our own private copy. */
async function rehostPoPdf(orgId: string, z: ZohoCtx | null, po: { key: string; po_number: string; zoho_po_id: string | null }): Promise<{ path: string } | { error: string }> {
    if (!po.zoho_po_id) return { error: 'This PO has no Zoho id, so its PDF cannot be fetched.' };
    if (!z) return { error: 'Could not sign in to Zoho Books.' };
    const res = await zohoGet(z, `purchaseorders/${encodeURIComponent(po.zoho_po_id)}`, { accept: 'pdf' });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: `Zoho did not return a PDF for ${po.po_number} (HTTP ${res.status}).` };

    await ensureInvoiceBucket();
    const path = `${orgId}/${po.key}/po-notice/${po.po_number.replace(/[^\w.-]+/g, '-')}.pdf`;
    const { error } = await supabaseAdmin.storage.from(INVOICE_BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (error) return { error: `Could not store the PDF: ${error.message}` };
    return { path };
}

// --- sending ------------------------------------------------------------------------------------

export interface SendResult { ok: boolean; status?: 'sent' | 'failed' | 'no_phone'; error?: string; to_last4?: string; params?: string[]; media_path?: string }
export type NoticeMode = 'test' | 'live';

/** Only a manual resend while the switch is Live may reach a vendor's own number. Simulating never does. */
export function noticeModeFor(trigger: 'manual' | 'simulation', autoMode: string | null | undefined): NoticeMode {
    return trigger === 'manual' && autoMode === 'live' ? 'live' : 'test';
}

export interface NoticePo {
    orgId: string; poId: string | null; zohoPoId: string; poNumber: string; vendorName: string; zohoVendorId: string | null; poTotal: number; poDate: string | null;
}

/**
 * Send the approved-PO WhatsApp for ONE PO, and record the attempt.
 *   mode 'test'  goes to the test number and nowhere else
 *   mode 'live'  goes to the vendor's own number; with none on file it records `no_phone`
 * Every attempt is a row in po_vendor_notifications, so a failure is visible and a resend is a new row.
 */
export async function sendNotice(po: NoticePo, opts: { mode: NoticeMode; trigger: 'auto' | 'manual' | 'simulation'; byUserId?: string | null }): Promise<SendResult> {
    const params = buildNoticeParams({ vendorName: po.vendorName || 'Vendor', poNumber: po.poNumber, poDate: po.poDate, poTotal: po.poTotal });
    const z = await zohoContext(po.orgId);

    let phone: string | null = null;
    if (opts.mode === 'test') {
        const { data: settings } = await supabaseAdmin.from('po_notify_settings').select('test_phone').eq('organization_id', po.orgId).maybeSingle();
        phone = settings?.test_phone ?? null;
    } else {
        phone = await resolveVendorPhone(po.orgId, z, po.zohoVendorId);
    }
    const last4 = phone ? phone.slice(-4) : null;

    const record = async (status: 'sent' | 'failed' | 'no_phone', extra: { error?: string; provider_ref?: string; media_path?: string }) => {
        await supabaseAdmin.from('po_vendor_notifications').insert({
            organization_id: po.orgId, po_id: po.poId, zoho_po_id: po.zohoPoId, template: PO_APPROVED_TEMPLATE, status, sent_to_last4: last4, params,
            media_path: extra.media_path ?? null, provider_ref: extra.provider_ref ?? null, error: extra.error?.slice(0, 500) ?? null,
            sent_by: opts.byUserId ?? null, trigger: opts.trigger, mode: opts.mode,
        });
    };

    if (!phone) {
        const error = opts.mode === 'test'
            ? 'Set the test phone number first.'
            : 'This vendor has no WhatsApp number on file. Add it to the vendor in Zoho, then send it again.';
        await record(opts.mode === 'test' ? 'failed' : 'no_phone', { error });
        return { ok: false, status: opts.mode === 'test' ? 'failed' : 'no_phone', error, params };
    }

    const pdf = await rehostPoPdf(po.orgId, z, { key: po.poId ?? `zoho-${po.zohoPoId}`, po_number: po.poNumber, zoho_po_id: po.zohoPoId });
    if ('error' in pdf) { await record('failed', { error: pdf.error }); return { ok: false, status: 'failed', error: pdf.error, params, to_last4: last4 ?? undefined }; }

    // A day is plenty: AiSensy fetches the file when it sends. The link names a private object and then dies.
    const { data: signed } = await supabaseAdmin.storage.from(INVOICE_BUCKET).createSignedUrl(pdf.path, 24 * 3600);
    if (!signed?.signedUrl) { const error = 'Could not create a link to the PO PDF.'; await record('failed', { error, media_path: pdf.path }); return { ok: false, status: 'failed', error, params }; }

    const sent = await AiSensyService.sendTemplate({
        phone, campaignName: PO_APPROVED_TEMPLATE, userName: po.vendorName || 'Vendor', templateParams: params,
        mediaUrl: signed.signedUrl, mediaFilename: `${po.poNumber.replace(/[^\w.-]+/g, '-')}.pdf`,
    });
    if (!sent.success) {
        const error = sent.error ?? 'WhatsApp send failed';
        await record('failed', { error, media_path: pdf.path });
        return { ok: false, status: 'failed', error, params, to_last4: last4 ?? undefined, media_path: pdf.path };
    }

    await record('sent', { provider_ref: sent.providerReference, media_path: pdf.path });
    if (po.poId) {
        await logPoActivity({ organizationId: po.orgId, poId: po.poId, action: 'comment', actorId: opts.byUserId ?? null, note: `Approved-PO WhatsApp sent (${opts.mode === 'live' ? 'to the vendor' : 'test number'}, number ending ${last4})`, detail: { template: PO_APPROVED_TEMPLATE, trigger: opts.trigger, mode: opts.mode } });
    }
    return { ok: true, status: 'sent', params, to_last4: last4 ?? undefined, media_path: pdf.path };
}

/**
 * The manual buttons. "Simulate approval" always goes to the test number. "Resend" follows the
 * switch: the vendor's own number when it is Live, otherwise the test number.
 */
export async function sendApprovedPoNotice(orgId: string, poId: string, byUserId: string | null, trigger: 'manual' | 'simulation' = 'manual'): Promise<SendResult> {
    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name, vendor_id, po_amount, po_date, zoho_po_id').eq('id', poId).eq('organization_id', orgId).maybeSingle();
    if (!po) return { ok: false, error: 'PO not found.' };
    const { data: settings } = await supabaseAdmin.from('po_notify_settings').select('auto_mode').eq('organization_id', orgId).maybeSingle();
    const mode = noticeModeFor(trigger, settings?.auto_mode);
    const r = await sendNotice({ orgId, poId: po.id, zohoPoId: po.zoho_po_id ?? '', poNumber: po.po_number, vendorName: po.vendor_name ?? 'Vendor', zohoVendorId: po.vendor_id, poTotal: Number(po.po_amount ?? 0), poDate: po.po_date }, { mode, trigger, byUserId });
    if (r.status === 'sent' && po.zoho_po_id) {
        await supabaseAdmin.from('po_approval_watch').update({ state: 'notified', updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('zoho_po_id', po.zoho_po_id).in('state', ['no_phone', 'failed']);
    }
    return r;
}

/** Record the simulated approval and start the 48-hour clock. Idempotent: a second call keeps the first. */
export async function recordSimulatedApproval(orgId: string, poId: string, byUserId: string): Promise<{ ok: true; invoice_due_at: string; already: boolean } | { ok: false; status: number; error: string }> {
    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, status, po_number').eq('id', poId).eq('organization_id', orgId).maybeSingle();
    if (!po) return { ok: false, status: 404, error: 'PO not found.' };
    const { data: existing } = await supabaseAdmin.from('po_simulated_approvals').select('invoice_due_at').eq('po_id', poId).maybeSingle();
    if (existing) return { ok: true, invoice_due_at: existing.invoice_due_at, already: true };
    if (!SIMULATABLE.has((po.status ?? '').toLowerCase())) {
        return { ok: false, status: 409, error: `This PO is "${po.status}" in Zoho. Only a PO waiting for approval can be simulated.` };
    }
    const due = new Date(Date.now() + INVOICE_DUE_HOURS * 3_600_000).toISOString();
    const { error } = await supabaseAdmin.from('po_simulated_approvals').insert({ organization_id: orgId, po_id: poId, simulated_by: byUserId, invoice_due_at: due });
    if (error) return { ok: false, status: 500, error: error.message };
    await logPoActivity({ organizationId: orgId, poId, action: 'comment', actorId: byUserId, note: 'Approval SIMULATED in this app (Zoho unchanged). Invoice due within 48 hours.', detail: { simulated: true, invoice_due_at: due } });
    return { ok: true, invoice_due_at: due, already: false };
}
