import { NextRequest, NextResponse } from 'next/server';
import { openAttempt, loadTestByPublicToken } from '@/backend/lib/proctor/start';

/**
 * POST /api/public/proctor/[token]/start — begin an attempt from the public
 * link, with no account. The page has already turned the camera on and gone
 * fullscreen; only now are the questions handed over.
 *
 * The reply carries an attempt_token: the secret this browser sends back on
 * every later call, since there is no session to identify it.
 * Body: { name, email }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));

    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (name.length < 2) return NextResponse.json({ error: 'Enter your full name' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

    const test = await loadTestByPublicToken(token);
    if (!test) return NextResponse.json({ error: 'This test link is closed' }, { status: 404 });

    const outcome = await openAttempt(test, { kind: 'candidate', name, email });
    if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json(outcome);
}
