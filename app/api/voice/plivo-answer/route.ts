import { NextRequest, NextResponse } from 'next/server';

/**
 * GET/POST /api/voice/plivo-answer
 * Plivo calls this webhook endpoint when the recipient answers the phone call.
 * Returns custom Neural voice with dynamic speed (rate) and human-like prosody.
 */
export async function GET(request: NextRequest) {
    return handlePlivoXML(request);
}

export async function POST(request: NextRequest) {
    return handlePlivoXML(request);
}

function handlePlivoXML(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const text = searchParams.get('text') || 'Hi, this is Pratiksha from the Operations team. Have a great day.';
    const rawVoice = searchParams.get('voice') || 'Polly.Aditi';
    const rawSpeed = searchParams.get('speed') || '1.0';

    // Normalize Polly voice name for Plivo (Plivo XML specifically supports Polly.Aditi, Polly.Raveena, Polly.Joanna, Polly.Matthew)
    let cleanVoiceName = rawVoice.replace(/-Neural/gi, '');
    if (cleanVoiceName.toLowerCase().includes('kajal')) {
        cleanVoiceName = 'Polly.Aditi';
    }
    const voice = cleanVoiceName.startsWith('Polly.') ? cleanVoiceName : `Polly.${cleanVoiceName}`;

    // Parse speed into valid SSML prosody rate percentage (e.g. "1.1" -> "110%", "0.9" -> "90%")
    let ratePercent = '100%';
    const parsedSpeed = parseFloat(rawSpeed);
    if (!isNaN(parsedSpeed) && parsedSpeed > 0) {
        if (parsedSpeed > 5) {
            // Already in percentage like "110"
            ratePercent = `${Math.min(Math.max(parsedSpeed, 70), 150)}%`;
        } else {
            // Decimal format like "1.15" -> "115%"
            ratePercent = `${Math.round(parsedSpeed * 100)}%`;
        }
    }

    // Determine appropriate language tag based on voice
    const language = (voice.includes('Matthew') || voice.includes('Joanna') || voice.includes('Salli') || voice.includes('Kimberly'))
        ? 'en-US'
        : 'en-IN';

    const naturalText = escapeXml(text);

    // Plivo XML response with dynamic Neural voice and speed control
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="${voice}" language="${language}">
        <prosody rate="${ratePercent}">
            ${naturalText}
        </prosody>
    </Speak>
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
