/**
 * BioFRQ face API — server-only wrapper for the VMS Face (testing) module.
 * Docs: https://biofrq.com/docs/api-reference/envelope/ · plan: docs/VMS_BIOFRQ_PLAN.md
 *
 * Rules the plan fixes:
 * - One gallery per API key, so every face is tagged with the org group and every identify is
 *   filtered by it. Never identify without the org group.
 * - externalId is our own random UUID — no name or phone is ever sent as an ID.
 * - Retry only RATE_LIMITED (429) and SERVICE_UNAVAILABLE (503). Branch on code, never message.
 * - Never throws: every call returns a result object, so check-in can always fall back to manual.
 */

const ENDPOINT = 'https://api.biofrq.com/v1/face/execute';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export type BioFrqErrorCode =
    | 'NOT_CONFIGURED' | 'NETWORK' | 'TIMEOUT'
    | 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'PAYMENT_REQUIRED' | 'PAYLOAD_TOO_LARGE'
    | 'RATE_LIMITED' | 'NO_FACE_DETECTED' | 'MULTIPLE_FACES_DETECTED' | 'SUBJECT_NOT_FOUND'
    | 'CONFLICT' | 'INTERNAL' | 'SERVICE_UNAVAILABLE' | 'UNKNOWN';

export type BioFrqResult<T> =
    | { ok: true; value: T; requestId?: string }
    | { ok: false; code: BioFrqErrorCode; message: string; requestId?: string };

export interface BioFrqCandidate { subjectId: string; externalId: string; groups: string[]; score: number }

const HTTP_CODES: Record<number, BioFrqErrorCode> = {
    400: 'INVALID_REQUEST', 401: 'UNAUTHORIZED', 402: 'PAYMENT_REQUIRED', 403: 'FORBIDDEN',
    413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL', 503: 'SERVICE_UNAVAILABLE',
};
const RETRYABLE: BioFrqErrorCode[] = ['RATE_LIMITED', 'SERVICE_UNAVAILABLE'];

export const orgGroup = (organizationId: string) => `org:${organizationId}`;

export const isBioFrqConfigured = () => !!process.env.BIOFRQ_API_KEY;

/** Strip a data-URL prefix and check the image is JPEG/PNG (BioFRQ rejects WebP). */
export function toImageItem(imageBase64: string) {
    const match = /^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/.exec(imageBase64);
    const contentType = match ? match[1] : 'image/jpeg';
    const bytes = match ? match[2] : imageBase64;
    return { kind: 'image' as const, bytes, contentType };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function execute<T>(action: string, params: Record<string, unknown>): Promise<BioFrqResult<T>> {
    const apiKey = process.env.BIOFRQ_API_KEY;
    if (!apiKey) return { ok: false, code: 'NOT_CONFIGURED', message: 'BIOFRQ_API_KEY is not set' };

    // Same requestId on every retry: BioFRQ replays the original response instead of billing twice.
    const requestId = crypto.randomUUID();
    let last: BioFrqResult<T> = { ok: false, code: 'UNKNOWN', message: 'No attempt made' };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, requestId, params }),
                signal: controller.signal,
            });
            const body = await res.json().catch(() => null);

            if (res.status !== 200) {
                last = { ok: false, code: HTTP_CODES[res.status] || 'UNKNOWN', message: body?.detail || `HTTP ${res.status}`, requestId };
            } else if (!body?.ok) {
                const err = body?.errors?.[0];
                last = { ok: false, code: (err?.code as BioFrqErrorCode) || 'UNKNOWN', message: err?.message || 'BioFRQ error', requestId };
            } else {
                const result = body.data?.results?.[0];
                if (result && result.ok === false) {
                    const err = result.error || result.errors?.[0];
                    return { ok: false, code: (err?.code as BioFrqErrorCode) || 'UNKNOWN', message: err?.message || 'BioFRQ item error', requestId };
                }
                return { ok: true, value: result?.value as T, requestId };
            }
        } catch (e) {
            const aborted = e instanceof Error && e.name === 'AbortError';
            last = { ok: false, code: aborted ? 'TIMEOUT' : 'NETWORK', message: e instanceof Error ? e.message : String(e), requestId };
        } finally {
            clearTimeout(timer);
        }

        if (!RETRYABLE.includes(last.ok ? 'UNKNOWN' : last.code) || attempt === MAX_ATTEMPTS) break;
        await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
    return last;
}

/**
 * Best match for a face within one organisation's gallery, or null when nobody scores above the threshold.
 * Pass subjectIds to compare against those faces only (1:1 check of a known, consenting visitor).
 */
export async function identify(organizationId: string, imageBase64: string, threshold?: number, subjectIds?: string[]): Promise<BioFrqResult<BioFrqCandidate | null>> {
    const res = await execute<{ candidates?: BioFrqCandidate[] }>('biofrq.identify', {
        images: [toImageItem(imageBase64)],
        predicate: { groupNames: [orgGroup(organizationId)], ...(subjectIds?.length ? { subjectIds } : {}) },
        topK: 1,
        ...(threshold !== undefined ? { threshold } : {}),
    });
    if (!res.ok) return res;
    return { ok: true, value: res.value?.candidates?.[0] || null, requestId: res.requestId };
}

/**
 * Enroll a consenting visitor's face. CONFLICT means the face is already in the gallery (dedup gate).
 * forceEnroll bypasses that gate — used only when the existing face belongs to another organisation.
 */
export async function enroll(organizationId: string, externalId: string, imageBase64: string, forceEnroll = false) {
    return execute<{ subject: { subjectId: string; externalId: string; groups: string[] }; reference?: { qualityScore?: number } }>(
        'biofrq.enroll',
        {
            images: [toImageItem(imageBase64)],
            externalId,
            groupNames: [orgGroup(organizationId)],
            mode: 'create',
            ...(forceEnroll ? { forceEnroll: true } : {}),
        },
    );
}

/** Permanently delete a face. BioFRQ resolves by subjectId only. */
export async function deleteSubject(subjectId: string) {
    return execute<{ deletionId: string; subjectId: string; deletedAtUtc: string }>('biofrq.deleteSubject', { subjectId });
}

/** Spoof check (photo of a photo / screen). */
export async function liveness(imageBase64: string, livenessThreshold?: number) {
    return execute<{ verdict: 'live' | 'spoof'; score: number; reasons: string[] }>('biofrq.liveness', {
        images: [toImageItem(imageBase64)],
        ...(livenessThreshold !== undefined ? { livenessThreshold } : {}),
    });
}
