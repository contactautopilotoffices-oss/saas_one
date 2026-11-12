import { NextRequest, NextResponse } from 'next/server';
import { verifyTtsAudio } from '@/backend/lib/voice/answerSignature';
import { synthesizeGoogleTts } from '@/backend/lib/voice/googleTts';

/**
 * GET /api/voice/tts-audio?lang=mr&t=<base64url text>&sig=...
 *
 * Plivo fetches this during a ticket call to play speech in a language its own voices cannot
 * speak (Marathi, Kannada), and the English ticket title inside those calls. Plivo has no login,
 * so only a link signed by /api/voice/plivo-answer is served (backend/lib/voice/answerSignature.ts).
 * That also stops the route being used as an open text-to-speech service.
 */
const GOOGLE_LANG: Record<string, string> = { en: 'en-IN', hi: 'hi', mr: 'mr', kn: 'kn' };

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const lang = searchParams.get('lang') ?? '';
    const encoded = searchParams.get('t') ?? '';
    const tl = GOOGLE_LANG[lang];
    if (!tl || !encoded) {
        return new NextResponse('Bad request', { status: 400 });
    }

    let text = '';
    try {
        text = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return new NextResponse('Bad request', { status: 400 });
    }
    if (!verifyTtsAudio(lang, text, searchParams.get('sig'))) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    try {
        const audio = await synthesizeGoogleTts(text, tl);
        if (!audio) {
            return new NextResponse('Speech unavailable', { status: 502 });
        }
        return new NextResponse(new Uint8Array(audio), {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(audio.length),
                // Same text always gives the same audio, and the link is signed.
                'Cache-Control': 'public, max-age=86400'
            }
        });
    } catch (err) {
        console.error('[TTS Audio] Synthesis error:', err instanceof Error ? err.message : err);
        return new NextResponse('Speech unavailable', { status: 502 });
    }
}
