import { NextRequest, NextResponse } from 'next/server';
import { advanceDueChases } from '@/backend/lib/electricity/chase';

// Hourly electricity chase driver (Phase 4 of docs/ELECTRICITY_AUTOMATION_PLAN.md):
// advances due touches, detects completions (missing readings now logged) and
// defaults (touch 3 + grace elapsed). Bearer-guarded like the other cron routes.
// vercel.json schedule: { "path": "/api/cron/electricity-chase", "schedule": "7 * * * *" }

export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await advanceDueChases();
    // A run with errors must not read as healthy in Vercel's cron log.
    return NextResponse.json(
        { ok: result.errors.length === 0, ...result },
        { status: result.errors.length === 0 ? 200 : 500 },
    );
}
