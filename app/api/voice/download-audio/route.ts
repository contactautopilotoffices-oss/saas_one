import { NextRequest, NextResponse } from 'next/server';

/**
 * Split text into chunks of <= 140 characters at punctuation or word boundaries
 */
function splitTextIntoTTSChunks(fullText: string, maxLen = 140): string[] {
    const cleanText = fullText.replace(/[*_~`#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanText) return [];
    if (cleanText.length <= maxLen) return [cleanText];

    const chunks: string[] = [];
    const sentences = cleanText.split(/(?<=[.?!,:;])\s+/);
    let current = '';

    for (const s of sentences) {
        if ((current ? current + ' ' + s : s).length <= maxLen) {
            current = current ? current + ' ' + s : s;
        } else {
            if (current) chunks.push(current);
            if (s.length <= maxLen) {
                current = s;
            } else {
                const words = s.split(/\s+/);
                current = '';
                for (const w of words) {
                    if ((current ? current + ' ' + w : w).length <= maxLen) {
                        current = current ? current + ' ' + w : w;
                    } else {
                        if (current) chunks.push(current);
                        current = w;
                    }
                }
            }
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/**
 * GET /api/voice/download-audio?text=...&filename=...&recordingUrl=...
 * Generates and downloads crystal-clear MP3 speech audio or fetches remote recording.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const text = searchParams.get('text');
        const recordingUrl = searchParams.get('recordingUrl');
        const customFilename = searchParams.get('filename') || 'telephony_voice_alert.mp3';
        const sanitizedFilename = customFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');

        // 1. Direct Recording URL Check
        if (recordingUrl && recordingUrl.startsWith('http')) {
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

        const audioBuffers: Buffer[] = [];

        for (const chunk of chunks) {
            const encodedChunk = encodeURIComponent(chunk);
            const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-IN&client=tw-ob&q=${encodedChunk}`;

            const ttsResponse = await fetch(googleTtsUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://translate.google.com/'
                }
            });

            if (ttsResponse.ok) {
                const arrayBuf = await ttsResponse.arrayBuffer();
                audioBuffers.push(Buffer.from(arrayBuf));
            } else {
                console.warn(`TTS chunk failed [status ${ttsResponse.status}] for chunk: "${chunk}"`);
            }
        }

        if (audioBuffers.length === 0) {
            return NextResponse.json({ error: 'Unable to synthesize speech audio from prompt' }, { status: 502 });
        }

        const combinedAudio = Buffer.concat(audioBuffers);

        return new NextResponse(combinedAudio, {
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
