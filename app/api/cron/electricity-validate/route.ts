import { NextRequest, NextResponse } from 'next/server';
import { validatePendingBills } from '@/backend/lib/electricity/validate';

// Nightly validation pass over every bill in 'parsed' / 'validating' / 'chasing'
// (Phase 2 of docs/ELECTRICITY_AUTOMATION_PLAN.md). Bearer-guarded like the other
// cron routes. 'chasing' is re-checked so a bill whose readings were fixed during
// the day recovers to 'validated' without a manual re-run.
//
// vercel.json schedule (added separately — not part of this change):
//   17 2 * * *  ->  /api/cron/electricity-validate

export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await validatePendingBills();
    // A run where nothing could be validated must not read as healthy in Vercel's cron log.
    const ok = summary.failed === 0;
    return NextResponse.json({ ok, ...summary }, { status: ok ? 200 : 500 });
}
