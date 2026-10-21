import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { extractInvoice } from './extract';
import { matchInvoice, summariseMatch, type MatchInput } from './match';
import { loadInvoiceSettings } from './settings';
import { downloadObject, detectContentType } from './storage';
import { logInvoiceEvent } from './audit';
import { syncDocumentationState } from './docState';

/**
 * Turning a stored submission into a verdict, in two steps that can run apart:
 *
 *   processInvoice  read the file (OCR / model), store the reading, then match
 *   runMatching     compare the CURRENT working values with the PO, store the outcome
 *
 * After a person corrects a value only runMatching runs. Each run writes a new set of
 * rule rows and retires the old set rather than deleting it, so the first mismatch stays
 * on record. A person's override survives a re-run only if the rule fails in exactly the
 * same way again.
 */

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export async function runMatching(invoiceId: string, actorUserId?: string | null): Promise<{ matchStatus: string; rules: number } | { error: string }> {
    const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
    if (!inv) return { error: 'Invoice not found' };
    const orgId: string = inv.organization_id;

    const [{ data: lineRows }, { data: po }, { data: poLineRows }, settings] = await Promise.all([
        supabaseAdmin.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('line_no'),
        supabaseAdmin.from('zoho_purchase_orders').select('id, status, po_amount, vendor_name, vendor_id').eq('id', inv.po_id).eq('organization_id', orgId).maybeSingle(),
        supabaseAdmin.from('zoho_po_line_items').select('id, item_id, name, description, hsn_or_sac, unit, quantity, rate, tax_percentage').eq('po_id', inv.po_id).order('item_order').limit(500),
        loadInvoiceSettings(orgId),
    ]);
    if (!po) return { error: 'PO not found' };

    // The vendor's GSTIN on record: by Zoho contact id when the PO has one, else by exact name.
    let vendorGstin: string | null = null;
    {
        const q = supabaseAdmin.from('vendor_profiles').select('gstin').eq('organization_id', orgId);
        const { data: vp } = po.vendor_id
            ? await q.eq('zoho_vendor_id', po.vendor_id).limit(1).maybeSingle()
            : await q.ilike('vendor_name', po.vendor_name ?? '').limit(1).maybeSingle();
        vendorGstin = vp?.gstin ?? null;
    }

    const { data: priorRows } = await supabaseAdmin.from('invoices')
        .select('id, invoice_total').eq('po_id', inv.po_id).neq('id', invoiceId)
        .not('review_status', 'in', '(rejected,resubmission_required)');
    const priorIds = (priorRows ?? []).map((p) => p.id);
    const priorLineQty: Record<string, number> = {};
    if (priorIds.length) {
        const { data: pl } = await supabaseAdmin.from('invoice_line_items')
            .select('po_line_item_id, quantity').in('invoice_id', priorIds).not('po_line_item_id', 'is', null);
        for (const r of pl ?? []) priorLineQty[r.po_line_item_id] = (priorLineQty[r.po_line_item_id] ?? 0) + (num(r.quantity) ?? 0);
    }

    const duplicates: MatchInput['duplicates'] = [];
    if (inv.invoice_number_norm && inv.vendor_key) {
        const { data: same } = await supabaseAdmin.from('invoices')
            .select('id, invoice_number, invoice_total').eq('organization_id', orgId).eq('vendor_key', inv.vendor_key)
            .eq('invoice_number_norm', inv.invoice_number_norm).neq('id', invoiceId)
            .not('review_status', 'in', '(rejected,resubmission_required)');
        for (const d of same ?? []) duplicates.push({ id: d.id, reason: 'same_number', invoice_number: d.invoice_number, invoice_total: num(d.invoice_total) });
    }
    {
        const { data: mine } = await supabaseAdmin.from('invoice_documents').select('sha256_hash').eq('invoice_id', invoiceId);
        const hashes = (mine ?? []).map((d) => d.sha256_hash);
        if (hashes.length) {
            const { data: same } = await supabaseAdmin.from('invoice_documents')
                .select('invoice_id, invoices!inner(id, invoice_number, invoice_total, review_status)')
                .eq('organization_id', orgId).in('sha256_hash', hashes).neq('invoice_id', invoiceId);
            for (const d of (same ?? []) as unknown as { invoice_id: string; invoices: { invoice_number: string | null; invoice_total: unknown; review_status: string } }[]) {
                if (['rejected', 'resubmission_required'].includes(d.invoices.review_status)) continue;
                if (!duplicates.some((x) => x.id === d.invoice_id)) {
                    duplicates.push({ id: d.invoice_id, reason: 'same_file', invoice_number: d.invoices.invoice_number, invoice_total: num(d.invoices.invoice_total) });
                }
            }
        }
    }

    const fieldConfidence = ((inv.extracted as { field_confidence?: Record<string, number> } | null)?.field_confidence) ?? {};
    // A person who has corrected the values has, in effect, vouched for them.
    const corrected = !!inv.corrected_at;
    const confidence = corrected
        ? { invoice_number: 100, invoice_date: 100, taxable_amount: 100, invoice_total: 100, vendor: 100 }
        : fieldConfidence;

    const out = matchInvoice({
        po: { status: po.status, amount: num(po.po_amount), vendor_name: po.vendor_name },
        poLines: (poLineRows ?? []).map((p) => ({
            id: p.id, item_id: p.item_id, name: p.name, description: p.description, hsn_or_sac: p.hsn_or_sac, unit: p.unit,
            quantity: num(p.quantity), rate: num(p.rate), tax_percentage: num(p.tax_percentage),
        })),
        vendorGstin,
        invoice: {
            invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, vendor_name_read: inv.vendor_name_read,
            vendor_gstin_read: inv.vendor_gstin_read, taxable_amount: num(inv.taxable_amount), tax_amount: num(inv.tax_amount),
            other_charges: num(inv.other_charges), discount_amount: num(inv.discount_amount), invoice_total: num(inv.invoice_total),
            field_confidence: confidence,
            extraction_ok: inv.extraction_status === 'completed' || corrected,
        },
        lines: (lineRows ?? []).map((l) => ({
            line_no: l.line_no, description: l.description, item_code: l.item_code, hsn_or_sac: l.hsn_or_sac,
            quantity: num(l.quantity), unit: l.unit, unit_rate: num(l.unit_rate), taxable_amount: num(l.taxable_amount),
            tax_rate: num(l.tax_rate), tax_amount: num(l.tax_amount), line_total: num(l.line_total),
        })),
        priorInvoices: (priorRows ?? []).map((p) => ({ id: p.id, invoice_total: num(p.invoice_total) })),
        priorLineQty, duplicates, settings,
        today: new Date().toISOString().slice(0, 10),
    });

    // Previous run: retire it, but remember which of its rows a person had resolved.
    const { data: previous } = await supabaseAdmin.from('invoice_validation_results')
        .select('rule_code, invoice_line_no, po_line_item_id, actual_value, original_outcome, resolved_by, resolution_note, resolved_at')
        .eq('invoice_id', invoiceId).eq('is_current', true).not('resolved_at', 'is', null);
    const sig = (r: { rule_code: string; invoice_line_no?: number | null; po_line_item_id?: string | null; actual?: unknown; actual_value?: unknown }) =>
        JSON.stringify([r.rule_code, r.invoice_line_no ?? null, r.po_line_item_id ?? null, r.actual ?? r.actual_value ?? null]);
    const carried = new Map((previous ?? []).map((p) => [sig(p), p]));

    const runId = crypto.randomUUID();
    await supabaseAdmin.from('invoice_validation_results').update({ is_current: false }).eq('invoice_id', invoiceId).eq('is_current', true);
    const rows = out.results.map((r) => {
        const keep = r.outcome === 'pass' ? undefined : carried.get(sig(r));
        return {
            organization_id: orgId, invoice_id: invoiceId, run_id: runId, is_current: true,
            rule_code: r.rule_code, severity: r.severity, outcome: r.outcome,
            invoice_line_no: r.invoice_line_no ?? null, po_line_item_id: r.po_line_item_id ?? null,
            expected_value: r.expected ?? null, actual_value: r.actual ?? null,
            difference_amount: r.difference ?? null, explanation: r.explanation,
            original_outcome: keep?.original_outcome ?? null, resolved_by: keep?.resolved_by ?? null,
            resolution_note: keep?.resolution_note ?? null, resolved_at: keep?.resolved_at ?? null,
        };
    });
    if (rows.length) {
        const { error } = await supabaseAdmin.from('invoice_validation_results').insert(rows);
        if (error) return { error: `Could not store the validation result: ${error.message}` };
    }

    for (const l of lineRows ?? []) {
        const mapped = out.lineMapping[l.line_no] ?? null;
        if ((l.po_line_item_id ?? null) !== mapped) await supabaseAdmin.from('invoice_line_items').update({ po_line_item_id: mapped }).eq('id', l.id);
    }

    const status = summariseMatch(rows.map((r) => ({ rule_code: r.rule_code, severity: r.severity as 'blocking', outcome: r.outcome as 'pass', resolved: !!r.resolved_at })));
    await supabaseAdmin.from('invoices').update({
        match_status: status,
        duplicate_of: status === 'duplicate_suspected' ? duplicates[0]?.id ?? null : null,
        policy_version: settings.policy_version,
        updated_at: new Date().toISOString(),
    }).eq('id', invoiceId);

    await logInvoiceEvent({
        organizationId: orgId, invoiceId, poId: inv.po_id, actorUserId: actorUserId ?? null, actorType: actorUserId ? 'user' : 'system',
        eventType: 'invoice_validated', correlationId: runId,
        details: { match_status: status, failed: out.results.filter((r) => r.outcome === 'fail').length, unknown: out.results.filter((r) => r.outcome === 'unknown').length, policy_version: settings.policy_version },
    });
    await syncDocumentationState(orgId, inv.po_id);
    return { matchStatus: status, rules: rows.length };
}

/** Read the stored file, save what was read, then match. Never throws; failures stay recoverable. */
export async function processInvoice(invoiceId: string, actorUserId?: string | null): Promise<{ ok: boolean; status?: string; error?: string }> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const { data: claimed } = await supabaseAdmin.from('invoices')
        .update({ extraction_status: 'processing', extraction_error: null, updated_at: new Date().toISOString() })
        .eq('id', invoiceId).or(`extraction_status.neq.processing,updated_at.lt.${staleBefore}`)
        .select('*').maybeSingle();
    if (!claimed) return { ok: false, error: 'This invoice is already being processed.' };
    const inv = claimed;

    const { data: doc } = await supabaseAdmin.from('invoice_documents').select('storage_path, content_type')
        .eq('invoice_id', invoiceId).order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
    if (!doc) return fail(inv, 'No document is stored for this invoice.');

    const bytes = await downloadObject(doc.storage_path);
    if (!bytes) return fail(inv, 'The stored file could not be read.');
    const type = detectContentType(bytes);
    if (!type) return fail(inv, 'The stored file is not a PDF, JPEG or PNG.');

    const read = await extractInvoice(bytes, type);
    if (!read.ok || !read.extracted) return fail(inv, read.error ?? 'The invoice could not be read.', { provider: read.provider, model: read.model });
    const x = read.extracted;

    // Vendor-typed number/date are hints. The reading wins; the hint is kept beside it.
    const hint = { invoice_number: inv.invoice_number as string | null, invoice_date: inv.invoice_date as string | null };
    const keepHuman = !!inv.corrected_at;
    const orgId: string = inv.organization_id;
    const header = keepHuman ? {} : {
        invoice_number: x.invoice_number ?? hint.invoice_number,
        invoice_number_norm: (x.invoice_number ?? hint.invoice_number)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
        invoice_date: x.invoice_date ?? hint.invoice_date,
        vendor_name_read: x.vendor_name, vendor_gstin_read: x.vendor_gstin,
        currency: x.currency && /^[A-Z]{3}$/.test(x.currency) ? x.currency : 'INR',
        taxable_amount: x.taxable_amount, tax_amount: x.tax_amount, other_charges: x.other_charges,
        discount_amount: x.discount_amount, invoice_total: x.invoice_total,
    };
    const { error: upErr } = await supabaseAdmin.from('invoices').update({
        ...header,
        extracted: { ...x, vendor_hint: hint, path: read.path },
        extraction_provider: read.provider, extraction_model: read.model,
        extraction_status: 'completed', extraction_error: null, updated_at: new Date().toISOString(),
    }).eq('id', invoiceId);
    if (upErr) return fail(inv, `Could not save the reading: ${upErr.message}`);

    if (!keepHuman) {
        await supabaseAdmin.from('invoice_line_items').delete().eq('invoice_id', invoiceId);
        if (x.lines.length) {
            await supabaseAdmin.from('invoice_line_items').insert(x.lines.map((l, i) => ({
                organization_id: orgId, invoice_id: invoiceId, line_no: i + 1, description: l.description.slice(0, 500),
                item_code: l.item_code, hsn_or_sac: l.hsn_or_sac, quantity: l.quantity, unit: l.unit, unit_rate: l.unit_rate,
                taxable_amount: l.taxable_amount, tax_rate: l.tax_rate, tax_amount: l.tax_amount, line_total: l.line_total,
                extraction_confidence: l.confidence,
            })));
        }
    }

    await logInvoiceEvent({ organizationId: orgId, invoiceId, poId: inv.po_id, actorUserId: actorUserId ?? null, actorType: actorUserId ? 'user' : 'system',
        eventType: 'invoice_extracted', details: { provider: read.provider, model: read.model, path: read.path, lines: x.lines.length } });

    const m = await runMatching(invoiceId, actorUserId);
    if ('error' in m) return { ok: false, error: m.error };
    return { ok: true, status: m.matchStatus };
}

async function fail(inv: { id: string; organization_id: string; po_id: string }, error: string, who: { provider?: string; model?: string } = {}) {
    await supabaseAdmin.from('invoices').update({
        extraction_status: 'failed', extraction_error: error.slice(0, 500),
        extraction_provider: who.provider ?? null, extraction_model: who.model ?? null, updated_at: new Date().toISOString(),
    }).eq('id', inv.id);
    await logInvoiceEvent({ organizationId: inv.organization_id, invoiceId: inv.id, poId: inv.po_id, actorType: 'system', eventType: 'invoice_extraction_failed', details: { error } });
    // Even a failed read gets a verdict, so the invoice lands in the review queue with a reason.
    await runMatching(inv.id);
    return { ok: false, error };
}
