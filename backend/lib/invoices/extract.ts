/**
 * Reads one invoice file into structured fields. Reading only: whether the invoice is
 * RIGHT is decided by match.ts, from numbers, never from this model's opinion.
 *
 * Three paths, picked by what the file actually contains:
 *   - PDF with a text layer  -> pdfjs text -> one text-model call
 *   - scanned PDF            -> rasterize -> vision model (same helper Document Bank uses)
 *   - JPEG / PNG             -> vision model on the image itself
 *
 * Nothing is guessed. A field the model cannot read comes back null with confidence 0,
 * and match.ts treats null as UNKNOWN. Failures come back as { ok:false, error } so the
 * invoice stays recoverable in the review queue; this function never throws.
 */

import { extractPdfText } from '@/backend/lib/documentBank/ocr';
import { rasterizePdf } from '@/backend/lib/ocr/rasterize';
import { visionExtract } from '@/backend/lib/ocr/vision';
import { councilChat } from '@/backend/lib/council/llm';

/** Text path model. Measured fast tier, same choice and reason as backend/lib/wiki/ask.ts. */
export const INVOICE_TEXT_MODEL = process.env.INVOICE_EXTRACT_MODEL?.trim() || 'deepseek-v4-flash-0731';

/**
 * How many pages of a scanned invoice are read in total. A long invoice carries its line
 * items across pages, so stopping early silently loses rows — and a partial read can
 * still look tidy. The pages are read in batches of PAGES_PER_CALL and merged, rather
 * than in one call, because a vision model's answer degrades as the image count grows.
 * Beyond MAX_PAGES the read is marked truncated, which match.ts treats as blocking.
 */
const MAX_PAGES = Math.max(1, Number(process.env.INVOICE_MAX_PAGES || 24));
const PAGES_PER_CALL = Math.max(1, Number(process.env.INVOICE_PAGES_PER_CALL || 4));
const TEXT_CHAR_LIMIT = 24_000;
/** Below this many characters a PDF is treated as scanned, whatever pdfjs says. */
const MIN_TEXT_CHARS = 120;

export interface ExtractedLine {
    description: string;
    item_code: string | null;
    hsn_or_sac: string | null;
    quantity: number | null;
    unit: string | null;
    unit_rate: number | null;
    taxable_amount: number | null;
    tax_rate: number | null;
    tax_amount: number | null;
    line_total: number | null;
    confidence: number | null; // 0-1
}

export interface ExtractedInvoice {
    invoice_number: string | null;
    invoice_date: string | null; // YYYY-MM-DD
    vendor_name: string | null;
    vendor_gstin: string | null;
    currency: string | null;
    taxable_amount: number | null;
    tax_amount: number | null;
    other_charges: number | null;
    discount_amount: number | null;
    invoice_total: number | null;
    /** Read for display and cross-checking only; nothing here decides a match. */
    buyer_name?: string | null;
    buyer_gstin?: string | null;
    po_reference?: string | null;
    due_date?: string | null;
    cgst_amount?: number | null;
    sgst_amount?: number | null;
    igst_amount?: number | null;
    round_off?: number | null;
    /** Header fields worked out from other printed figures because the read disagreed with itself. Shown to the person. */
    repairs?: string[];
    lines: ExtractedLine[];
    /** 0-100 per header field: invoice_number, invoice_date, taxable_amount, invoice_total, vendor. */
    field_confidence: Record<string, number>;
}

export interface ExtractResult {
    ok: boolean;
    extracted: ExtractedInvoice | null;
    provider: string;
    model: string;
    path: 'pdf_text' | 'pdf_scan' | 'image';
    error?: string;
    /** Pages actually read. Null on the text path, where paging does not apply. */
    pagesRead?: number | null;
    /** Pages the document has, as reported by the rasterizer. */
    totalPages?: number | null;
    /** True when the document has more pages than were read. Never silent: match.ts blocks on it. */
    truncated?: boolean;
}

const SCHEMA_PROMPT = `You read Indian GST tax invoices and return ONLY one JSON object:
{
 "invoice": {
   "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null,
   "vendor_name": string|null, "vendor_gstin": string|null, "currency": "INR"|string|null,
   "taxable_amount": number|null, "tax_amount": number|null,
   "other_charges": number|null, "discount_amount": number|null, "invoice_total": number|null,
   "buyer_name": string|null, "buyer_gstin": string|null, "po_reference": string|null, "due_date": "YYYY-MM-DD"|null,
   "cgst_amount": number|null, "sgst_amount": number|null, "igst_amount": number|null, "round_off": number|null
 },
 "lines": [ { "description": string, "item_code": string|null, "hsn_or_sac": string|null,
              "quantity": number|null, "unit": string|null, "unit_rate": number|null,
              "taxable_amount": number|null, "tax_rate": number|null, "tax_amount": number|null,
              "line_total": number|null, "confidence": 0-100 } ],
 "confidence": { "invoice_number": 0-100, "invoice_date": 0-100, "taxable_amount": 0-100, "invoice_total": 0-100, "vendor": 0-100 }
}
RULES
1. The vendor is the SELLER who issued the invoice, not the buyer. vendor_gstin is the seller's 15-character GSTIN.
2. Amounts are plain numbers in rupees with no currency symbol or thousands separators. "1,23,456.50" is 123456.5.
3. taxable_amount is the value GST is charged ON: the subtotal the CGST/SGST/IGST lines are calculated from, AFTER any service or management charge rows, and not an intermediate "Total" printed above them. tax_amount is total GST (CGST+SGST or IGST together). invoice_total is the grand total payable.
3a. Every printed row that carries an amount is its own line, including percentage rows such as "Management & Consultancy Services 8%" (quantity and unit_rate null, taxable_amount the amount shown). Never merge two rows into one line, and never attach a row's description to a different row.
4. other_charges is freight, packing and similar charges added to the bill. discount_amount is a positive number for any discount taken off.
5. tax_rate on a line is the combined GST percentage (CGST 9% + SGST 9% is 18).
6. Use null for anything you cannot read. NEVER calculate, estimate or invent a figure that is not printed. Do not make totals add up.
7. Dates are YYYY-MM-DD. Indian dates are day first: 05/10/2026 is 5 October 2026.
8. Confidence is per field, honest, and must vary: 90-100 clearly printed and labelled; 60-89 read but the layout was unclear; 1-59 smudged or you had to choose between candidates; 0 not readable (the value is null).
10. A line's tax_rate, tax_amount and taxable_amount are filled ONLY when printed on that line. When the invoice prints tax once at the bottom (CGST/SGST/IGST totals), leave every line's tax_rate and tax_amount null. Never use 0 for "not printed". Do not output a row that has no amount (a heading or a description-only row): put its words into the description of the line it introduces.
9. buyer_name and buyer_gstin are the BILL TO party (the customer being invoiced), never the seller. po_reference is a purchase-order number printed on the invoice. cgst_amount, sgst_amount and igst_amount are the tax amounts exactly as printed, each only if printed. round_off is the printed rounding adjustment (negative when it is subtracted). due_date is only a date printed as the payment due date.
9. One entry in "lines" per row of the line-item table, in order. Do not include totals rows.`;


/**
 * Does taxable + tax (+ other charges - discount) equal the total, to within ₹2 of rounding?
 * null when a figure is missing, so the question cannot be asked.
 */
function headerAddsUp(e: ExtractedInvoice): boolean | null {
    if (e.taxable_amount == null || e.tax_amount == null || e.invoice_total == null) return null;
    return Math.abs(e.taxable_amount + e.tax_amount + (e.other_charges ?? 0) - (e.discount_amount ?? 0) - e.invoice_total) <= 2;
}

/**
 * Do the line amounts add up to the taxable amount? A read that dropped a row (it happens when a PDF's
 * text comes out jumbled) fails this. Charges and discounts printed outside the lines are allowed for.
 * null when there is nothing to compare.
 */
function linesAddUp(e: ExtractedInvoice): boolean | null {
    if (e.taxable_amount == null || !e.lines.length) return null;
    const amounts = e.lines.map((l) => l.taxable_amount ?? l.line_total).filter((v): v is number => v != null);
    if (!amounts.length) return null;
    const sum = amounts.reduce((a, b) => a + b, 0);
    const tol = Math.max(2, e.taxable_amount * 0.001);
    const other = e.other_charges ?? 0, disc = e.discount_amount ?? 0;
    return [e.taxable_amount, e.taxable_amount - other, e.taxable_amount + disc, e.taxable_amount - other + disc].some((t) => Math.abs(sum - t) <= tol);
}

/** A read worth trusting without a second look: nothing essential missing, and the figures add up. */
const readIsSound = (e: ExtractedInvoice) => missingKeyFields(e).length === 0 && headerAddsUp(e) !== false && linesAddUp(e) !== false;

/** Lower is better: missing fields weigh most, then figures that do not add up. */
const readScore = (e: ExtractedInvoice) => missingKeyFields(e).length * 10 + (headerAddsUp(e) === false ? 5 : 0) + (linesAddUp(e) === false ? 3 : 0);

/** The fields every invoice must give us before a read can be trusted. */
function missingKeyFields(e: ExtractedInvoice): string[] {
    const gone: string[] = [];
    if (!e.invoice_number) gone.push('invoice_number');
    if (!e.invoice_date) gone.push('invoice_date');
    if (e.invoice_total == null) gone.push('invoice_total');
    return gone;
}

/**
 * Put right a header figure the read got wrong, using only OTHER figures printed on the same invoice.
 *   - Tax: when CGST and SGST (or IGST) were read and they do not add to the tax total, the printed
 *     parts win. A model slips a digit in a total far more often than in both of its parts.
 *   - Taxable: when taxable + tax does not equal the total, but the printed line amounts DO make it
 *     equal, the line sum is the taxable amount.
 * Nothing is invented: each repair must make the invoice add up, and is recorded in `repairs`.
 */
export function reconcile(e: ExtractedInvoice): ExtractedInvoice {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const repairs: string[] = [];
    const out: ExtractedInvoice = { ...e, field_confidence: { ...e.field_confidence } };

    const hasParts = (out.cgst_amount != null && out.sgst_amount != null) || out.igst_amount != null;
    if (hasParts) {
        const parts = r2((out.cgst_amount ?? 0) + (out.sgst_amount ?? 0) + (out.igst_amount ?? 0));
        if (out.tax_amount == null || (Math.abs(parts - out.tax_amount) > 0.01 && Math.abs(parts - out.tax_amount) <= 10)) { out.tax_amount = parts; repairs.push('tax_amount'); }
    }
    if (headerAddsUp(out) === false) {
        const amounts = out.lines.map((l) => l.taxable_amount ?? l.line_total).filter((v): v is number => v != null);
        if (amounts.length) {
            const candidate = r2(amounts.reduce((a, b) => a + b, 0));
            if (headerAddsUp({ ...out, taxable_amount: candidate }) === true) {
                out.taxable_amount = candidate; repairs.push('taxable_amount');
                out.field_confidence.taxable_amount = Math.min(out.field_confidence.taxable_amount ?? 75, 75);
            }
        }
    }
    if (repairs.length) out.repairs = repairs;
    return out;
}

export async function extractInvoice(bytes: Buffer, mime: string): Promise<ExtractResult> {
    const r = await extractInvoiceRaw(bytes, mime);
    return r.ok && r.extracted ? { ...r, extracted: reconcile(r.extracted) } : r;
}

async function extractInvoiceRaw(bytes: Buffer, mime: string): Promise<ExtractResult> {
    const isPdf = mime === 'application/pdf';
    try {
        if (isPdf) {
            let text = '';
            try { text = await extractPdfText(bytes); } catch { text = ''; }
            if (text.length >= MIN_TEXT_CHARS) {
                const fromText = await viaText(text.slice(0, TEXT_CHAR_LIMIT));
                if (fromText.ok && fromText.extracted && readIsSound(fromText.extracted)) return fromText;
                // The text read is incomplete or does not add up. A PDF's text layer can be out of order or
                // hold only fragments (labels drawn as shapes, a jumbled table), and a model reading it then
                // guesses. Look at the page itself as well and keep the better read; the text read stays the
                // fallback. "Better" is decided by arithmetic and completeness, never by which model sounds sure.
                const seen = await rasterizePdf(bytes, { maxPages: MAX_PAGES });
                if (seen.pages.length) {
                    const fromImage = await viaVision('pdf_scan', seen.pages);
                    if (fromImage.ok && fromImage.extracted && (!fromText.ok || !fromText.extracted || readScore(fromImage.extracted) < readScore(fromText.extracted))) {
                        return { ...fromImage, pagesRead: seen.pages.length, totalPages: seen.totalPages, truncated: seen.totalPages > seen.pages.length };
                    }
                }
                return fromText;
            }

            const raster = await rasterizePdf(bytes, { maxPages: MAX_PAGES });
            if (!raster.pages.length) {
                return fail('pdf_scan', `scanned PDF could not be rasterized${raster.warnings[0] ? `: ${raster.warnings[0]}` : ''}`);
            }
            const out = await viaVision('pdf_scan', raster.pages);
            return {
                ...out,
                pagesRead: raster.pages.length,
                totalPages: raster.totalPages,
                truncated: raster.totalPages > raster.pages.length,
            };
        }
        const img = await viaVision('image', [{ buffer: bytes, mime }]);
        return { ...img, pagesRead: 1, totalPages: 1, truncated: false };
    } catch (e) {
        return fail(isPdf ? 'pdf_text' : 'image', e instanceof Error ? e.message : 'extraction failed');
    }
}

async function viaText(text: string): Promise<ExtractResult> {
    let raw: string;
    try {
        raw = await councilChat([
            { role: 'system', content: SCHEMA_PROMPT },
            { role: 'user', content: `Extract the invoice from this text:\n\n${text}` },
        ], 'synthesis', { model: INVOICE_TEXT_MODEL, thinkingOff: true });
    } catch (e) {
        return fail('pdf_text', e instanceof Error ? e.message : 'text model call failed');
    }
    const parsed = parseJson(raw);
    if (!parsed) return fail('pdf_text', 'model response was not valid JSON');
    return { ok: true, extracted: normalise(parsed), provider: 'council', model: INVOICE_TEXT_MODEL, path: 'pdf_text' };
}

async function viaVision(path: 'pdf_scan' | 'image', pages: { buffer: Buffer; mime: 'image/jpeg' | string }[]): Promise<ExtractResult> {
    const batches: typeof pages[] = [];
    for (let i = 0; i < pages.length; i += PAGES_PER_CALL) batches.push(pages.slice(i, i + PAGES_PER_CALL));

    const reads: ExtractedInvoice[] = [];
    let provider = 'none';
    let model = '';
    let firstError: string | null = null;

    for (let i = 0; i < batches.length; i++) {
        const first = i === 0;
        const v = await visionExtract({
            pages: batches[i] as Parameters<typeof visionExtract>[0]['pages'],
            json: true,
            maxTokens: 4000,
            thinkingOff: true,
            instruction: `${SCHEMA_PROMPT}\n\n${batches.length === 1
                ? 'Extract the invoice from these page images.'
                : `These are pages ${i * PAGES_PER_CALL + 1}-${i * PAGES_PER_CALL + batches[i].length} of a ${pages.length}-page invoice. ` +
                  `Extract every line-item row you can see on THESE pages. ` +
                  `${first ? 'Header fields and totals may appear here.' : 'If a header field or a total is not printed on these pages, return null for it rather than repeating or guessing it.'}`}`,
        });
        provider = v.provider || provider;
        model = v.model || model;
        if (!v.ok || !v.data) { firstError ??= v.error ?? 'vision returned no parseable JSON'; continue; }
        reads.push(normalise(v.data));
    }

    // Every batch failed: this is a failed read, not an empty invoice.
    if (!reads.length) return { ...fail(path, firstError ?? 'vision returned no parseable JSON'), provider, model };
    return { ok: true, extracted: mergeReads(reads), provider, model, path };
}

/**
 * Join the per-batch readings into one invoice.
 *
 * Header fields and totals are printed once, usually on the first or last page, so the
 * first non-null answer wins and later batches are told to return null rather than guess.
 * Line items are the opposite: they run across pages, so they are concatenated in order.
 */
function mergeReads(reads: ExtractedInvoice[]): ExtractedInvoice {
    if (reads.length === 1) return reads[0];
    const firstNonNull = <K extends keyof ExtractedInvoice>(key: K): ExtractedInvoice[K] => {
        for (const r of reads) {
            const v = r[key];
            if (v !== null && v !== undefined && v !== '') return v;
        }
        return reads[0][key];
    };
    const confidence: Record<string, number> = {};
    for (const r of reads) {
        for (const [k, v] of Object.entries(r.field_confidence ?? {})) {
            // Keep the confidence that belongs to the value actually kept: the first
            // batch that read the field at all.
            if (!(k in confidence) && typeof v === 'number' && v > 0) confidence[k] = v;
        }
    }
    return {
        ...reads[0],
        invoice_number: firstNonNull('invoice_number'),
        invoice_date: firstNonNull('invoice_date'),
        vendor_name: firstNonNull('vendor_name'),
        vendor_gstin: firstNonNull('vendor_gstin'),
        currency: firstNonNull('currency'),
        taxable_amount: firstNonNull('taxable_amount'),
        tax_amount: firstNonNull('tax_amount'),
        other_charges: firstNonNull('other_charges'),
        discount_amount: firstNonNull('discount_amount'),
        invoice_total: firstNonNull('invoice_total'),
        field_confidence: confidence,
        lines: reads.flatMap((r) => r.lines),
    };
}

function fail(path: ExtractResult['path'], error: string): ExtractResult {
    return { ok: false, extracted: null, provider: 'none', model: '', path, error };
}

function parseJson(raw: string): Record<string, unknown> | null {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
function num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v.replace(/[₹,\s]/g, ''));
        if (v.trim() && Number.isFinite(n)) return n;
    }
    return null;
}
const date = (v: unknown): string | null => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const clampConf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; };

/** Exported for tests. Turns the model's JSON into the typed shape, dropping what is malformed. */
export function normalise(raw: Record<string, unknown>): ExtractedInvoice {
    const inv = (raw.invoice && typeof raw.invoice === 'object' ? raw.invoice : raw) as Record<string, unknown>;
    const conf = (raw.confidence && typeof raw.confidence === 'object' ? raw.confidence : {}) as Record<string, unknown>;
    // Tolerate "GSTIN: 27ABC..." and spaced-out forms: pull the 15-character GSTIN out of whatever came back.
    const cleanGstin = (v: unknown) => { const g = str(v)?.toUpperCase().replace(/[\s\-:.]+/g, '').match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]/)?.[0] ?? null; return g && /^[0-9A-Z]{15}$/.test(g) ? g : null; };
    const gstin = cleanGstin(inv.vendor_gstin);

    const header = {
        invoice_number: str(inv.invoice_number),
        invoice_date: date(inv.invoice_date),
        vendor_name: str(inv.vendor_name),
        vendor_gstin: gstin,
        currency: str(inv.currency)?.toUpperCase().slice(0, 3) ?? null,
        taxable_amount: num(inv.taxable_amount),
        tax_amount: num(inv.tax_amount),
        other_charges: num(inv.other_charges),
        discount_amount: num(inv.discount_amount),
        invoice_total: num(inv.invoice_total),
        buyer_name: str(inv.buyer_name),
        buyer_gstin: cleanGstin(inv.buyer_gstin),
        po_reference: str(inv.po_reference),
        due_date: date(inv.due_date),
        cgst_amount: num(inv.cgst_amount),
        sgst_amount: num(inv.sgst_amount),
        igst_amount: num(inv.igst_amount),
        round_off: num(inv.round_off),
    };

    // A field the reader could not fill must not carry confidence.
    const field_confidence: Record<string, number> = {
        invoice_number: header.invoice_number ? clampConf(conf.invoice_number) : 0,
        invoice_date: header.invoice_date ? clampConf(conf.invoice_date) : 0,
        taxable_amount: header.taxable_amount != null ? clampConf(conf.taxable_amount) : 0,
        invoice_total: header.invoice_total != null ? clampConf(conf.invoice_total) : 0,
        vendor: header.vendor_gstin || header.vendor_name ? clampConf(conf.vendor) : 0,
    };

    const rows = Array.isArray(raw.lines) ? raw.lines : [];
    const lines: ExtractedLine[] = [];
    for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const l = r as Record<string, unknown>;
        const description = str(l.description);
        if (!description) continue;
        lines.push({
            description,
            item_code: str(l.item_code),
            hsn_or_sac: str(l.hsn_or_sac),
            quantity: num(l.quantity),
            unit: str(l.unit),
            unit_rate: num(l.unit_rate),
            taxable_amount: num(l.taxable_amount),
            tax_rate: num(l.tax_rate),
            tax_amount: num(l.tax_amount),
            line_total: num(l.line_total),
            confidence: l.confidence == null ? null : clampConf(l.confidence) / 100,
        });
        if (lines.length >= 200) break;
    }
    return { ...header, lines, field_confidence };
}
