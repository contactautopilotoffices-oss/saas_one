/** GET /api/admin/ocr-monitor?source=&failed=1&limit= — the OCR Monitor's snapshot. Master admin only. Read-only. */
import { NextRequest, NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';
import { ocrSnapshot } from '@/backend/lib/ocr/monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireMasterAdmin();
    if (isCouncilAccessError(a)) return a;
    const sp = new URL(request.url).searchParams;
    const snap = await ocrSnapshot({ limit: Number(sp.get('limit')) || 100, source: sp.get('source') || null, failedOnly: sp.get('failed') === '1' });
    return NextResponse.json(snap, { headers: { 'Cache-Control': 'no-store' } });
}
