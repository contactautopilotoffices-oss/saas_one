import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
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

/** Every action the MCP can carry out. Creates only, plus cancelling one's own booking; no deletes. */
export const ACTION_NAMES = [
    'create_ticket', 'book_meeting_room', 'cancel_booking',
    'raise_hr_ticket', 'add_ticket_comment',
    'create_crm_lead', 'add_crm_note', 'log_crm_activity',
    'assign_task',
    'record_diesel_reading', 'record_electricity_reading', 'record_water_reading',
    'record_stock_movement', 'draft_petty_cash_request',
] as const;
export type ActionName = typeof ACTION_NAMES[number];

/** Per-user limits on confirmed actions, all kinds together (MCP_WRITE_LIMIT_PER_HOUR / _PER_DAY). */
export function actionLimits(): { perHour: number; perDay: number; duplicateMinutes: number } {
    const num = (v: string | undefined, d: number) => {
        const n = parseInt(v || '', 10);
        return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
        perHour: num(process.env.MCP_WRITE_LIMIT_PER_HOUR, 10),
        perDay: num(process.env.MCP_WRITE_LIMIT_PER_DAY, 30),
        duplicateMinutes: num(process.env.MCP_DUPLICATE_WINDOW_MINUTES, 15),
    };
}

/** Same action with the same details gives the same hash, so a repeat can be refused. */
export function paramsHash(action: string, params: Record<string, unknown>): string {
    const stable = (v: unknown): unknown =>
        Array.isArray(v) ? v.map(stable)
            : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, stable((v as Record<string, unknown>)[k])]))
                : typeof v === 'string' ? v.trim().toLowerCase() : v;
    return createHash('sha256').update(action + '|' + JSON.stringify(stable(params))).digest('hex');
}

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
    if (!(ACTION_NAMES as readonly string[]).includes(payload.a)) {
        return { ok: false, reason: 'unknown action' };
    }
    return { ok: true, payload };
}

export type NonceStore = (
    nonce: string, userId: string, action: ActionName, hash: string,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

const REFUSALS: Record<string, string> = {
    used: 'this confirmation code was already used',
    duplicate: 'the same request was already carried out a few minutes ago, so it was not repeated',
    hour_limit: 'the limit of actions per hour through the assistant has been reached; try again later or use the FMS app',
    day_limit: 'the limit of actions per day through the assistant has been reached; try again tomorrow or use the FMS app',
};

/**
 * In one locked database step (mcp_consume_action): the code is unused, the same action was not
 * just done, and the user is under their hourly and daily limits; then the code is recorded.
 * Anything else, including the migration not being applied, refuses the action.
 */
export const consumeNonce: NonceStore = async (nonce, userId, action, hash) => {
    const l = actionLimits();
    const { data, error } = await supabaseAdmin.rpc('mcp_consume_action', {
        p_nonce: nonce, p_user: userId, p_action: action, p_hash: hash,
        p_hour_limit: l.perHour, p_day_limit: l.perDay, p_dup_minutes: l.duplicateMinutes,
    });
    if (error) {
        if (['42883', 'PGRST202', '42P01', 'PGRST205'].includes(String(error.code))) {
            return { ok: false, reason: 'actions are not switched on yet: an FMS admin must apply the MCP migrations' };
        }
        console.error('[mcp] action check failed:', error.message);
        return { ok: false, reason: 'the FMS could not check the action limits; nothing was done' };
    }
    if (data === 'ok') return { ok: true };
    return { ok: false, reason: REFUSALS[String(data)] || 'the action was refused' };
};

/** How many actions this user has left right now (read-only; the real check is consumeNonce). */
export async function remainingActions(userId: string): Promise<{ hour: number; day: number } | null> {
    const l = actionLimits();
    const since = (ms: number) => new Date(Date.now() - ms).toISOString();
    const [h, d] = await Promise.all([
        supabaseAdmin.from('mcp_action_confirmations').select('nonce', { count: 'exact', head: true }).eq('user_id', userId).gte('used_at', since(3600_000)),
        supabaseAdmin.from('mcp_action_confirmations').select('nonce', { count: 'exact', head: true }).eq('user_id', userId).gte('used_at', since(86400_000)),
    ]);
    if (h.error || d.error) return null;
    return { hour: Math.max(0, l.perHour - (h.count || 0)), day: Math.max(0, l.perDay - (d.count || 0)) };
}
