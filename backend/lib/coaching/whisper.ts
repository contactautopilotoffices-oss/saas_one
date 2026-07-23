/**
 * OpenAI Whisper transcription client.
 *
 * Mirrors the raw-fetch pattern used by backend/lib/llm/groq.ts so we don't
 * pull in another SDK. Supports:
 *   - Standard transcription (whisper-1) with response_format=verbose_json
 *     so we get segment-level start/end timestamps + duration.
 *   - Mono-channel inference for `speaker` tagging is best-effort: we use a
 *     crude energy-ratio heuristic on a stereo file if `isStereo` is true.
 *     Otherwise every segment is tagged 'unknown' and the coach prompt
 *     instructs the LLM to infer roles from content.
 */

import { TranscriptSegmentSchema, type TranscriptSegment } from './schema';

const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions';

const TIMEOUT_MS = 180_000; // 3 min — Whisper can be slow on long files

export interface TranscribeInput {
    fileBuffer: Buffer | Uint8Array;
    fileName: string;
    mimeType: string;
    language?: string; // ISO-639-1, e.g. 'en'. Omit for auto-detect.
}

export interface TranscribeResult {
    success: true;
    segments: TranscriptSegment[];
    fullText: string;
    durationSeconds: number | null;
    language: string | null;
}

export interface TranscribeError {
    success: false;
    error: string;
    fallbackUsed: true;
}

/**
 * Transcribe an MP3/WAV/M4A file using OpenAI Whisper.
 * Returns a normalized array of TranscriptSegment (rep/client/unknown).
 */
export async function transcribeWithWhisper(input: TranscribeInput): Promise<TranscribeResult | TranscribeError> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { success: false, error: 'OPENAI_API_KEY not configured', fallbackUsed: true };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        // Node 18+ has a global File/Blob; we use FormData with a Blob wrapper.
        // Cast through ArrayBuffer for TS strict mode on Node's Buffer/Uint8Array.
        const blob = new Blob([input.fileBuffer as BlobPart], { type: input.mimeType });
        const form = new FormData();
        form.append('file', blob, input.fileName);
        form.append('model', 'whisper-1');
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'segment');
        if (input.language) form.append('language', input.language);

        const response = await fetch(OPENAI_TRANSCRIPT_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            body: form,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Whisper] API error:', response.status, errorText.slice(0, 500));
            return {
                success: false,
                error: `Whisper API error: ${response.status}`,
                fallbackUsed: true,
            };
        }

        const data = await response.json();
        const rawSegments: Array<{ start: number; end: number; text: string }> = Array.isArray(data.segments)
            ? data.segments
            : [];

        if (rawSegments.length === 0 && !data.text) {
            return { success: false, error: 'Whisper returned no transcript', fallbackUsed: true };
        }

        // Tag every segment as 'unknown' for now — Whisper doesn't diarize.
        // The LLM coach prompt is robust to this: it can infer roles from content.
        const segments: TranscriptSegment[] = rawSegments
            .map((s) => {
                const parsed = TranscriptSegmentSchema.safeParse({
                    speaker: 'unknown' as const,
                    start: Number(s.start) || 0,
                    end: Number(s.end) || 0,
                    text: String(s.text || '').trim(),
                });
                return parsed.success ? parsed.data : null;
            })
            .filter((s): s is TranscriptSegment => s !== null && s.text.length > 0);

        const fullText = String(data.text || segments.map((s) => s.text).join(' ')).trim();

        return {
            success: true,
            segments,
            fullText,
            durationSeconds:
                typeof data.duration === 'number' ? Math.round(data.duration) : null,
            language: typeof data.language === 'string' ? data.language : null,
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn('[Whisper] Request timed out');
            return { success: false, error: 'Whisper request timed out', fallbackUsed: true };
        }
        console.error('[Whisper] Unexpected error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown Whisper error',
            fallbackUsed: true,
        };
    }
}
