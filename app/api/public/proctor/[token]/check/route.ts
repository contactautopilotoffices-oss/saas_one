import { NextRequest, NextResponse } from 'next/server';
import { loadTestByPublicToken } from '@/backend/lib/proctor/start';
import { loadStanding } from '@/backend/lib/proctor/chances';

/**
 * POST /api/public/proctor/[token]/check — how many chances this email has left
 * (counting HR's extra chances and resets), and whether an interrupted attempt
 * can be picked up again.
 *
 * Called before the camera is switched on, so somebody who has used every
 * chance goes no further than the first screen instead of finding out after
 * going fullscreen. Returns nothing but counts: no questions, nobody else's
 * attempt.
 * Body: { email }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

    const test = await loadTestByPublicToken(token);
    if (!test || !test.is_active) return NextResponse.json({ error: 'This test link is closed' }, { status: 404 });

    const standing = await loadStanding(test, { kind: 'candidate', name: '', email });
    const carriesOn = !!(standing.resumable || standing.live);

    return NextResponse.json({
        max_attempts: standing.allowed,
        attempts_used: standing.used,
        chances_left: carriesOn ? Math.max(1, standing.left) : standing.left,
        completed: standing.completed,
        last_reason: standing.lastReason,
        resumable: carriesOn,
    });
}
