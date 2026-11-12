import { NextResponse } from 'next/server';
import { INVOICE_NOT_PROVISIONED, isMissingTable } from './settings';

export const send = (r: { status: number; body: Record<string, unknown> }) =>
    NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } });

/** A DB error as a response: a missing table is a clear "apply the migration", not a bare 500. */
export function dbError(error: { code?: string; message?: string }) {
    if (isMissingTable(error)) return NextResponse.json({ provisioned: false, error: INVOICE_NOT_PROVISIONED }, { status: 503 });
    console.error('[invoices] db error:', error.message);
    return NextResponse.json({ error: error.message ?? 'Database error' }, { status: 500 });
}

export const pageParams = (sp: URLSearchParams, defaultSize = 25) => {
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || String(defaultSize), 10) || defaultSize));
    return { page, size, from: (page - 1) * size, to: (page - 1) * size + size - 1 };
};

export const isUuid = (s: unknown): s is string =>
    typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Absolute origin for links people will paste into WhatsApp. */
export function appOrigin(request: Request): string {
    const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return new URL(request.url).origin;
}
