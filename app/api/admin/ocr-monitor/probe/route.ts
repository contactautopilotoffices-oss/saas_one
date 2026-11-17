/** POST /api/admin/ocr-monitor/probe — read the bundled sample invoice now and report. Master admin only. */
import { NextResponse } from 'next/server';
import { requireMasterAdmin, isCouncilAccessError } from '@/backend/lib/council/guard';
import { runOcrProbe } from '@/backend/lib/ocr/heartbeat';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
    const a = await requireMasterAdmin();
    if (isCouncilAccessError(a)) return a;
    return NextResponse.json(await runOcrProbe(a.user.id), { headers: { 'Cache-Control': 'no-store' } });
}
