/**
 * Groq vision/text parse of one Document Bank upload (AMC contract, statutory/calibration
 * certificate, OEM manual, warranty card, SLD) into the fields the audit checklist actually
 * asks for: what the document is, its number/issuer, and its validity window.
 *
 * Model + budget note: same qwen/qwen3.8-27b call as
 * backend/lib/electricity/billOcr.ts and app/api/ocr/meter/route.ts, sharing the same
 * GROQ_API_KEY. Document Bank uploads are occasional (audit evidence, not a high-volume
 * feed), so this stays well inside the shared daily budget.
 *
 * PARSING PATH: PDFs are read as text via pdfjs-dist first — AMC contracts and statutory
 * certs are almost always digital, not scanned. Images (jpg/png of a certificate) go
 * straight to the vision path using a signed URL, the same way app/api/ocr/meter/route.ts
 * passes `imageUrl` directly rather than base64-encoding. A scanned PDF with no text layer
 * degrades honestly to ocr_status 'failed' — same as billOcr.ts, nothing is guessed.
 */

import { rasterizePdf } from '@/backend/lib/ocr/rasterize';
import { visionExtract } from '@/backend/lib/ocr/vision';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Was qwen/qwen3.8-27b until 2026-09-05, when Groq
// retired it — every OCR path 404'd with model_not_found. qwen3.8-27b is the
// vision model still served on this key; verified against a test invoice for
// both free-text transcription and response_format:json_object.
const MODEL = 'qwen/qwen3.8-27b';
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 3;
const TEXT_CHAR_LIMIT = 12_000;

export interface ExtractedDocFields {
    docType: string | null;      // model's free-text guess, e.g. "AMC Contract", "Calibration Certificate"
    docNumber: string | null;    // contract/certificate/PO number
    vendorName: string | null;   // issuing vendor / OEM / certifying body
    equipment: string | null;    // e.g. "DG Set", "UPS", "STP" — matches the audit checklist's Equipment column
    issueDate: string | null;    // YYYY-MM-DD
    validFrom: string | null;    // YYYY-MM-DD — AMC/certificate validity start
    validTo: string | null;      // YYYY-MM-DD — AMC/certificate validity end (expiry)
    confidence: number | null;   // 0-100, weakest of validFrom/validTo/docNumber
    fieldConfidence: Record<string, number>;
}

export interface DocOcrResult {
    extracted: ExtractedDocFields | null;
    text: string | null; // full extracted text, folded into search
    payload: Record<string, unknown>;
    error?: string;
}

const EMPTY: ExtractedDocFields = {
    docType: null, docNumber: null, vendorName: null, equipment: null,
    issueDate: null, validFrom: null, validTo: null, confidence: null, fieldConfidence: {},
};

const FIELDS = ['doc_type', 'doc_number', 'vendor_name', 'equipment', 'issue_date', 'valid_from', 'valid_to'] as const;
const CRITICAL_FIELDS = ['valid_from', 'valid_to', 'doc_number'] as const;

const SYSTEM_PROMPT = `You extract structured fields from facility-compliance documents: AMC (Annual Maintenance Contract) agreements, warranty cards, calibration certificates, statutory/consent certificates, OEM manuals, single-line diagrams and similar audit evidence for DG sets, UPS systems, STPs and other building equipment.

Return ONLY a valid JSON object with TWO keys, "fields" and "confidence":
{"fields": {"doc_type": string|null, "doc_number": string|null, "vendor_name": string|null, "equipment": string|null, "issue_date": "YYYY-MM-DD"|null, "valid_from": "YYYY-MM-DD"|null, "valid_to": "YYYY-MM-DD"|null},
 "confidence": {"doc_type": 0-100, "doc_number": 0-100, "vendor_name": 0-100, "equipment": 0-100, "issue_date": 0-100, "valid_from": 0-100, "valid_to": 0-100}}

RULES:
1. doc_type is a short label for what kind of document this is (e.g. "AMC Contract", "Calibration Certificate", "Warranty Card", "Consent to Operate", "OEM Manual").
2. doc_number is the contract/certificate/PO/reference number printed on the document.
3. vendor_name is the issuing vendor, OEM, contractor or certifying authority.
4. equipment is the specific asset this document covers if stated (e.g. "DG Set", "UPS", "STP", "Fire Panel") — null if the document is general (e.g. a KYC doc).
5. valid_from / valid_to is the contract or certificate's validity window (start and expiry dates) — this is the single most important field pair; read carefully, it may be phrased as "valid until", "expiry date", "AMC period", "certificate valid up to", etc. issue_date is when the document was issued/signed, which may differ from valid_from.
6. Dates must be YYYY-MM-DD. Use null, never invent a value you cannot read.
7. CONFIDENCE IS PER FIELD, and they must differ, scored on how clearly you read that field:
   - 90-100: printed clearly and unambiguously labelled.
   - 60-89: read it, but the label was ambiguous or the layout unusual.
   - 1-59: partly obscured, smudged, inferred from context, or you had to pick between candidates.
   - 0: could not read it at all (the field is null).`;

/** Below this, a field is not trusted enough to auto-fill — the uploader's own entry (if any) wins. */
export const FIELD_REVIEW_THRESHOLD = 60;

/** Parse one uploaded file. Never throws — failures come back as { extracted: null, error }. */
export async function parseDocument(fileBytes: Buffer, mimeType: string, signedUrl: string | null): Promise<DocOcrResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return { extracted: null, text: null, payload: {}, error: 'GROQ_API_KEY not set' };

    const isPdf = mimeType === 'application/pdf';
    let text = '';
    if (isPdf) {
        try {
            text = await extractPdfText(fileBytes);
        } catch (e) {
            return { extracted: null, text: null, payload: {}, error: `pdf text extraction failed: ${e instanceof Error ? e.message : e}` };
        }
    }

    let content: any[] | undefined;
    let visionResult: { fields: Record<string, unknown>; payload: Record<string, unknown> } | null = null;
    if (text) {
        content = [{ type: 'text', text: `Extract the fields from this document text:\n\n${text}` }];
    } else if (!isPdf && signedUrl) {
        content = [
            { type: 'text', text: 'Extract the fields from this document image.' },
            { type: 'image_url', image_url: { url: signedUrl } },
        ];
    } else if (isPdf) {
        // SCANNED PDF — no text layer. Until 2026-09-05 this returned
        // 'no text layer and no image fallback available' and the upload died as
        // ocr_status 'failed'. Now the pages are rasterized and read by a vision
        // model. Note this path CANNOT use a signed URL: ENGY documents, and its
        // API enforces, that images arrive as base64 data: URIs — so the buffers
        // go through backend/lib/ocr/vision.ts, which encodes them itself.
        const raster = await rasterizePdf(fileBytes, { maxPages: MAX_PAGES });
        if (!raster.pages.length) {
            return {
                extracted: null, text: null,
                payload: { raster_warnings: raster.warnings, total_pages: raster.totalPages },
                error: `scanned PDF could not be rasterized${raster.warnings.length ? `: ${raster.warnings[0]}` : ''}`,
            };
        }

        const vision = await visionExtract({
            pages: raster.pages,
            json: true,
            instruction: `${SYSTEM_PROMPT}\n\nExtract the fields from these scanned document pages.`,
        });

        if (!vision.ok || !vision.data) {
            return {
                extracted: null, text: vision.text ?? null,
                payload: {
                    source: 'rasterized_pdf', model: vision.model, provider: vision.provider,
                    usage: vision.usage, pages_rendered: raster.pages.length,
                    raster_warnings: raster.warnings,
                },
                error: vision.error ?? 'vision returned no parseable JSON',
            };
        }

        visionResult = {
            fields: vision.data,
            payload: {
                source: 'rasterized_pdf', model: vision.model, provider: vision.provider,
                usage: vision.usage, pages_rendered: raster.pages.length,
                total_pages: raster.totalPages, raster_warnings: raster.warnings,
            },
        };
        text = vision.text ?? '';
    } else {
        // An image upload with no signed URL to read. Nothing to send.
        return { extracted: null, text: null, payload: {}, error: 'no text layer and no image fallback available' };
    }

    let result: { ok: true; fields: unknown; payload: Record<string, unknown> } | GroqCallErr;
    if (visionResult) {
        result = { ok: true, fields: visionResult.fields, payload: visionResult.payload };
    } else {
        result = await callGroq(apiKey, content!);
    }
    if (!result.ok) return { extracted: null, text: text || null, payload: result.payload, error: result.error };

    const raw = result.fields as Record<string, unknown>;
    const nested = raw && typeof raw.fields === 'object' && raw.fields !== null;
    const fieldSrc = (nested ? raw.fields : raw) as Record<string, unknown>;
    const confSrc = nested ? raw.confidence : undefined;

    const extracted = normalise(fieldSrc);
    extracted.fieldConfidence = normaliseConfidence(confSrc, extracted);
    const weakest = weakestField(extracted.fieldConfidence);
    extracted.confidence = weakest ? weakest.value : null;

    return { extracted, text: text || null, payload: { ...result.payload, field_confidence: extracted.fieldConfidence } };
}

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
            console.error('[DocumentBank OCR] Groq API error:', response.status, errorText.slice(0, 500));
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
        if (!aborted) console.warn('[DocumentBank OCR] Groq call failed:', e instanceof Error ? e.message : e);
        return { ok: false, payload: {}, error: aborted ? 'Groq call timed out' : 'Groq call failed' };
    }
}

function normaliseConfidence(raw: unknown, extracted: ExtractedDocFields): Record<string, number> {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const valueByField: Record<string, unknown> = {
        doc_type: extracted.docType, doc_number: extracted.docNumber, vendor_name: extracted.vendorName,
        equipment: extracted.equipment, issue_date: extracted.issueDate, valid_from: extracted.validFrom, valid_to: extracted.validTo,
    };
    const out: Record<string, number> = {};
    for (const field of FIELDS) {
        if (valueByField[field] === null || valueByField[field] === undefined) { out[field] = 0; continue; }
        const n = Number(src[field]);
        out[field] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
    }
    return out;
}

export function weakestField(confidence: Record<string, number>): { field: string; value: number } | null {
    let worst: { field: string; value: number } | null = null;
    for (const field of CRITICAL_FIELDS) {
        const value = confidence[field];
        if (typeof value !== 'number') continue;
        if (!worst || value < worst.value) worst = { field, value };
    }
    return worst;
}

function normalise(f: Record<string, unknown>): ExtractedDocFields {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const date = (v: unknown) => {
        const s = str(v);
        return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };
    return {
        ...EMPTY,
        docType: str(f.doc_type),
        docNumber: str(f.doc_number),
        vendorName: str(f.vendor_name),
        equipment: str(f.equipment),
        issueDate: date(f.issue_date),
        validFrom: date(f.valid_from),
        validTo: date(f.valid_to),
    };
}
