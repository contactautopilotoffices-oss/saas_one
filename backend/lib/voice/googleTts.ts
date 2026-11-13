/**
 * Text to MP3 speech through Google Translate's speech endpoint.
 *
 * Used by /api/voice/download-audio (English previews) and /api/voice/tts-audio (ticket calls in
 * Marathi and Kannada, which Plivo's own voices cannot speak). The endpoint takes at most about
 * 150 characters per request, so text is split at punctuation or word boundaries first.
 *
 * Note: this is Google's public Translate endpoint, not the paid Cloud Text-to-Speech API. It has
 * no key and no service promise, so it can slow down or stop working without notice.
 */

/** Split text into chunks of <= maxLen characters at punctuation or word boundaries. */
export function splitTextIntoTTSChunks(fullText: string, maxLen = 140): string[] {
    const cleanText = fullText.replace(/[*_~`#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanText) return [];
    if (cleanText.length <= maxLen) return [cleanText];

    const chunks: string[] = [];
    // Also split after the Devanagari full stop (danda), used in Hindi and Marathi text.
    const sentences = cleanText.split(/(?<=[.?!,:;।])\s+/);
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
 * Speaks `text` in language `tl` (e.g. 'en-IN', 'mr', 'kn') and returns the joined MP3 bytes,
 * or null when no chunk could be synthesised.
 */
export async function synthesizeGoogleTts(text: string, tl: string): Promise<Buffer | null> {
    const chunks = splitTextIntoTTSChunks(text, 140);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
        const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(tl)}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
        const ttsResponse = await fetch(googleTtsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://translate.google.com/'
            }
        });

        if (ttsResponse.ok) {
            audioBuffers.push(Buffer.from(await ttsResponse.arrayBuffer()));
        } else {
            console.warn(`TTS chunk failed [status ${ttsResponse.status}] for chunk: "${chunk}"`);
        }
    }

    return audioBuffers.length > 0 ? Buffer.concat(audioBuffers) : null;
}
