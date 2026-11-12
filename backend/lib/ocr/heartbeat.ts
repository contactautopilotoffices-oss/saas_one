import { extractInvoice } from '@/backend/lib/invoices/extract';
import { withOcrActivity } from './activity';
import { PROBE_EXPECTED, PROBE_PDF_BASE64 } from './heartbeatSample';

/**
 * The OCR heartbeat: read a bundled fake invoice through the real pipeline (PDF text, the model, the
 * parser and the arithmetic checks) and compare the answer with the known one.
 *
 * Why it exists: a reader can be completely broken (the live-site PDF worker outage of 2 Nov 2026
 * failed every read for days) while nothing says so, because failures only show when someone uploads.
 * The probe runs every 15 minutes and on demand, so "the readers work" is a fact with a timestamp.
 * It costs about a hundredth of a cent a run.
 */

export interface ProbeCheck { name: string; ok: boolean; expected: unknown; got: unknown }
export interface ProbeResult { ok: boolean; ms: number; path: string | null; checks: ProbeCheck[]; error: string | null }

export async function runOcrProbe(userId: string | null = null): Promise<ProbeResult> {
    const t0 = Date.now();
    let checks: ProbeCheck[] = [];
    const r = await withOcrActivity(
        { source: 'heartbeat', filename: 'probe-invoice.pdf', contentType: 'application/pdf', userId },
        async () => {
            const read = await extractInvoice(Buffer.from(PROBE_PDF_BASE64, 'base64'), 'application/pdf');
            const e = read.extracted;
            const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 0.01;
            checks = e ? [
                { name: 'invoice number', expected: PROBE_EXPECTED.invoice_number, got: e.invoice_number, ok: e.invoice_number === PROBE_EXPECTED.invoice_number },
                { name: 'invoice date', expected: PROBE_EXPECTED.invoice_date, got: e.invoice_date, ok: e.invoice_date === PROBE_EXPECTED.invoice_date },
                { name: 'vendor GSTIN', expected: PROBE_EXPECTED.vendor_gstin, got: e.vendor_gstin, ok: e.vendor_gstin === PROBE_EXPECTED.vendor_gstin },
                { name: 'taxable amount', expected: PROBE_EXPECTED.taxable_amount, got: e.taxable_amount, ok: near(e.taxable_amount, PROBE_EXPECTED.taxable_amount) },
                { name: 'tax', expected: PROBE_EXPECTED.tax_amount, got: e.tax_amount, ok: near(e.tax_amount, PROBE_EXPECTED.tax_amount) },
                { name: 'total', expected: PROBE_EXPECTED.invoice_total, got: e.invoice_total, ok: near(e.invoice_total, PROBE_EXPECTED.invoice_total) },
                { name: 'line items', expected: PROBE_EXPECTED.lines, got: e.lines.length, ok: e.lines.length === PROBE_EXPECTED.lines },
            ] : [];
            return read;
        },
        (read) => {
            const wrong = checks.filter((c) => !c.ok).map((c) => c.name);
            return {
                ok: read.ok && !!read.extracted && wrong.length === 0, path: read.path,
                error: !read.ok || !read.extracted ? (read.error ?? 'the read failed') : wrong.length ? `Read did not match the known answer: ${wrong.join(', ')}` : null,
                fields: { checks: checks.map((c) => ({ name: c.name, ok: c.ok })) },
            };
        },
    );
    const wrong = checks.filter((c) => !c.ok).map((c) => c.name);
    const ok = r.ok && !!r.extracted && wrong.length === 0;
    return { ok, ms: Date.now() - t0, path: r.path ?? null, checks, error: ok ? null : (!r.ok || !r.extracted ? (r.error ?? 'the read failed') : `Read did not match the known answer: ${wrong.join(', ')}`) };
}
