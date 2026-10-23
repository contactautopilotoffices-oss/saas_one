import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { INVOICE_DUE_HOURS, sendNotice, zohoContext, zohoGet, type NoticeMode, type ZohoCtx } from './poApproval';

/**
 * Notice that the founder approved a PO in Zoho, and WhatsApp the vendor the approved PO.
 *
 * Run every 10 minutes (app/api/cron/po-approval-watch) and, optionally, by a Zoho webhook the
 * moment a PO is approved. Cheap by design: when nothing has changed it makes 1 to 3 small
 * read-only Zoho list calls and returns.
 *
 * WHICH POs MAY BE MESSAGED
 *   - one the job SAW waiting for approval, which later turned approved; or
 *   - one created after the switch was turned on (so a PO approved within one 10-minute gap,
 *     before it was ever seen waiting, is still caught).
 *   Nothing else. The 3,455 POs already approved are never touched.
 *
 * THE SWITCH (po_notify_settings.auto_mode): off does nothing, test sends to the test number,
 * live sends to the vendor's own number. One automatic message per PO, ever: the database has a
 * unique index on it, and a PO is claimed before it is sent.
 */

export interface WatchSummary {
    mode: string; pendingSeen: number; approvedFound: number; notified: number; noPhone: number; failed: number; skipped: number; ms: number; error?: string;
}

interface ListItem { purchaseorder_id: string; purchaseorder_number: string; status: string; created_time?: string; last_modified_time?: string }
const MAX_PAGES = 4;
const MAX_DETAIL_PER_RUN = 25;
const MAX_ATTEMPTS = 3;

async function listPos(z: ZohoCtx, params: Record<string, string>): Promise<ListItem[] | null> {
    const out: ListItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await zohoGet(z, 'purchaseorders', { ...params, per_page: '200', page: String(page) });
        if (!res.ok) return null;
        const d = await res.json().catch(() => null) as { purchaseorders?: ListItem[]; page_context?: { has_more_page?: boolean } } | null;
        if (!d) return null;
        out.push(...(d.purchaseorders ?? []));
        if (!d.page_context?.has_more_page) break;
    }
    return out;
}

interface ZohoPo {
    purchaseorder_id: string; purchaseorder_number: string; status: string; vendor_id?: string; vendor_name?: string; date?: string; total?: number; created_time?: string;
}

/** Handle ONE PO that Zoho now says is approved. Safe to call twice: the second call finds it already claimed or sent. */
export async function handleApprovedPo(orgId: string, z: ZohoCtx, zohoPoId: string, mode: NoticeMode, autoSince: string | null): Promise<'notified' | 'no_phone' | 'failed' | 'skipped' | 'already' | 'error'> {
    const res = await zohoGet(z, `purchaseorders/${encodeURIComponent(zohoPoId)}`);
    const po = (await res.json().catch(() => null) as { purchaseorder?: ZohoPo } | null)?.purchaseorder;
    // Zoho busy or down (429/5xx, bad body): not an answer. Leave the PO watched and try next run.
    if (!res.ok || !po) return 'error';
    if (po.status !== 'approved') return 'skipped';

    const { data: watch } = await supabaseAdmin.from('po_approval_watch').select('state, attempts, seen_pending_at').eq('organization_id', orgId).eq('zoho_po_id', zohoPoId).maybeSingle();
    const createdAfter = !!(autoSince && po.created_time && new Date(po.created_time).getTime() >= new Date(autoSince).getTime());
    if (!watch && !createdAfter) return 'skipped';
    if (watch && ['notified', 'sending', 'skipped'].includes(watch.state)) return 'already';
    if (watch?.state === 'failed' && watch.attempts >= MAX_ATTEMPTS) return 'already';
    // A PO that was already messaged (manually or by a webhook a moment ago) is never messaged again automatically.
    const { count: sentBefore } = await supabaseAdmin.from('po_vendor_notifications').select('id', { count: 'exact', head: true }).eq('zoho_po_id', zohoPoId).eq('status', 'sent').eq('trigger', 'auto');
    if ((sentBefore ?? 0) > 0) return 'already';

    const now = new Date();
    // Claim it: a second overlapping run finds state 'sending' and leaves it alone.
    const base = { organization_id: orgId, zoho_po_id: zohoPoId, po_number: po.purchaseorder_number, approved_detected_at: now.toISOString(), invoice_due_at: new Date(now.getTime() + INVOICE_DUE_HOURS * 3_600_000).toISOString(), updated_at: now.toISOString() };
    if (!watch) {
        const { error } = await supabaseAdmin.from('po_approval_watch').insert({ ...base, state: 'sending', attempts: 1 });
        if (error) return 'already';
    } else {
        const { data: claimed } = await supabaseAdmin.from('po_approval_watch').update({ ...base, state: 'sending', attempts: (watch.attempts ?? 0) + 1 })
            .eq('organization_id', orgId).eq('zoho_po_id', zohoPoId).in('state', ['pending', 'failed', 'no_phone']).select('id').maybeSingle();
        if (!claimed) return 'already';
    }

    const { data: local } = await supabaseAdmin.from('zoho_purchase_orders').select('id').eq('organization_id', orgId).eq('zoho_po_id', zohoPoId).maybeSingle();
    const r = await sendNotice(
        { orgId, poId: local?.id ?? null, zohoPoId, poNumber: po.purchaseorder_number, vendorName: po.vendor_name ?? 'Vendor', zohoVendorId: po.vendor_id ?? null, poTotal: Number(po.total ?? 0), poDate: po.date ?? null },
        { mode, trigger: 'auto' },
    );
    const state = r.status === 'sent' ? 'notified' : r.status === 'no_phone' ? 'no_phone' : 'failed';
    await supabaseAdmin.from('po_approval_watch').update({ state, note: r.ok ? null : (r.error ?? '').slice(0, 300), updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('zoho_po_id', zohoPoId);
    return state === 'notified' ? 'notified' : state;
}

export async function runPoApprovalWatch(orgId: string): Promise<WatchSummary> {
    const t0 = Date.now();
    const empty = (mode: string, extra: Partial<WatchSummary> = {}): WatchSummary => ({ mode, pendingSeen: 0, approvedFound: 0, notified: 0, noPhone: 0, failed: 0, skipped: 0, ms: Date.now() - t0, ...extra });

    const { data: settings } = await supabaseAdmin.from('po_notify_settings').select('auto_mode, auto_since, last_run_at').eq('organization_id', orgId).maybeSingle();
    const mode = settings?.auto_mode ?? 'off';
    if (mode !== 'test' && mode !== 'live') return empty('off');
    const z = await zohoContext(orgId);
    // A run that could not start still says so on the settings screen (last_run_at is kept, so nothing is skipped).
    const failRun = async (error: string) => { const out = empty(mode, { error }); await supabaseAdmin.from('po_notify_settings').update({ last_run_summary: out }).eq('organization_id', orgId); return out; };
    if (!z) return failRun('Could not sign in to Zoho Books.');

    const sum = empty(mode);
    try {
        // 1. Who is waiting for approval right now? Remember them: only these can be messaged later.
        const pending = await listPos(z, { status: 'pending_approval' });
        if (!pending) return failRun('Zoho did not answer the pending-approval list.');
        sum.pendingSeen = pending.length;
        if (pending.length) {
            const nowIso = new Date().toISOString();
            await supabaseAdmin.from('po_approval_watch').upsert(
                pending.map((p) => ({ organization_id: orgId, zoho_po_id: p.purchaseorder_id, po_number: p.purchaseorder_number, seen_pending_at: nowIso, state: 'pending', updated_at: nowIso })),
                { onConflict: 'organization_id,zoho_po_id', ignoreDuplicates: true },
            );
        }

        // 2. Approved since the last look (with a 15-minute overlap so a slow run cannot drop one).
        const since = new Date((settings?.last_run_at ? new Date(settings.last_run_at).getTime() : Date.now() - 3_600_000) - 15 * 60_000);
        const sinceStr = since.toISOString().replace(/\.\d+Z$/, '+0000');
        const approved = await listPos(z, { status: 'approved', last_modified_time: sinceStr });
        const candidates = new Set<string>((approved ?? []).map((p) => p.purchaseorder_id));
        sum.approvedFound = candidates.size;

        // 3. Anything we were watching that has left the pending list: approved, cancelled, or rejected.
        const pendingIds = new Set(pending.map((p) => p.purchaseorder_id));
        const { data: watched } = await supabaseAdmin.from('po_approval_watch').select('zoho_po_id').eq('organization_id', orgId).eq('state', 'pending').limit(500);
        for (const w of watched ?? []) if (!pendingIds.has(w.zoho_po_id)) candidates.add(w.zoho_po_id);
        // Retry sends that failed for a provider reason (not "no phone": that needs a person).
        const { data: retry } = await supabaseAdmin.from('po_approval_watch').select('zoho_po_id').eq('organization_id', orgId).eq('state', 'failed').lt('attempts', MAX_ATTEMPTS).limit(10);
        for (const w of retry ?? []) candidates.add(w.zoho_po_id);

        let handled = 0;
        for (const id of candidates) {
            if (handled >= MAX_DETAIL_PER_RUN) break;
            handled++;
            const r = await handleApprovedPo(orgId, z, id, mode, settings?.auto_since ?? null);
            if (r === 'error') { sum.error = 'Zoho did not answer for some POs; they stay watched and are retried next run.'; continue; }
            if (r === 'notified') sum.notified++; else if (r === 'no_phone') sum.noPhone++; else if (r === 'failed') sum.failed++; else if (r === 'skipped') {
                // Left the pending list but is not approved: cancelled or rejected. Stop watching it.
                await supabaseAdmin.from('po_approval_watch').update({ state: 'skipped', updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('zoho_po_id', id).eq('state', 'pending');
                sum.skipped++;
            }
        }
    } catch (e) {
        sum.error = e instanceof Error ? e.message : String(e);
    }
    sum.ms = Date.now() - t0;
    await supabaseAdmin.from('po_notify_settings').update({ last_run_at: new Date().toISOString(), last_run_summary: sum }).eq('organization_id', orgId);
    return sum;
}
