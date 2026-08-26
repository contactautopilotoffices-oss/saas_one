import { NextRequest, NextResponse } from 'next/server';
import { buildTodaysDigest, sendDigest, IRA_SPOC_EMAIL, IRA_FROM_EMAIL } from '@/backend/lib/ira/dailyDigest';

/**
 * GET  /api/ira/daily-digest            → renders the digest in the browser. Sends nothing.
 * GET  /api/ira/daily-digest?format=json → the parsed task list + subject.
 * POST /api/ira/daily-digest             → actually sends it.
 *
 * Sending is deliberately POST-only and gated on IRA_SEND_ENABLED, so no
 * cron, crawler or stray GET can mail the team by accident.
 */

export async function GET(request: NextRequest) {
    const { tasks, subject, html } = await buildTodaysDigest();

    if (request.nextUrl.searchParams.get('format') === 'json') {
        return NextResponse.json({
            subject,
            wouldSendTo: IRA_SPOC_EMAIL,
            wouldSendFrom: IRA_FROM_EMAIL,
            sendEnabled: process.env.IRA_SEND_ENABLED === 'true',
            taskCount: tasks.length,
            tasks,
        });
    }

    return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

export async function POST(request: NextRequest) {
    // Two independent guards: the env flag, and a matching secret for cron use.
    if (process.env.IRA_SEND_ENABLED !== 'true') {
        return NextResponse.json(
            { error: 'Sending disabled. Set IRA_SEND_ENABLED=true in .env to arm it.' },
            { status: 409 },
        );
    }

    const auth = request.headers.get('authorization');
    const secret = process.env.CRON_SECRET;
    const fromCron = secret && auth === `Bearer ${secret}`;
    const manual = request.nextUrl.searchParams.get('confirm') === 'yes';
    if (!fromCron && !manual) {
        return NextResponse.json(
            { error: 'Add ?confirm=yes (manual) or the CRON_SECRET bearer token.' },
            { status: 401 },
        );
    }

    const to = request.nextUrl.searchParams.get('to') || IRA_SPOC_EMAIL;
    const { subject, html, tasks } = await buildTodaysDigest();

    try {
        await sendDigest(to, subject, html);
        return NextResponse.json({ sent: true, to, subject, taskCount: tasks.length });
    } catch (e) {
        return NextResponse.json(
            { sent: false, error: (e as Error).message },
            { status: 500 },
        );
    }
}
