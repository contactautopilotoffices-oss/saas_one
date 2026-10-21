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

const MAX_PAGES = 4;
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
}

const SCHEMA_PROMPT = `You read Indian GST tax invoices and return ONLY one JSON object:
{
 "invoice": {
   "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null,
   "vendor_name": string|null, "vendor_gstin": string|null, "currency": "INR"|string|null,
   "taxable_amount": number|null, "tax_amount": number|null,
   "other_charges": number|null, "discount_amount": number|null, "invoice_total": number|null
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
3. taxable_amount is the value before GST. tax_amount is total GST (CGST+SGST or IGST together). invoice_total is the grand total payable.
4. other_charges is freight, packing and similar charges added to the bill. discount_amount is a positive number for any discount taken off.
5. tax_rate on a line is the combined GST percentage (CGST 9% + SGST 9% is 18).
6. Use null for anything you cannot read. NEVER calculate, estimate or invent a figure that is not printed. Do not make totals add up.
7. Dates are YYYY-MM-DD. Indian dates are day first: 05/10/2026 is 5 October 2026.
8. Confidence is per field, honest, and must vary: 90-100 clearly printed and labelled; 60-89 read but the layout was unclear; 1-59 smudged or you had to choose between candidates; 0 not readable (the value is null).
9. One entry in "lines" per row of the line-item table, in order. Do not include totals rows.`;

export async function extractInvoice(bytes: Buffer, mime: string): Promise<ExtractResult> {
    const isPdf = mime === 'application/pdf';
    try {
        if (isPdf) {
            let text = '';
            try { text = await extractPdfText(bytes); } catch { text = ''; }
            if (text.length >= MIN_TEXT_CHARS) return await viaText(text.slice(0, TEXT_CHAR_LIMIT));

            const raster = await rasterizePdf(bytes, { maxPages: MAX_PAGES });
            if (!raster.pages.length) {
                return fail('pdf_scan', `scanned PDF could not be rasterized${raster.warnings[0] ? `: ${raster.warnings[0]}` : ''}`);
            }
            return await viaVision('pdf_scan', raster.pages);
        }
        return await viaVision('image', [{ buffer: bytes, mime }]);
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
        ], 'synthesis', { model: INVOICE_TEXT_MODEL });
    } catch (e) {
        return fail('pdf_text', e instanceof Error ? e.message : 'text model call failed');
    }
    const parsed = parseJson(raw);
    if (!parsed) return fail('pdf_text', 'model response was not valid JSON');
    return { ok: true, extracted: normalise(parsed), provider: 'council', model: INVOICE_TEXT_MODEL, path: 'pdf_text' };
}

async function viaVision(path: 'pdf_scan' | 'image', pages: { buffer: Buffer; mime: 'image/jpeg' | string }[]): Promise<ExtractResult> {
    const v = await visionExtract({
        pages: pages as Parameters<typeof visionExtract>[0]['pages'],
        json: true,
        maxTokens: 4000,
        instruction: `${SCHEMA_PROMPT}\n\nExtract the invoice from these page images.`,
    });
    if (!v.ok || !v.data) return { ...fail(path, v.error ?? 'vision returned no parseable JSON'), provider: v.provider, model: v.model };
    return { ok: true, extracted: normalise(v.data), provider: v.provider, model: v.model, path };
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
    const gstin = str(inv.vendor_gstin)?.toUpperCase().replace(/\s+/g, '') ?? null;

    const header = {
        invoice_number: str(inv.invoice_number),
        invoice_date: date(inv.invoice_date),
        vendor_name: str(inv.vendor_name),
        vendor_gstin: gstin && /^[0-9A-Z]{15}$/.test(gstin) ? gstin : null,
        currency: str(inv.currency)?.toUpperCase().slice(0, 3) ?? null,
        taxable_amount: num(inv.taxable_amount),
        tax_amount: num(inv.tax_amount),
        other_charges: num(inv.other_charges),
        discount_amount: num(inv.discount_amount),
        invoice_total: num(inv.invoice_total),
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
