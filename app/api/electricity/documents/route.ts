import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation,
} from '@/backend/lib/electricity/access';
import { upsertBillFromParsed } from '@/backend/lib/electricity/ingest';
import { ParsedBill } from '@/backend/lib/electricity/billOcr';

/**
 * GET /api/electricity/documents — the Inbox review queue.
 *
 * Documents that need a human: parse failures (ocr_status='failed') and parsed PDFs
 * that matched no billing account (account_id IS NULL). Matched-and-parsed documents
 * are visible through the bills register instead.
 *
 * PATCH /api/electricity/documents — link a document to a billing account by hand.
 * Re-runs the bill upsert from the stored ocr_payload where the parse produced a
 * billing month; otherwise just records the link so the original stays reachable.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('electricity_bill_documents')
        .select(`
            id, account_id, bill_id, mailbox_message_id, from_address, subject,
            received_at, storage_path, file_name, mime_type,
            ocr_status, ocr_payload, ocr_confidence, created_at,
            sender_status, quarantine_reason,
            field_confidence, lowest_confidence_field, lowest_confidence, needs_field_review
        `)
        .eq('organization_id', access.organizationId)
        // Four reasons a document needs a human: it was quarantined by the allow-list, a
        // critical field scored too low to trust, the parse failed, or it matched no
        // account. Anything else is already visible in the Register.
        .or('sender_status.eq.quarantined,needs_field_review.is.true,ocr_status.eq.failed,account_id.is.null')
        .order('received_at', { ascending: false })
        .range(0, 499);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, documents: [] });
        }
        // The extra columns arrive with 20260804000006; on a database where only the
        // earlier ingestion migration is applied, fall back to the original projection
        // rather than showing the operator an empty inbox.
        if (error.code === '42703') {
            const legacy = await supabaseAdmin
                .from('electricity_bill_documents')
                .select(`
                    id, account_id, bill_id, mailbox_message_id, from_address, subject,
                    received_at, storage_path, file_name, mime_type,
                    ocr_status, ocr_payload, ocr_confidence, created_at
                `)
                .eq('organization_id', access.organizationId)
                .or('ocr_status.eq.failed,account_id.is.null')
                .order('received_at', { ascending: false })
                .range(0, 499);
            if (!legacy.error) {
                return NextResponse.json({ provisioned: true, documents: legacy.data || [], legacy_projection: true });
            }
        }
        console.error('[electricity documents]', error.message);
        return NextResponse.json({ error: 'Could not load electricity bill documents' }, { status: 500 });
    }

    return NextResponse.json({ provisioned: true, documents: data || [] });
}

export async function PATCH(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    let body: { id?: string; account_id?: string; action?: string; trust_sender?: boolean };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Releasing a quarantined document is its own action: the allow-list holds mail from
    // an unrecognised sender (REQ-E-01), and without a release path a board that changes
    // its sending address would be silently stuck forever — a security control that
    // becomes an outage. Releasing is deliberately a human decision, recorded with a name.
    if (body.action === 'release') {
        return releaseQuarantined(access, body.id, body.trust_sender === true);
    }

    if (!body.account_id) {
        return NextResponse.json({ error: 'account_id is required' }, { status: 400 });
    }

    // Confirm the target account belongs to this org before linking anything to it.
    const { data: account, error: accErr } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('id, organization_id, consumer_ref, inbound_email_hints, provider, site_label')
        .eq('id', body.account_id)
        .eq('organization_id', access.organizationId)
        .maybeSingle();
    if (accErr || !account) {
        return NextResponse.json({ error: 'Billing account not found in this organization' }, { status: 404 });
    }

    const { data: doc, error: docErr } = await supabaseAdmin
        .from('electricity_bill_documents')
        .select('id, organization_id, ocr_status, ocr_payload, from_address')
        .eq('id', body.id)
        .eq('organization_id', access.organizationId)
        .maybeSingle();
    if (docErr || !doc) {
        return NextResponse.json({ error: 'Document not found in this organization' }, { status: 404 });
    }

    // Re-run the bill upsert from the stored parse, where possible. The payload shape
    // is the raw model output, so re-normalise the loose fields the same way ingest does.
    let billId: string | null = null;
    const raw = (doc.ocr_payload as any)?.raw;
    if (raw && typeof raw === 'object') {
        const parsed = payloadToParsedBill(raw);
        if (parsed.billingMonth) {
            billId = await upsertBillFromParsed(access.organizationId, account, parsed, doc.id);
        }
    }

    const { error: updErr } = await supabaseAdmin
        .from('electricity_bill_documents')
        .update({
            account_id: account.id,
            bill_id: billId,
            // A human linked it: even where no bill row could be built (no billing month),
            // the document is resolved and leaves the review queue.
            ocr_status: billId ? 'parsed' : 'manual',
        })
        .eq('id', doc.id);
    if (updErr) {
        console.error('[electricity documents] link failed:', updErr.message);
        return NextResponse.json({ error: 'Could not link document' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, bill_id: billId, linked_without_bill: !billId });
}

/**
 * Release one quarantined document, optionally adding its sender to the allow-list so the
 * next bill from that board is processed automatically.
 *
 * Releasing does NOT parse it here — the document goes back to 'pending' and the next
 * ingest run picks it up through the normal path, so there is exactly one code path that
 * turns a PDF into a bill.
 */
async function releaseQuarantined(
    access: { organizationId: string; user: { id: string } },
    documentId: string,
    trustSender: boolean,
) {
    const { data: doc, error } = await supabaseAdmin
        .from('electricity_bill_documents')
        .select('id, from_address, sender_status')
        .eq('id', documentId)
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    if (error || !doc) {
        return NextResponse.json({ error: 'Document not found in this organization' }, { status: 404 });
    }
    if (doc.sender_status !== 'quarantined') {
        return NextResponse.json({ error: 'This document is not quarantined' }, { status: 409 });
    }

    const { error: relErr } = await supabaseAdmin
        .from('electricity_bill_documents')
        .update({
            sender_status: 'released',
            released_by: access.user.id,
            released_at: new Date().toISOString(),
            ocr_status: 'pending',
        })
        .eq('id', doc.id);
    if (relErr) {
        console.error('[electricity documents] release failed:', relErr.message);
        return NextResponse.json({ error: 'Could not release the document' }, { status: 500 });
    }

    let trusted = false;
    if (trustSender && doc.from_address) {
        // Trust the exact address, never the whole domain: a compromised or spoofed
        // address at a legitimate board's domain should not be waved through because
        // somebody once released one mail from it.
        const { error: alErr } = await supabaseAdmin
            .from('electricity_sender_allowlist')
            .upsert({
                organization_id: access.organizationId,
                pattern: doc.from_address.trim().toLowerCase(),
                label: 'Trusted from Inbox release',
                is_active: true,
                created_by: access.user.id,
            }, { onConflict: 'organization_id,pattern' });
        if (alErr) console.error('[electricity documents] allow-list add failed:', alErr.message);
        else trusted = true;
    }

    return NextResponse.json({ ok: true, released: true, sender_trusted: trusted });
}

/** Loose re-normalisation of a stored ocr_payload.raw — mirrors billOcr.normalise. */
function payloadToParsedBill(f: Record<string, unknown>): ParsedBill {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = (v: unknown) => {
        const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,₹\s]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    const date = (v: unknown) => {
        const s = str(v);
        return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };
    const month = date(f.billing_month);
    return {
        provider: str(f.provider),
        consumerNumber: str(f.consumer_number),
        billingMonth: month ? month.slice(0, 8) + '01' : null,
        billDate: date(f.bill_date),
        dueDate: date(f.due_date),
        totalAmount: num(f.total_amount),
        earlyPaymentDate: date(f.early_payment_date),
        earlyPaymentAmount: num(f.early_payment_amount),
        afterDueAmount: num(f.after_due_amount),
        billedUnits: num(f.billed_units),
        billedUnitsUnit: str(f.billed_units_unit),
        confidence: num(f.confidence),
        // A stored payload from before per-field scoring carries no field map. Empty is the
        // honest value — it means "unscored", and buildConfidencePatch treats an unscorable
        // document as needing review rather than waving it through.
        fieldConfidence: (f.field_confidence && typeof f.field_confidence === 'object'
            ? f.field_confidence as Record<string, number>
            : {}),
    };
}
