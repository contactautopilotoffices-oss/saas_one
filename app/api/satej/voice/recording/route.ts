/**
 * GET ?organizationId=&executionId= — one of Meera's call recordings, as MP3.
 *
 * Streamed through FMS rather than linked: Bolna's recording URL redirects to
 * a signed S3 link, which the site's CSP (media-src) does not allow, and going
 * through here keeps recordings behind the Meera access check. Only calls made
 * by Meera's own Bolna agent are served.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { recordingUrlFor } from '@/backend/lib/satej/clients/bolna';
import { satejConfig } from '@/backend/lib/satej/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const sp = request.nextUrl.searchParams;
    const caller = await requireSatejCaller(sp.get('organizationId'));
    if (caller instanceof NextResponse) return caller;
    const executionId = sp.get('executionId') ?? '';
    if (!/^[0-9a-f-]{16,64}$/i.test(executionId)) return NextResponse.json({ error: 'executionId is required' }, { status: 400 });
    try {
        const url = await recordingUrlFor(satejConfig.bolnaAgentIds, executionId);
        if (!url) return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });
        const upstream = await fetch(url, { headers: { Authorization: `Bearer ${satejConfig.bolnaApiKey}` }, redirect: 'follow' });
        if (!upstream.ok || !upstream.body) return NextResponse.json({ error: `Recording unavailable (${upstream.status})` }, { status: 502 });
        return new NextResponse(upstream.body, {
            headers: {
                'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
                'Content-Disposition': `inline; filename="meera-call-${executionId.slice(0, 8)}.mp3"`,
                'Cache-Control': 'private, max-age=3600',
                ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
            },
        });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not fetch the recording' }, { status: 502 });
    }
}
