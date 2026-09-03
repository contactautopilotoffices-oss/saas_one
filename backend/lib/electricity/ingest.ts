/**
 * Electricity mailbox ingestion: pull new bill PDFs from the shared electricity@
 * mailbox, parse them with Groq, match them to a billing account, upsert the bill,
 * and forward a copy to the site SPOC.
 *
 * Same contract as the purchase mailbox sync (sync-purchase-mailbox/route.ts):
 *   - DORMANT UNTIL CONFIGURED: no ZOHO_ELEC_MAIL_* envs → no-op, never throws.
 *   - ENV-PINNED ORG: the mailbox credentials are global (one inbox), so the org that
 *     receives its rows is pinned by ZOHO_ELEC_MAIL_ORG_ID in the cron route. Without
 *     the pin this would copy one tenant's correspondence into every org on the day a
 *     second org is onboarded — cross-tenant disclosure with no code change.
 *
 * Idempotent: documents are upserted on (organization_id, mailbox_message_id,
 * file_name) and bills on (account_id, billing_month), so re-runs never duplicate.
 * Persist-as-we-go: a killed run keeps everything it already wrote.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { ZohoMailService, isZohoMailConfigured } from '@/backend/services/zohoMailService';
import { parseBillPdf, ParsedBill, weakestField, FIELD_REVIEW_THRESHOLD } from './billOcr';
import { forwardBillToSpoc } from './forwardBill';

const ENV_PREFIX = 'ZOHO_ELEC_MAIL' as const;
const BUCKET = 'electricity-bills';
const LOOKBACK_DAYS = Number(process.env.ZOHO_ELEC_MAIL_LOOKBACK_DAYS || 21);
const MAX_MESSAGES = 100;

export interface ElectricityIngestResult {
    orgId: string;
    messagesScanned: number;
    documentsIngested: number;
    parsed: number;
    failed: number;
    unmatched: number;
    forwarded: number;
    /** Held because the sender is not on the allow-list — stored, never parsed (REQ-E-01). */
    quarantined: number;
    /** Parsed, but a critical field scored below the review threshold (REQ-E-02). */
    heldForFieldReview: number;
    skipped?: string;
    error?: string;
}

export interface AllowlistEntry {
    pattern: string;
    label: string | null;
}

/**
 * Allow-list match: exact address, or a '@domain' suffix entry.
 *
 * FAIL CLOSED. An org with no allow-list rows quarantines everything rather than
 * accepting everything — the opposite default would mean the security control silently
 * does nothing until somebody remembers to configure it, which is how this class of
 * control usually fails. The Inbox shows quarantined mail prominently with a one-click
 * "trust this sender", so the cost of the strict default is one click per real board.
 */
export function isSenderAllowed(fromAddress: string | null | undefined, allowlist: AllowlistEntry[]): boolean {
    const from = (fromAddress || '').trim().toLowerCase();
    if (!from) return false;

    return allowlist.some(entry => {
        const p = (entry.pattern || '').trim().toLowerCase();
        if (!p) return false;
        if (p.startsWith('@')) return from.endsWith(p);
        return from === p;
    });
}

async function loadAllowlist(orgId: string): Promise<AllowlistEntry[]> {
    const { data, error } = await supabaseAdmin
        .from('electricity_sender_allowlist')
        .select('pattern, label')
        .eq('organization_id', orgId)
        .eq('is_active', true);

    if (error) {
        // Migration not applied yet. Returning [] means fail-closed: everything is
        // quarantined and nothing is silently auto-processed on an unguarded inbox.
        console.warn('[ElectricityIngest] allow-list unavailable, quarantining all inbound:', error.message);
        return [];
    }
    return (data || []) as AllowlistEntry[];
}

interface AccountRow {
    id: string;
    property_id: string | null;
    spoc_user_id: string | null;
    provider: string;
    site_label: string;
    consumer_ref: string | null;
    inbound_email_hints: string[] | null;
}

export async function syncElectricityMailboxForOrg(orgId: string): Promise<ElectricityIngestResult> {
    const base = {
        orgId, messagesScanned: 0, documentsIngested: 0, parsed: 0, failed: 0,
        unmatched: 0, forwarded: 0, quarantined: 0, heldForFieldReview: 0,
    };
    if (!isZohoMailConfigured(ENV_PREFIX)) {
        return { ...base, skipped: 'Zoho electricity mailbox is not configured (ZOHO_ELEC_MAIL_* env vars missing)' };
    }

    try {
        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const messages = (await ZohoMailService.listMessages({ since, limit: MAX_MESSAGES }, ENV_PREFIX))
            .filter(m => m.hasAttachment);
        if (messages.length === 0) return base;

        const [accounts, allowlist] = await Promise.all([loadAccounts(orgId), loadAllowlist(orgId)]);
        const result = { ...base, messagesScanned: messages.length };

        for (const msg of messages) {
            const attachments = (await ZohoMailService.listAttachments(msg.messageId, ENV_PREFIX))
                .filter(a => a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.attachmentName));
            for (const att of attachments) {
                // Skip before downloading: the unique constraint makes re-ingest a no-op,
                // but checking first saves the download + OCR call on every re-run.
                const { data: existing } = await supabaseAdmin
                    .from('electricity_bill_documents')
                    .select('id')
                    .eq('organization_id', orgId)
                    .eq('mailbox_message_id', msg.messageId)
                    .eq('file_name', att.attachmentName)
                    .maybeSingle();
                if (existing) continue;

                await ingestOne(orgId, msg, att, accounts, allowlist, result);
            }
        }
        return result;
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'electricity mailbox sync failed';
        console.error('[ElectricityIngest] sync failed:', msg);
        return { ...base, error: msg };
    }
}

async function ingestOne(
    orgId: string,
    msg: { messageId: string; subject: string; fromAddress: string; sentAt: string },
    att: { attachmentId: string; attachmentName: string; mimeType: string },
    accounts: AccountRow[],
    allowlist: AllowlistEntry[],
    result: Omit<ElectricityIngestResult, 'orgId'>,
) {
    const pdf = await ZohoMailService.downloadAttachment(msg.messageId, att.attachmentId, ENV_PREFIX);
    const storagePath = `${orgId}/${msg.messageId}/${att.attachmentName}`;

    const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
        // Without the stored PDF the document row would point at nothing; fail loudly
        // and let the next run retry (no document row was written yet).
        console.error('[ElectricityIngest] storage upload failed:', upErr.message);
        result.failed++;
        return;
    }

    const { data: doc, error: docErr } = await supabaseAdmin
        .from('electricity_bill_documents')
        .upsert({
            organization_id: orgId,
            mailbox_message_id: msg.messageId,
            from_address: msg.fromAddress || null,
            subject: (msg.subject || '').slice(0, 500),
            received_at: msg.sentAt,
            storage_path: storagePath,
            file_name: att.attachmentName,
            mime_type: att.mimeType,
            ocr_status: 'pending',
        }, { onConflict: 'organization_id,mailbox_message_id,file_name' })
        .select('id').single();
    if (docErr || !doc) {
        console.error('[ElectricityIngest] document insert failed:', docErr?.message);
        result.failed++;
        return;
    }
    result.documentsIngested++;

    // ---- Sender allow-list gate (SPEC REQ-E-01) --------------------------------
    // "mail from an unrecognised sender is quarantined, never auto-processed." The PDF is
    // kept — quarantine is not deletion, and a genuine board that changed its sending
    // address must be releasable by a human rather than lost. But nothing downstream runs:
    // no OCR (which would spend a Groq call on a stranger's attachment) and no forwarding
    // (which would relay it to a site SPOC under our own name).
    if (!isSenderAllowed(msg.fromAddress, allowlist)) {
        await updateDocument(doc.id, {
            sender_status: 'quarantined',
            quarantine_reason: `Sender ${msg.fromAddress || '(none)'} is not on the electricity allow-list`,
            ocr_status: 'pending',
        });
        result.quarantined++;
        console.warn(`[ElectricityIngest] quarantined ${att.attachmentName} from ${msg.fromAddress}`);
        return;
    }

    const ocr = await parseBillPdf(pdf);
    if (!ocr.parsed) {
        await updateDocument(doc.id, {
            ocr_status: 'failed',
            ocr_payload: { ...ocr.payload, error: ocr.error },
        });
        result.failed++;
        return;
    }

    const confidencePatch = buildConfidencePatch(ocr.parsed);
    if (confidencePatch.needs_field_review) result.heldForFieldReview++;

    const account = matchAccount(ocr.parsed, msg.fromAddress, accounts);
    if (!account) {
        // Parsed fine but attributable to no known connection — a human links it in the
        // Inbox view, which re-runs the bill upsert from ocr_payload.
        await updateDocument(doc.id, {
            ocr_status: 'parsed',
            ocr_payload: ocr.payload,
            ocr_confidence: ocr.parsed.confidence,
            ...confidencePatch,
        });
        result.parsed++;
        result.unmatched++;
        return;
    }

    const billId = await upsertBillFromParsed(
        orgId, account, ocr.parsed, doc.id, confidencePatch.needs_field_review, msg.sentAt);
    await updateDocument(doc.id, {
        account_id: account.id,
        bill_id: billId,
        ocr_status: 'parsed',
        ocr_payload: ocr.payload,
        ocr_confidence: ocr.parsed.confidence,
        ...confidencePatch,
    });
    result.parsed++;

    // A bill whose due date or total the model could not read confidently must not be
    // forwarded to a site SPOC as though it were verified fact — it goes to the Inbox for
    // a human to confirm first. Quietly mailing a wrong amount to a site is worse than
    // mailing nothing (FP-01: a number with no query behind it is a lie with good posture).
    if (confidencePatch.needs_field_review) {
        console.warn(`[ElectricityIngest] ${att.attachmentName} held: ${confidencePatch.lowest_confidence_field} scored ${confidencePatch.lowest_confidence}`);
        return;
    }

    const fwd = await forwardBillToSpoc(account, pdf, att.attachmentName, {
        billingMonth: ocr.parsed.billingMonth,
        totalAmount: ocr.parsed.totalAmount,
    });
    if (fwd.sent) {
        await updateDocument(doc.id, { forwarded_to: fwd.recipients, forwarded_at: new Date().toISOString() });
        result.forwarded++;
    } else if (fwd.error) {
        console.warn(`[ElectricityIngest] forward skipped for ${att.attachmentName}: ${fwd.error}`);
    }
}

/**
 * Turn per-field confidence into the columns the Inbox reads (REQ-E-02).
 * needs_field_review keys off the weakest CRITICAL field only — a smudged provider name
 * is cosmetic, a smudged due date is a mis-timed payment.
 */
function buildConfidencePatch(parsed: ParsedBill): {
    field_confidence: Record<string, number>;
    lowest_confidence_field: string | null;
    lowest_confidence: number | null;
    needs_field_review: boolean;
} {
    const weakest = weakestField(parsed.fieldConfidence);
    return {
        field_confidence: parsed.fieldConfidence,
        lowest_confidence_field: weakest?.field ?? null,
        lowest_confidence: weakest?.value ?? null,
        needs_field_review: weakest ? weakest.value < FIELD_REVIEW_THRESHOLD : true,
    };
}

/** Patch one document row; logged-and-forgotten so a patch failure never aborts a run. */
async function updateDocument(id: string, patch: Record<string, unknown>) {
    const { error } = await supabaseAdmin.from('electricity_bill_documents').update(patch).eq('id', id);
    if (error) console.error('[ElectricityIngest] document update failed:', error.message);
}

async function loadAccounts(orgId: string): Promise<AccountRow[]> {
    const { data, error } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('id, property_id, spoc_user_id, provider, site_label, consumer_ref, inbound_email_hints')
        .eq('organization_id', orgId)
        .eq('is_active', true);
    if (error) throw new Error(`billing accounts load failed: ${error.message}`);
    return (data || []) as AccountRow[];
}

/**
 * Attribute a parsed bill to a billing account.
 * Order: exact consumer-number match on consumer_ref → any inbound_email_hints hit
 * (against consumer number or sender address). No fuzzy site-name guessing: a wrong
 * match bills the wrong site, so ambiguity returns null and waits for a human.
 */
export function matchAccount(parsed: ParsedBill, fromAddress: string, accounts: AccountRow[]): AccountRow | null {
    const consumer = (parsed.consumerNumber || '').replace(/\D/g, '');
    if (consumer) {
        const exact = accounts.filter(a => (a.consumer_ref || '').replace(/\D/g, '') === consumer);
        if (exact.length === 1) return exact[0];
    }

    const haystack = `${parsed.consumerNumber || ''} ${parsed.provider || ''} ${fromAddress || ''}`.toLowerCase();
    const hinted = accounts.filter(a =>
        (a.inbound_email_hints || []).some(h => h && haystack.includes(h.toLowerCase())));
    // Multiple candidates = ambiguous; leave it unmatched rather than guess.
    return hinted.length === 1 ? hinted[0] : null;
}

/**
 * Upsert the bill on (account_id, billing_month) with source='ocr'. Needs a parsed
 * billing month — without one the row cannot exist (billing_month NOT NULL), so the
 * caller leaves the document for manual entry instead.
 *
 * workflow_status moves forwards only: an existing bill that already passed 'parsed'
 * (validating/validated/paid/…) keeps its status; the OCR refresh updates figures but
 * never drags a settled bill back into the pipeline.
 */
export async function upsertBillFromParsed(
    orgId: string,
    account: { id: string },
    parsed: ParsedBill,
    documentId: string | null,
    needsFieldReview = false,
    /** Mail receipt time — starts the cycle clock (electricity_bill_cycle.cycle_days). */
    receivedAt?: string | null,
): Promise<string | null> {
    if (!parsed.billingMonth) return null;

    const { data: existing } = await supabaseAdmin
        .from('electricity_bills')
        .select('id, workflow_status')
        .eq('account_id', account.id)
        .eq('billing_month', parsed.billingMonth)
        .maybeSingle();

    const figures = {
        bill_date: parsed.billDate,
        due_date: parsed.dueDate,
        total_amount: parsed.totalAmount,
        early_payment_date: parsed.earlyPaymentDate,
        early_payment_amount: parsed.earlyPaymentAmount,
        after_due_date_amount: parsed.afterDueAmount,
        billed_units: parsed.billedUnits,
        billed_units_unit: parsed.billedUnitsUnit,
        document_id: documentId,
        updated_at: new Date().toISOString(),
    };
    const master = masterFigures(parsed);

    // A bill the parser was unsure about parks in needs_manual_entry rather than moving on
    // to validation — the pipeline must not build a payment decision on a guessed figure.
    const parsedStatus = needsFieldReview ? 'needs_manual_entry' : 'parsed';

    if (existing) {
        const keepStatus = existing.workflow_status
            && !['ingested', 'needs_manual_entry', 'parsed'].includes(existing.workflow_status);
        const patch = { ...figures, ...(keepStatus ? {} : { workflow_status: parsedStatus }) };

        let { error } = await supabaseAdmin.from('electricity_bills')
            .update({ ...patch, ...master }).eq('id', existing.id);
        if (isUnknownColumn(error) && Object.keys(master).length > 0) {
            warnMasterColumnsMissing(error);
            ({ error } = await supabaseAdmin.from('electricity_bills')
                .update(patch).eq('id', existing.id));
        }
        if (error) console.error('[ElectricityIngest] bill update failed:', error.message);
        return existing.id;
    }

    const row = {
        organization_id: orgId,
        account_id: account.id,
        billing_month: parsed.billingMonth,
        ...figures,
        source: 'ocr',
        workflow_status: parsedStatus,
        received_at: receivedAt ?? new Date().toISOString(),
    };

    let { data: inserted, error } = await supabaseAdmin.from('electricity_bills')
        .insert({ ...row, ...master }).select('id').single();
    if (isUnknownColumn(error) && Object.keys(master).length > 0) {
        warnMasterColumnsMissing(error);
        ({ data: inserted, error } = await supabaseAdmin.from('electricity_bills')
            .insert(row).select('id').single());
    }
    if (error) {
        console.error('[ElectricityIngest] bill insert failed:', error.message);
        return null;
    }
    return inserted?.id ?? null;
}

/**
 * Bill Master columns, carrying only the keys the parser actually extracted.
 *
 * undefined means the parse never looked at that field — a payload stored before the master
 * block existed, or a manual link from the Inbox — so the column is omitted and keeps
 * whatever is already there. A parser that looked and failed sends null, which does
 * overwrite: "we read this bill and it has no arrears" is a fact worth recording.
 */
function masterFigures(parsed: ParsedBill): Record<string, unknown> {
    const byColumn: Record<string, unknown> = {
        bill_number: parsed.billNumber,
        meter_no: parsed.meterNo,
        consumer_name: parsed.consumerName,
        tariff_category: parsed.tariffCategory,
        sanctioned_load_kw: parsed.sanctionedLoadKw,
        contract_demand_kva: parsed.contractDemandKva,
        recorded_demand_kva: parsed.recordedDemandKva,
        power_factor: parsed.powerFactor,
        billing_period_start: parsed.billingPeriodStart,
        billing_period_end: parsed.billingPeriodEnd,
        previous_reading: parsed.previousReading,
        current_reading: parsed.currentReading,
        previous_reading_date: parsed.previousReadingDate,
        current_reading_date: parsed.currentReadingDate,
        multiplying_factor: parsed.multiplyingFactor,
        energy_charges: parsed.energyCharges,
        fixed_charges: parsed.fixedCharges,
        electricity_duty: parsed.electricityDuty,
        tax_amount: parsed.taxAmount,
        fuel_surcharge: parsed.fuelSurcharge,
        other_charges: parsed.otherCharges,
        adjustments: parsed.adjustments,
        arrears: parsed.arrears,
        interest_charges: parsed.interestCharges,
    };

    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(byColumn)) {
        if (value !== undefined) out[column] = value;
    }
    return out;
}

/**
 * PostgREST rejects the WHOLE write when it meets a column it does not know (PGRST204),
 * rather than dropping the unknown keys. So a deploy that lands before
 * 20260826000001_electricity_bill_master.sql is applied would stop ingesting bills
 * altogether. Retry without the master block instead: a bill with no meter number is
 * yesterday's behaviour and is recoverable by a re-parse, a bill that never arrived is not.
 * Same fallback shape as app/api/tickets/[id]/tag-vendor/route.ts.
 */
function isUnknownColumn(error: { code?: string } | null): boolean {
    return !!error && (error.code === 'PGRST204' || error.code === '42703');
}

function warnMasterColumnsMissing(error: { message?: string } | null) {
    console.warn('[ElectricityIngest] bill master columns missing, retrying without them '
        + '(apply 20260826000001_electricity_bill_master.sql):', error?.message);
}
