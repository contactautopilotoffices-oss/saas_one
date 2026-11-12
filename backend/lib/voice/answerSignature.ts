import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Signed answer links for outbound Plivo calls.
 *
 * Plivo fetches /api/voice/plivo-answer with no user session when the person picks up, so the
 * route cannot check a login. Instead VoiceCallingService signs the exact text, voice and speed it
 * puts in the link, and the route only speaks a link whose signature matches. Without this, anyone
 * could make that URL speak any text in the company's voice. Fails closed when no key is set.
 */
function key(): Buffer | null {
    const explicit = process.env.VOICE_ANSWER_SECRET;
    if (explicit && explicit.length >= 32) return Buffer.from(explicit, 'utf8');
    const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return base ? Buffer.from(hkdfSync('sha256', base, 'fms-voice', 'plivo-answer-v1', 32)) : null;
}

const payload = (text: string, voice: string, speed: string) => `${text}\u0000${voice}\u0000${speed}`;

/** The sig= value for an answer link, or null when the server has no key. */
export function signAnswer(text: string, voice: string, speed: string): string | null {
    const k = key();
    return k ? createHmac('sha256', k).update(payload(text, voice, speed)).digest('base64url') : null;
}

export function verifyAnswer(text: string, voice: string, speed: string, sig: string | null): boolean {
    const expected = signAnswer(text, voice, speed);
    if (!expected || !sig) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
}
