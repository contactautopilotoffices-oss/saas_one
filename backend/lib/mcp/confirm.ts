import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * One-time confirmation codes for MCP write actions.
 *
 * A write tool never acts on its first call. It returns a plain-language preview and a code. The
 * action happens only when confirm_action is called with that code. The code is signed by the
 * server (so it cannot be made up or edited), names the exact action and its arguments (so what
 * runs is exactly what was previewed), belongs to one user and one assistant connection, expires
 * after CONFIRM_TTL_SECONDS, and can be used once (its nonce is recorded in
 * mcp_action_confirmations; a second use is refused).
 */

export const CONFIRM_TTL_SECONDS = 10 * 60;

export type ActionName = 'create_ticket' | 'book_meeting_room' | 'cancel_booking';

export type ConfirmPayload = {
    v: 1;
    u: string;        // user id
    c: string;        // OAuth client id (the assistant connection)
    a: ActionName;
    p: Record<string, unknown>; // the exact arguments that will be sent
    exp: number;      // seconds since epoch
    n: string;        // nonce, one use only
};

/** Signing key: MCP_CONFIRM_SECRET when set, otherwise derived from the service role key. */
let warnedShortSecret = false;

export function confirmKey(): Buffer | null {
    const explicit = process.env.MCP_CONFIRM_SECRET;
    if (explicit && explicit.length >= 32) return Buffer.from(explicit, 'utf8');
    if (explicit && !warnedShortSecret) {
        warnedShortSecret = true;
        console.warn('[mcp] MCP_CONFIRM_SECRET is shorter than 32 characters and is ignored; using a key derived from the service role key');
    }
    const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base) return null;
    return Buffer.from(hkdfSync('sha256', base, 'fms-mcp', 'confirm-code-v1', 32));
}

function sign(key: Buffer, data: string): string {
    return createHmac('sha256', key).update(data).digest('base64url');
}

export function createCode(
    key: Buffer,
    fields: { userId: string; clientId: string; action: ActionName; params: Record<string, unknown> },
    nowSeconds = Math.floor(Date.now() / 1000),
): { code: string; expiresAt: number } {
    const payload: ConfirmPayload = {
        v: 1,
        u: fields.userId,
        c: fields.clientId,
        a: fields.action,
        p: fields.params,
        exp: nowSeconds + CONFIRM_TTL_SECONDS,
        n: randomBytes(16).toString('base64url'),
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return { code: `${body}.${sign(key, body)}`, expiresAt: payload.exp };
}

export function verifyCode(
    key: Buffer,
    code: string,
    caller: { userId: string; clientId: string },
    nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; payload: ConfirmPayload } | { ok: false; reason: string } {
    if (typeof code !== 'string' || code.length > 8000) return { ok: false, reason: 'this is not a confirmation code' };
    const parts = code.trim().split('.');
    if (parts.length !== 2) return { ok: false, reason: 'this is not a confirmation code' };
    const [body, sig] = parts;
    const expected = Buffer.from(sign(key, body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        return { ok: false, reason: 'the confirmation code is not valid (it may have been changed)' };
    }
    let payload: ConfirmPayload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return { ok: false, reason: 'the confirmation code is not valid' };
    }
    if (payload.v !== 1) return { ok: false, reason: 'the confirmation code is not valid' };
    if (payload.u !== caller.userId || payload.c !== caller.clientId) {
        return { ok: false, reason: 'this confirmation code belongs to someone else' };
    }
    if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
        return { ok: false, reason: 'the confirmation code has expired; ask for a new preview' };
    }
    if (!['create_ticket', 'book_meeting_room', 'cancel_booking'].includes(payload.a)) {
        return { ok: false, reason: 'unknown action' };
    }
    return { ok: true, payload };
}

export type NonceStore = (nonce: string, userId: string, action: ActionName) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** Record that a code has been used. A second use, or a missing table, refuses the action. */
export const consumeNonce: NonceStore = async (nonce, userId, action) => {
    const { error } = await supabaseAdmin.from('mcp_action_confirmations').insert({ nonce, user_id: userId, action });
    if (!error) return { ok: true };
    if (error.code === '23505') return { ok: false, reason: 'this confirmation code was already used' };
    if (error.code === '42P01' || error.code === 'PGRST205') {
        return { ok: false, reason: 'actions are not switched on yet: an FMS admin must apply the MCP migration' };
    }
    console.error('[mcp] confirmation record failed:', error.message);
    return { ok: false, reason: 'the FMS could not record the confirmation; nothing was done' };
};
