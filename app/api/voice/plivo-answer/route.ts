import { NextRequest, NextResponse } from 'next/server';

/**
 * GET/POST /api/voice/plivo-answer
 * Plivo calls this webhook endpoint when the recipient answers the phone call.
 * Returns standard Plivo XML <Speak> with Indian English voice.
 */
export async function GET(request: NextRequest) {
    return handlePlivoXML(request);
}

export async function POST(request: NextRequest) {
    return handlePlivoXML(request);
}

function handlePlivoXML(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const text = searchParams.get('text') || 'Hello, this is a notification from AutoPilot Operations.';
    const voice = searchParams.get('voice') || 'WOMAN'; // Standard universal voice compatible across all Plivo accounts

    // Plivo XML response
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="${voice}" language="en-IN">${escapeXml(text)}</Speak>
</Response>`;

    return new NextResponse(xml, {
        status: 200,
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
    });
}

function escapeXml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
