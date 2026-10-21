/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * Review decisions on one invoice.
 *
 * POST { org_id, action, ... }
 *   start                        pending -> in_review
 *   correct   {header?, lines?, reason}   a person fixes what was misread; the engine re-runs
 *   resolve   {validation_id, note}       override ONE rule outcome; the original outcome is kept
 *   accept    {note?}                     Accounts accepts a matched invoice
 *   reject    {reason}                    refuse it
 *   request_resubmission {reason}         ask the vendor for a new document (issue a new link)
 *
 * Nothing here ever edits the stored document or an old rule row's outcome.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError, forbidden, type InvoiceAccess } from '@/backend/lib/invoices/access';
import { runMatching } from '@/backend/lib/invoices/process';
import { summariseMatch } from '@/backend/lib/invoices/match';
import { logInvoiceEvent } from '@/backend/lib/invoices/audit';
import { syncDocumentationState } from '@/backend/lib/invoices/docState';
import { isUuid } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEADER_NUMBERS = ['taxable_amount', 'tax_amount', 'other_charges', 'discount_amount', 'invoice_total'] as const;
const LINE_NUMBERS = ['quantity', 'unit_rate', 'taxable_amount', 'tax_rate', 'tax_amount', 'line_total'] as const;

const money = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e12 ? Math.round(n * 100) / 100 : undefined;
};
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return bad('Invalid JSON body');
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    if (!isUuid(id)) return bad('Invoice not found.', 404);

    const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!inv) return bad('Invoice not found.', 404);
    const closed = ['accepted', 'rejected', 'resubmission_required'].includes(inv.review_status);
    const log = (eventType: string, details: Record<string, unknown>) =>
        logInvoiceEvent({ organizationId: a.orgId, invoiceId: id, poId: inv.po_id, actorUserId: a.userId, actorRole: a.roles[0], eventType, details });

    switch (body.action) {
        case 'start': {
            if (!a.canResolveSoft && !a.canAccept) return forbidden();
            if (inv.review_status !== 'pending') return NextResponse.json({ review_status: inv.review_status });
            await supabaseAdmin.from('invoices').update({ review_status: 'in_review', updated_at: new Date().toISOString() }).eq('id', id).eq('review_status', 'pending');
            await log('review_started', {});
            return NextResponse.json({ review_status: 'in_review' });
        }

        case 'correct': return correct(a, inv, body, closed, log);

        case 'resolve': {
            if (closed) return bad(`This invoice is already ${inv.review_status.replace(/_/g, ' ')}.`, 409);
            const note = String(body.note ?? '').trim();
            if (note.length < 5) return bad('Say why this is acceptable (at least 5 characters).');
            if (!isUuid(body.validation_id)) return bad('validation_id is required.');
            const { data: rule } = await supabaseAdmin.from('invoice_validation_results').select('*')
                .eq('id', body.validation_id).eq('invoice_id', id).eq('is_current', true).maybeSingle();
            if (!rule) return bad('That check is not on the current result. Refresh and try again.', 404);
            if (rule.outcome === 'pass') return bad('That check already passed.', 409);
            if (rule.resolved_at) return bad('That check was already resolved.', 409);
            // A hard financial or identity failure needs a manager; softer issues need any purchase/accounts user.
            const needsManager = rule.severity === 'blocking' || rule.rule_code === 'DUPLICATE_CHECK';
            if (needsManager ? !a.canResolveBlocking : !a.canResolveSoft) return forbidden(needsManager ? 'Only a Purchase Manager or admin can resolve a blocking issue.' : undefined);

            const { error } = await supabaseAdmin.from('invoice_validation_results').update({
                original_outcome: rule.outcome, resolved_by: a.userId, resolution_note: note, resolved_at: new Date().toISOString(),
            }).eq('id', rule.id).is('resolved_at', null);
            if (error) return bad(error.message, 500);

            const { data: current } = await supabaseAdmin.from('invoice_validation_results').select('rule_code, severity, outcome, resolved_at').eq('invoice_id', id).eq('is_current', true);
            const status = summariseMatch((current ?? []).map((r) => ({ rule_code: r.rule_code, severity: r.severity, outcome: r.outcome, resolved: !!r.resolved_at })));
            await supabaseAdmin.from('invoices').update({ match_status: status, ...(status !== 'duplicate_suspected' ? { duplicate_of: null } : {}), updated_at: new Date().toISOString() }).eq('id', id);
            await log('issue_resolved', { rule_code: rule.rule_code, original_outcome: rule.outcome, severity: rule.severity, note, validation_id: rule.id, resulting_match_status: status });
            await syncDocumentationState(a.orgId, inv.po_id);
            return NextResponse.json({ match_status: status });
        }

        case 'accept': {
            if (!a.canAccept) return forbidden('Only Accounts can accept an invoice.');
            if (closed) return bad(`This invoice is already ${inv.review_status.replace(/_/g, ' ')}.`, 409);
            if (inv.match_status !== 'matched') return bad('Only a matched invoice can be accepted. Resolve or correct the open issues first.', 409);
            if (['pending', 'processing', 'failed'].includes(inv.extraction_status) && !inv.corrected_at) return bad('The invoice has not been read yet.', 409);
            await supabaseAdmin.from('invoices').update({ review_status: 'accepted', reviewed_by: a.userId, reviewed_at: new Date().toISOString(), review_note: String(body.note ?? '').slice(0, 500) || null, updated_at: new Date().toISOString() }).eq('id', id);
            await log('invoice_accepted', { note: body.note ?? null, total: inv.invoice_total, policy_version: a.settings.policy_version });
            await syncDocumentationState(a.orgId, inv.po_id);
            return NextResponse.json({ review_status: 'accepted' });
        }

        case 'reject':
        case 'request_resubmission': {
            if (!a.canResolveSoft) return forbidden();
            if (inv.review_status === 'accepted') return bad('An accepted invoice cannot be rejected.', 409);
            if (closed) return bad(`This invoice is already ${inv.review_status.replace(/_/g, ' ')}.`, 409);
            const reason = String(body.reason ?? '').trim();
            if (reason.length < 5) return bad('Give a reason (at least 5 characters).');
            const next = body.action === 'reject' ? 'rejected' : 'resubmission_required';
            await supabaseAdmin.from('invoices').update({ review_status: next, reviewed_by: a.userId, reviewed_at: new Date().toISOString(), review_note: reason.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id);
            await log(next === 'rejected' ? 'invoice_rejected' : 'resubmission_requested', { reason });
            await syncDocumentationState(a.orgId, inv.po_id);
            return NextResponse.json({ review_status: next });
        }

        default: return bad('Unknown action.');
    }
}

async function correct(a: InvoiceAccess, inv: Record<string, any>, body: Record<string, any>, closed: boolean, log: (t: string, d: Record<string, unknown>) => Promise<void>) {
    if (!a.canResolveSoft) return forbidden();
    if (closed) return bad(`This invoice is already ${String(inv.review_status).replace(/_/g, ' ')}.`, 409);
    const reason = String(body.reason ?? '').trim();
    if (reason.length < 5) return bad('Say what you corrected and why (at least 5 characters).');

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const h = (body.header ?? {}) as Record<string, any>;
    for (const f of HEADER_NUMBERS) {
        if (!(f in h)) continue;
        const v = money(h[f]);
        if (v === undefined) return bad(`${f.replace(/_/g, ' ')} is not a valid amount.`);
        patch[f] = v; before[f] = inv[f];
    }
    if ('invoice_number' in h) {
        const n = String(h.invoice_number ?? '').trim().slice(0, 60) || null;
        patch.invoice_number = n; patch.invoice_number_norm = n ? n.toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null; before.invoice_number = inv.invoice_number;
    }
    if ('invoice_date' in h) {
        const d = h.invoice_date ? String(h.invoice_date) : null;
        if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) return bad('invoice_date must be YYYY-MM-DD.');
        patch.invoice_date = d; before.invoice_date = inv.invoice_date;
    }
    if ('vendor_gstin_read' in h) {
        const g = String(h.vendor_gstin_read ?? '').toUpperCase().replace(/\s+/g, '');
        if (g && !/^[0-9A-Z]{15}$/.test(g)) return bad('A GSTIN is 15 letters and digits.');
        patch.vendor_gstin_read = g || null; before.vendor_gstin_read = inv.vendor_gstin_read;
    }
    if ('vendor_name_read' in h) { patch.vendor_name_read = String(h.vendor_name_read ?? '').trim().slice(0, 200) || null; before.vendor_name_read = inv.vendor_name_read; }

    let newLines: Record<string, unknown>[] | null = null;
    if (Array.isArray(body.lines)) {
        if (body.lines.length > 200) return bad('Too many lines.');
        newLines = [];
        for (const [i, raw] of (body.lines as Record<string, any>[]).entries()) {
            const description = String(raw?.description ?? '').trim().slice(0, 500);
            if (!description) return bad(`Line ${i + 1} needs a description.`);
            const row: Record<string, unknown> = {
                organization_id: a.orgId, invoice_id: inv.id, line_no: i + 1, description,
                item_code: String(raw.item_code ?? '').trim().slice(0, 80) || null,
                hsn_or_sac: String(raw.hsn_or_sac ?? '').trim().slice(0, 20) || null,
                unit: String(raw.unit ?? '').trim().slice(0, 20) || null,
            };
            for (const f of LINE_NUMBERS) {
                const v = raw[f] === undefined || raw[f] === null || raw[f] === '' ? null : Number(raw[f]);
                if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e12)) return bad(`Line ${i + 1}: ${f.replace(/_/g, ' ')} is not a valid number.`);
                row[f] = v;
            }
            newLines.push(row);
        }
    }
    if (!Object.keys(patch).length && !newLines) return bad('Nothing to correct.');

    if (newLines) {
        await supabaseAdmin.from('invoice_line_items').delete().eq('invoice_id', inv.id);
        if (newLines.length) {
            const { error } = await supabaseAdmin.from('invoice_line_items').insert(newLines);
            if (error) return bad(error.message, 500);
        }
    }
    const { error } = await supabaseAdmin.from('invoices').update({ ...patch, corrected_by: a.userId, corrected_at: new Date().toISOString(), review_status: inv.review_status === 'pending' ? 'in_review' : inv.review_status, updated_at: new Date().toISOString() }).eq('id', inv.id);
    if (error) return bad(error.message, 500);

    await log('invoice_corrected', { reason, before, after: patch, lines_replaced: newLines ? newLines.length : null });
    const r = await runMatching(inv.id, a.userId);
    if ('error' in r) return bad(r.error, 422);
    return NextResponse.json({ match_status: r.matchStatus });
}
