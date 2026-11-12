import { NextRequest, NextResponse } from 'next/server';
import { verifyAnswer, verifySegments, signTtsAudio } from '@/backend/lib/voice/answerSignature';

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
    // Multi-language ticket calls carry segs= instead of text=.
    if (searchParams.has('segs')) return handleSegmentsXML(request, searchParams);
    // Plivo has no login: only a link signed by VoiceCallingService is spoken (backend/lib/voice/answerSignature.ts).
    if (!verifyAnswer(searchParams.get('text') ?? '', searchParams.get('voice') ?? '', searchParams.get('speed') ?? '', searchParams.get('sig'))) {
        return new NextResponse('Forbidden', { status: 403 });
    }
    const text = searchParams.get('text') || 'Hi, this is Pratiksha from the Operations team. Have a great day.';
    const rawVoice = searchParams.get('voice') || 'Polly.Aditi';
    const rawSpeed = searchParams.get('speed') || '1.0';

    const voice = normalizeVoice(rawVoice);
    const ratePercent = toRatePercent(rawSpeed);

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

/** Normalize Polly voice name for Plivo (Plivo XML specifically supports Polly.Aditi, Polly.Raveena, Polly.Joanna, Polly.Matthew) */
function normalizeVoice(rawVoice: string): string {
    let cleanVoiceName = rawVoice.replace(/-Neural/gi, '');
    if (cleanVoiceName.toLowerCase().includes('kajal')) {
        cleanVoiceName = 'Polly.Aditi';
    }
    const named = cleanVoiceName.startsWith('Polly.') ? cleanVoiceName : `Polly.${cleanVoiceName}`;
    // The voice goes into an XML attribute: only a plain name such as Polly.Aditi is accepted.
    return /^Polly\.[A-Za-z]{2,30}$/.test(named) ? named : 'Polly.Aditi';
}

/** Parse speed into valid SSML prosody rate percentage (e.g. "1.1" -> "110%", "0.9" -> "90%") */
function toRatePercent(rawSpeed: string): string {
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
    return ratePercent;
}

const SEGMENT_LANGS = new Set(['en', 'hi', 'mr', 'kn']);
const US_VOICES = ['Matthew', 'Joanna', 'Salli', 'Kimberly'];

/**
 * A ticket call in the property's language (backend/lib/voice/ticketCallScript.ts).
 * English and Hindi are spoken by Plivo's Polly voice (Aditi speaks both). Plivo has no Marathi or
 * Kannada voice, so a call with either is played as audio from /api/voice/tts-audio, every segment
 * of it, so the whole call keeps one voice.
 */
function handleSegmentsXML(request: NextRequest, searchParams: URLSearchParams) {
    const segs = searchParams.get('segs') ?? '';
    const rawVoice = searchParams.get('voice') ?? '';
    const rawSpeed = searchParams.get('speed') ?? '';
    if (!verifySegments(segs, rawVoice, rawSpeed, searchParams.get('sig'))) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    let segments: { lang: string; text: string }[] = [];
    try {
        const parsed = JSON.parse(Buffer.from(segs, 'base64url').toString('utf8'));
        if (Array.isArray(parsed)) {
            segments = parsed.filter((x: { lang?: unknown; text?: unknown } | null): x is { lang: string; text: string } =>
                !!x && typeof x.lang === 'string' && SEGMENT_LANGS.has(x.lang) && typeof x.text === 'string' && x.text.trim() !== '');
        }
    } catch {
        segments = [];
    }
    if (segments.length === 0) {
        return new NextResponse('Bad request', { status: 400 });
    }

    const voice = normalizeVoice(rawVoice || 'Polly.Aditi');
    const ratePercent = toRatePercent(rawSpeed || '1.0');
    const usesAudio = segments.some(seg => seg.lang === 'mr' || seg.lang === 'kn');
    const hasHindi = segments.some(seg => seg.lang === 'hi');
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');

    const parts = segments.map(seg => {
        if (usesAudio) {
            const t = Buffer.from(seg.text, 'utf8').toString('base64url');
            const sig = signTtsAudio(seg.lang, seg.text) || '';
            const url = `${baseUrl}/api/voice/tts-audio?lang=${seg.lang}&t=${t}&sig=${encodeURIComponent(sig)}`;
            return `    <Play>${escapeXml(url)}</Play>`;
        }
        // Only Aditi speaks Hindi, so a Hindi call uses Aditi throughout (one voice per call).
        // An English-only call keeps the voice the organisation chose.
        const isHindi = seg.lang === 'hi';
        const segVoice = hasHindi ? 'Polly.Aditi' : voice;
        const language = isHindi ? 'hi-IN' : (US_VOICES.some(v => segVoice.includes(v)) ? 'en-US' : 'en-IN');
        return `    <Speak voice="${segVoice}" language="${language}">
        <prosody rate="${ratePercent}">${escapeXml(seg.text)}</prosody>
    </Speak>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${parts.join('\n')}
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
