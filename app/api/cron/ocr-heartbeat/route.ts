/**
 * Every 15 minutes (vercel.json): read the bundled sample invoice through the real pipeline and log
 * the result, so the OCR Monitor can say whether the readers work right now. About $0.0001 a run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runOcrProbe } from '@/backend/lib/ocr/heartbeat';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const r = await runOcrProbe(null);
    return NextResponse.json({ ok: r.ok, ms: r.ms, path: r.path, error: r.error }, { status: r.ok ? 200 : 500 });
}
