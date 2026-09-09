/**
 * Groq vision/text parse of one electricity-board bill PDF into structured fields.
 *
 * Model: qwen/qwen3.8-27b, same as app/api/ocr/meter/route.ts.
 *
 * BUDGET NOTE (shared GROQ_API_KEY): this key also powers ticket classification, meter
 * OCR, catalog bulk-upload, call coaching and the master-admin chatbot, and Groq's free
 * tier is a 100,000-token DAILY organisation-wide budget. Bills are 1–2 page extractions
 * (~1–3k tokens each, plus a few hundred for the Bill Master block) at mailbox volume (a
 * handful a day), so this stays well inside the envelope — but if the mailbox ever starts
 * receiving bulk mail, gate this behind its own key the way mailboxDigest.ts gates its
 * classifier behind OPENAI_API_KEY.
 *
 * PARSING PATH: board PDFs are almost always digital (text layer), so the primary path
 * extracts text with pdfjs-dist and sends TEXT to the model. If the PDF is scanned (no
 * text layer) we rasterise pages 1–2 to PNG and use the model's vision input — but that
 * needs a Node canvas provider (@napi-rs/canvas), which is not yet a dependency. Until
 * it is, scanned bills degrade honestly to a parse failure → workflow_status
 * 'needs_manual_entry', surfaced in the Inbox review queue. Nothing is guessed.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Was qwen/qwen3.8-27b until 2026-09-05, when Groq
// retired it — every OCR path 404'd with model_not_found. qwen3.8-27b is the
// vision model still served on this key; verified against a test invoice for
// both free-text transcription and response_format:json_object.
const MODEL = 'qwen/qwen3.8-27b';
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 2;        // the money block is on page 1–2 of every board bill we have seen
const TEXT_CHAR_LIMIT = 12_000;

/**
 * Bill Master (20260826000001_electricity_bill_master.sql) — the bill as printed, beyond
 * the amounts needed to pay it.
 *
 * Every member is optional because a ParsedBill can also be rebuilt from a stored
 * ocr_payload written before this block existed (payloadToParsedBill in
 * app/api/electricity/documents/route.ts). The two absent states are NOT the same, and the
 * ingest patch treats them differently:
 *   undefined — never extracted; leave whatever is in the column alone.
 *   null      — the parser looked at this bill and could not read the field.
 */
export interface BillMasterFields {
    /** Board's own invoice number, for Accounts matching and dispute references. */
    billNumber?: string | null;
    /** Meter serial as printed — the physical meter, not the consumer/account number. */
    meterNo?: string | null;
    /** Registered name on the connection: decides whether we pay it or recover it. */
    consumerName?: string | null;
    tariffCategory?: string | null;
    sanctionedLoadKw?: number | null;
    contractDemandKva?: number | null;
    recordedDemandKva?: number | null;
    powerFactor?: number | null;
    /** True service window; billing_month is only the bucket it falls in. */
    billingPeriodStart?: string | null;
    billingPeriodEnd?: string | null;
    previousReading?: number | null;
    currentReading?: number | null;
    previousReadingDate?: string | null;
    currentReadingDate?: string | null;
    /** CT/PT ratio: (current − previous) × this = billed units. */
    multiplyingFactor?: number | null;
    energyCharges?: number | null;
    fixedCharges?: number | null;
    electricityDuty?: number | null;
    taxAmount?: number | null;
    fuelSurcharge?: number | null;
    otherCharges?: number | null;
    adjustments?: number | null;
    arrears?: number | null;
    interestCharges?: number | null;
}

export interface ParsedBill extends BillMasterFields {
    provider: string | null;
    consumerNumber: string | null;
    /** 1st of the billing month, YYYY-MM-DD. */
    billingMonth: string | null;
    billDate: string | null;
    dueDate: string | null;
    totalAmount: number | null;
    earlyPaymentDate: string | null;
    earlyPaymentAmount: number | null;
    afterDueAmount: number | null;
    billedUnits: number | null;
    billedUnitsUnit: string | null;
    /**
     * Document-level roll-up, kept for the existing ocr_confidence column and for sorting.
     * It is the MINIMUM across critical fields, not an average — an average lets one
     * unreadable due date hide behind ten crisp ones, which is the failure mode
     * SPEC-ELECTRICITY.md REQ-E-02 exists to prevent.
     */
    confidence: number | null;
    /** Per-field 0–100, keyed by OCR_FIELDS. The answer to "which field is weakest". */
    fieldConfidence: Record<string, number>;
}

export interface BillOcrResult {
    parsed: ParsedBill | null;
    /** Raw model output + usage, persisted on electricity_bill_documents.ocr_payload. */
    payload: Record<string, unknown>;
    error?: string;
}

const EMPTY_PARSED: ParsedBill = {
    provider: null, consumerNumber: null, billingMonth: null, billDate: null, dueDate: null,
    totalAmount: null, earlyPaymentDate: null, earlyPaymentAmount: null, afterDueAmount: null,
    billedUnits: null, billedUnitsUnit: null, confidence: null, fieldConfidence: {},
};

const SYSTEM_PROMPT = `You extract structured fields from Indian electricity board bills (BESCOM, Adani, Tata Power, MSEDCL, BEST, etc).

Return ONLY a valid JSON object with THREE keys, "fields", "confidence" and "master":
{"fields": {"provider": string|null, "consumer_number": string|null, "billing_month": "YYYY-MM-DD"|null, "bill_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "total_amount": number|null, "early_payment_date": "YYYY-MM-DD"|null, "early_payment_amount": number|null, "after_due_amount": number|null, "billed_units": number|null, "billed_units_unit": "kWh"|"kVAh"|string|null},
 "confidence": {"provider": 0-100, "consumer_number": 0-100, "billing_month": 0-100, "bill_date": 0-100, "due_date": 0-100, "total_amount": 0-100, "early_payment_date": 0-100, "early_payment_amount": 0-100, "after_due_amount": 0-100, "billed_units": 0-100, "billed_units_unit": 0-100},
 "master": {"bill_number": string|null, "meter_no": string|null, "consumer_name": string|null, "tariff_category": string|null, "sanctioned_load_kw": number|null, "contract_demand_kva": number|null, "recorded_demand_kva": number|null, "power_factor": number|null, "billing_period_start": "YYYY-MM-DD"|null, "billing_period_end": "YYYY-MM-DD"|null, "previous_reading": number|null, "current_reading": number|null, "previous_reading_date": "YYYY-MM-DD"|null, "current_reading_date": "YYYY-MM-DD"|null, "multiplying_factor": number|null, "energy_charges": number|null, "fixed_charges": number|null, "electricity_duty": number|null, "tax_amount": number|null, "fuel_surcharge": number|null, "other_charges": number|null, "adjustments": number|null, "arrears": number|null, "interest_charges": number|null}}

RULES:
1. consumer_number is the connection/consumer/account number printed on the bill, digits only where possible.
2. billing_month is the 1st of the month the bill covers (from the billing period), NOT the bill date.
3. total_amount is the amount payable on or before the due date. after_due_amount is the amount payable after the due date (with penalty). early_payment_amount is the discounted amount for paying on/before the rebate date, when the board offers one.
4. billed_units is the energy billed for the period, in the unit printed (kWh or kVAh). Do NOT convert units.
5. Amounts are plain numbers in INR with no currency symbol or thousands separators.
6. Use null, never invent a value you cannot read.
7. CONFIDENCE IS PER FIELD, and they must differ. Score each field on how clearly YOU READ THAT FIELD:
   - 90-100: printed clearly and unambiguously labelled.
   - 60-89:  read it, but the label was ambiguous or the layout unusual.
   - 1-59:   partly obscured, smudged, inferred from context, or you had to pick between candidates.
   - 0:      could not read it at all (the field is null).
   Do NOT give every field the same score. A bill whose total is crisp but whose meter reading is smudged must score total_amount high and billed_units low.
8. "master" is the bill as printed. Score nothing in it — "confidence" covers "fields" only.
9. meter_no is the METER serial number, which is a different number from consumer_number. Return null rather than repeating the consumer number.
10. billing_period_start/end are the service period the bill covers (e.g. "18/06/2026 to 17/07/2026"), which is usually not a calendar month. previous_reading and current_reading are the meter readings as printed, BEFORE the multiplying factor. multiplying_factor is the CT/PT ratio; return null when the bill does not print one — never assume 1.
11. The charge heads are signed: return a credit, refund or negative adjustment as a NEGATIVE number. arrears is the unpaid balance carried forward from earlier bills — never fold it into energy_charges. Put any head with no matching key into other_charges.`;

/** Field keys carried in field_confidence, in the order the Inbox displays them. */
export const OCR_FIELDS = [
    'provider', 'consumer_number', 'billing_month', 'bill_date', 'due_date',
    'total_amount', 'early_payment_date', 'early_payment_amount', 'after_due_amount',
    'billed_units', 'billed_units_unit',
] as const;

/**
 * Below this, a field is not trusted and the document is held for human review rather
 * than auto-advancing into the bill record. 60 matches the boundary the prompt describes
 * as "had to pick between candidates".
 */
export const FIELD_REVIEW_THRESHOLD = 60;

/** Fields whose confidence actually gates the money. A smudged provider name is cosmetic;
 *  a smudged total or due date is a wrong payment. Only these can trigger review. */
export const CRITICAL_FIELDS = [
    'billing_month', 'due_date', 'total_amount', 'early_payment_date', 'early_payment_amount',
] as const;

/** Parse one bill PDF. Never throws — failures come back as { parsed: null, error }. */
export async function parseBillPdf(pdfBytes: Buffer): Promise<BillOcrResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return { parsed: null, payload: {}, error: 'GROQ_API_KEY not set' };

    let text: string;
    try {
        text = await extractPdfText(pdfBytes);
    } catch (e) {
        return { parsed: null, payload: {}, error: `pdf text extraction failed: ${e instanceof Error ? e.message : e}` };
    }

    const content = await callGroq(apiKey, text ? textContent(text) : await imageContent(pdfBytes));
    if (!content.ok) return { parsed: null, payload: content.payload, error: content.error };

    // The prompt asks for {fields, confidence}. Tolerate the older flat shape too, so a
    // model that ignores the envelope still yields a bill rather than a parse failure —
    // it just scores every field 0 and lands in review, which is the safe direction.
    const raw = content.fields as Record<string, unknown>;
    const nested = raw && typeof raw.fields === 'object' && raw.fields !== null;
    const fieldSrc = (nested ? raw.fields : raw) as Record<string, unknown>;
    const confSrc = nested ? raw.confidence : undefined;

    // raw.master is read off the envelope in both shapes: nested puts it beside "fields",
    // flat puts it beside the fields themselves, and a model that omits it leaves the Bill
    // Master columns untouched rather than blanked.
    const parsed = normalise(fieldSrc, raw?.master);
    parsed.fieldConfidence = normaliseConfidence(confSrc, parsed);

    // Roll up to the weakest critical field — see the note on ParsedBill.confidence.
    const weakest = weakestField(parsed.fieldConfidence);
    parsed.confidence = weakest ? weakest.value : null;

    return { parsed, payload: { ...content.payload, field_confidence: parsed.fieldConfidence } };
}

/** pdfjs-dist text extraction works in plain Node — no canvas needed. */
async function extractPdfText(pdfBytes: Buffer): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(pdfBytes),
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
    } as any).promise;

    const pages = Math.min(doc.numPages, MAX_PAGES);
    let out = '';
    for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        out += (tc.items as any[]).map(i => String(i?.str || '')).join(' ') + '\n';
    }
    await doc.destroy();
    return out.trim().slice(0, TEXT_CHAR_LIMIT);
}

function textContent(text: string) {
    return [{ type: 'text', text: `Extract the bill fields from this electricity bill text:\n\n${text}` }] as any[];
}

/**
 * Rasterise pages 1–2 for the vision path. Requires @napi-rs/canvas, which is NOT a
 * dependency yet — when it is absent this throws and the caller reports a parse failure
 * instead of silently OCRing nothing.
 */
async function imageContent(pdfBytes: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    let createCanvas: any;
    try {
        const canvasModule = await import('@napi-rs/canvas');
        createCanvas = canvasModule.createCanvas;
    } catch (e) {
        throw new Error('@napi-rs/canvas is not available');
    }

    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useWorkerFetch: false, isEvalSupported: false } as any).promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: any[] = [{ type: 'text', text: 'Extract the bill fields from these electricity bill page images.' }];

    for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport }).promise;
        const dataUrl = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    await doc.destroy();
    return parts;
}

interface GroqCallOk { ok: true; fields: Record<string, unknown>; payload: Record<string, unknown> }
interface GroqCallErr { ok: false; payload: Record<string, unknown>; error: string }

async function callGroq(apiKey: string, content: any[]): Promise<GroqCallOk | GroqCallErr> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content },
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[BillOCR] Groq API error:', response.status, errorText.slice(0, 500));
            return { ok: false, payload: { http_status: response.status }, error: `Groq API returned ${response.status}` };
        }

        const data = await response.json();
        const raw = data?.choices?.[0]?.message?.content;
        if (!raw) return { ok: false, payload: { usage: data?.usage }, error: 'empty model response' };

        let fields: Record<string, unknown>;
        try {
            fields = JSON.parse(raw);
        } catch {
            return { ok: false, payload: { raw, usage: data?.usage }, error: 'model response was not valid JSON' };
        }
        return { ok: true, fields, payload: { raw: fields, usage: data?.usage } };
    } catch (e) {
        clearTimeout(timeoutId);
        const aborted = e instanceof Error && e.name === 'AbortError';
        if (!aborted) console.warn('[BillOCR] Groq call failed:', e instanceof Error ? e.message : e);
        return { ok: false, payload: {}, error: aborted ? 'Groq call timed out' : 'Groq call failed' };
    }
}

/**
 * Per-field confidence, coerced and clamped.
 *
 * A field the model left null is scored 0 regardless of what it claimed — "confident about
 * a value I did not read" is not a state we record. Any field the model omitted from its
 * confidence map is also 0, so a model that ignores rule 7 fails closed into review rather
 * than sailing through unscored.
 */
function normaliseConfidence(raw: unknown, parsed: ParsedBill): Record<string, number> {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const valueByField: Record<string, unknown> = {
        provider: parsed.provider,
        consumer_number: parsed.consumerNumber,
        billing_month: parsed.billingMonth,
        bill_date: parsed.billDate,
        due_date: parsed.dueDate,
        total_amount: parsed.totalAmount,
        early_payment_date: parsed.earlyPaymentDate,
        early_payment_amount: parsed.earlyPaymentAmount,
        after_due_amount: parsed.afterDueAmount,
        billed_units: parsed.billedUnits,
        billed_units_unit: parsed.billedUnitsUnit,
    };

    const out: Record<string, number> = {};
    for (const field of OCR_FIELDS) {
        if (valueByField[field] === null || valueByField[field] === undefined) { out[field] = 0; continue; }
        const n = Number(src[field]);
        out[field] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
    }
    return out;
}

/** The weakest CRITICAL field — what the Inbox flags and sorts on. */
export function weakestField(confidence: Record<string, number>): { field: string; value: number } | null {
    let worst: { field: string; value: number } | null = null;
    for (const field of CRITICAL_FIELDS) {
        const value = confidence[field];
        if (typeof value !== 'number') continue;
        if (!worst || value < worst.value) worst = { field, value };
    }
    return worst;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const date = (v: unknown) => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * Any finite number, sign included. Blank and the sheets' '-' placeholder parse to null
 * rather than 0 — Number('') is 0, and a zero that means "not printed" would show up as a
 * bill with no energy charge at all.
 */
const signed = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/[,₹\s]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

/** Readings, loads and ratios: zero is legitimate (a fresh meter), negative is not. */
const nonNegative = (v: unknown) => {
    const n = signed(v);
    return n !== null && n >= 0 ? n : null;
};

/** Coerce the model's loose output into typed fields; anything unusable becomes null. */
function normalise(f: Record<string, unknown>, masterSrc?: unknown): ParsedBill {
    const num = (v: unknown) => {
        const n = signed(v);
        return n !== null && n > 0 ? n : null;
    };
    const month = date(f.billing_month);

    return {
        ...EMPTY_PARSED,
        provider: str(f.provider),
        consumerNumber: str(f.consumer_number),
        // Hard-pin the month grain to the 1st, same as the table constraint.
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
        ...normaliseMaster(masterSrc),
    };
}

/**
 * The Bill Master block. Returns {} — not a set of nulls — when the model sent no master
 * object, so a parse that never looked cannot overwrite figures already on the bill.
 *
 * Charge heads keep their sign (a credit adjustment is negative); readings, loads and the
 * multiplying factor reject negatives, which are always a misread rather than a real value.
 */
function normaliseMaster(raw: unknown): BillMasterFields {
    if (!raw || typeof raw !== 'object') return {};
    const m = raw as Record<string, unknown>;

    return {
        billNumber: str(m.bill_number),
        meterNo: str(m.meter_no),
        consumerName: str(m.consumer_name),
        tariffCategory: str(m.tariff_category),
        sanctionedLoadKw: nonNegative(m.sanctioned_load_kw),
        contractDemandKva: nonNegative(m.contract_demand_kva),
        recordedDemandKva: nonNegative(m.recorded_demand_kva),
        powerFactor: nonNegative(m.power_factor),
        billingPeriodStart: date(m.billing_period_start),
        billingPeriodEnd: date(m.billing_period_end),
        previousReading: nonNegative(m.previous_reading),
        currentReading: nonNegative(m.current_reading),
        previousReadingDate: date(m.previous_reading_date),
        currentReadingDate: date(m.current_reading_date),
        multiplyingFactor: nonNegative(m.multiplying_factor),
        energyCharges: signed(m.energy_charges),
        fixedCharges: signed(m.fixed_charges),
        electricityDuty: signed(m.electricity_duty),
        taxAmount: signed(m.tax_amount),
        fuelSurcharge: signed(m.fuel_surcharge),
        otherCharges: signed(m.other_charges),
        adjustments: signed(m.adjustments),
        arrears: signed(m.arrears),
        interestCharges: signed(m.interest_charges),
    };
}
