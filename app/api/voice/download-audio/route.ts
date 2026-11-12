import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, isCallerError } from '@/backend/lib/auth/callerAccess';
import { splitTextIntoTTSChunks, synthesizeGoogleTts } from '@/backend/lib/voice/googleTts';

/**
 * GET /api/voice/download-audio?text=...&filename=...&recordingUrl=...
 * Generates and downloads crystal-clear MP3 speech audio or fetches remote recording.
 */
export async function GET(request: NextRequest) {
    try {
        // Signed-in users only: it calls outside services on the server's behalf.
        const caller = await resolveCaller(request);
        if (isCallerError(caller)) return caller;
        const { searchParams } = new URL(request.url);
        const text = searchParams.get('text');
        const recordingUrl = searchParams.get('recordingUrl');
        const customFilename = searchParams.get('filename') || 'telephony_voice_alert.mp3';
        const sanitizedFilename = customFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');

        // 1. Direct Recording URL Check
        // Only call recordings stored by Plivo, never any other address (the server must not fetch arbitrary URLs).
        if (recordingUrl && isPlivoRecording(recordingUrl)) {
            try {
                const audioRes = await fetch(recordingUrl);
                if (audioRes.ok) {
                    const audioBuffer = await audioRes.arrayBuffer();
                    return new NextResponse(audioBuffer, {
                        headers: {
                            'Content-Type': audioRes.headers.get('Content-Type') || 'audio/mpeg',
                            'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
                            'Cache-Control': 'public, max-age=86400'
                        }
                    });
                }
            } catch (fetchErr) {
                console.warn('Failed to fetch direct recordingUrl, falling back to TTS:', fetchErr);
            }
        }

        // 2. Validate Text Prompt
        if (!text || text.trim().length === 0) {
            return NextResponse.json({ error: 'Text content or recordingUrl is required' }, { status: 400 });
        }

        // 3. Chunk text to conform to Google TTS 150-char limit per request
        const chunks = splitTextIntoTTSChunks(text, 140);
        if (chunks.length === 0) {
            return NextResponse.json({ error: 'No valid text to synthesize' }, { status: 400 });
        }

        const combinedAudio = await synthesizeGoogleTts(text, 'en-IN');
        if (!combinedAudio) {
            return NextResponse.json({ error: 'Unable to synthesize speech audio from prompt' }, { status: 502 });
        }

        return new NextResponse(new Uint8Array(combinedAudio), {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
                'Content-Length': String(combinedAudio.length),
                'Cache-Control': 'public, max-age=86400'
            }
        });
    } catch (err: any) {
        console.error('Audio download error:', err);
        return NextResponse.json({ error: err.message || 'Internal error downloading audio' }, { status: 500 });
    }
}

function isPlivoRecording(raw: string): boolean {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && (u.hostname === 'plivo.com' || u.hostname.endsWith('.plivo.com'));
    } catch {
        return false;
    }
}
