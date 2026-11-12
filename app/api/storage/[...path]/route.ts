import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await context.params;
        if (!path || path.length < 2) {
            return new NextResponse('Invalid storage path', { status: 400 });
        }

        const bucket = path[0];
        const objectPath = path.slice(1).join('/');

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xvucakstcmtfoanmgcql.supabase.co';
        const targetUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;

        const upstreamRes = await fetch(targetUrl, {
            headers: {
                // Forward range headers if client is seeking in audio/video
                ...(request.headers.get('range') ? { range: request.headers.get('range')! } : {}),
            },
        });

        if (!upstreamRes.ok) {
            return new NextResponse('File not found or inaccessible', { status: upstreamRes.status });
        }

        const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
        const contentLength = upstreamRes.headers.get('content-length');

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }
        // Cache public storage assets for performance and instant loads
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('X-Content-Type-Options', 'nosniff');

        return new NextResponse(upstreamRes.body, {
            status: upstreamRes.status,
            headers,
        });
    } catch (err: any) {
        console.error('Storage proxy error:', err);
        return new NextResponse('Error fetching file', { status: 500 });
    }
}
