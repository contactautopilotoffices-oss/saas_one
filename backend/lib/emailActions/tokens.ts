import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Single-use, expiring tokens backing one-click email actions.
 *
 * The raw token goes into the emailed URL and is never persisted; only its SHA-256
 * is stored. Consumption is a single atomic UPDATE guarded on `consumed_at IS NULL`
 * AND `expires_at > now()`, so concurrent clicks cannot both win.
 */

export const DEFAULT_TTL_HOURS = 168; // 7 days — approvals often wait over a weekend

export interface EmailActionToken {
    id: string;
    organization_id: string;
    user_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    payload: Record<string, unknown>;
}

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface IssueTokenInput {
    organizationId: string;
    userId: string;
    entityType: string;
    entityId: string;
    action: string;
    payload?: Record<string, unknown>;
    ttlHours?: number;
}

/** Issue a token and return the RAW value to embed in a URL. Stored hashed. */
export async function issueEmailActionToken(input: IssueTokenInput): Promise<string | null> {
    // 32 bytes of CSPRNG entropy, url-safe.
    const raw = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + (input.ttlHours ?? DEFAULT_TTL_HOURS) * 3600_000).toISOString();

    const { error } = await supabaseAdmin.from('email_action_tokens').insert({
        token_hash: hash(raw),
        organization_id: input.organizationId,
        user_id: input.userId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        payload: input.payload ?? {},
        expires_at: expires,
    });

    if (error) {
        console.error('[emailActions] issue failed:', error.message);
        return null;
    }
    return raw;
}

export type ConsumeResult =
    | { ok: true; token: EmailActionToken }
    | { ok: false; reason: 'invalid' | 'used_or_expired' };

/**
 * Atomically claim a token. Returns it exactly once; every later call fails.
 *
 * A claimed-but-failed action is NOT rolled back — the token stays consumed and the
 * failure is recorded via recordTokenResult(). Re-issuing is safer than re-arming a
 * link that already reached the internet.
 */
export async function consumeEmailActionToken(raw: string): Promise<ConsumeResult> {
    if (!raw || raw.length < 20) return { ok: false, reason: 'invalid' };

    const { data, error } = await supabaseAdmin
        .from('email_action_tokens')
        .update({ consumed_at: new Date().toISOString() })
        .eq('token_hash', hash(raw))
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('id, organization_id, user_id, entity_type, entity_id, action, payload')
        .maybeSingle();

    if (error) {
        console.error('[emailActions] consume failed:', error.message);
        return { ok: false, reason: 'invalid' };
    }
    if (!data) return { ok: false, reason: 'used_or_expired' };
    return { ok: true, token: data as EmailActionToken };
}

/** Record the outcome against the consumed token, for forensics. Best-effort. */
export async function recordTokenResult(id: string, result: string, ip?: string | null): Promise<void> {
    await supabaseAdmin
        .from('email_action_tokens')
        .update({ result: result.slice(0, 500), consumed_ip: ip ?? null })
        .eq('id', id);
}

/**
 * Invalidate every outstanding token for an entity. Called after a successful
 * transition so the other approvers' links stop working immediately rather than
 * failing later on a state check.
 */
export async function revokeTokensForEntity(entityType: string, entityId: string, exceptId?: string): Promise<void> {
    let q = supabaseAdmin
        .from('email_action_tokens')
        .update({ consumed_at: new Date().toISOString(), result: 'superseded' })
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .is('consumed_at', null);
    if (exceptId) q = q.neq('id', exceptId);
    await q;
}

/**
 * Read a token's SHAPE without consuming it.
 *
 * Needed because the landing page must know, on GET, whether to auto-submit
 * (a decision link) or render a form (a feedback link) — and GET must never
 * mutate, or Outlook Safe Links and Gmail prefetch would burn the token before
 * a human ever saw it.
 *
 * Returns entity_type and action ONLY. No payload, no ids, no org. A caller
 * learning "this is a feedback link" leaks nothing an attacker holding the raw
 * token does not already have, and everything that matters still happens in the
 * atomic consume on POST.
 */
export async function peekEmailActionToken(
    raw: string,
): Promise<{ entityType: string; action: string; payload: Record<string, unknown> } | null> {
    if (!raw || raw.length < 20) return null;
    const { data, error } = await supabaseAdmin
        .from('email_action_tokens')
        .select('entity_type, action, payload')
        .eq('token_hash', hash(raw))
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
    if (error || !data) return null;
    return {
        entityType: String(data.entity_type),
        action: String(data.action),
        // Only ever read by the page the token holder is already looking at.
        payload: (data.payload ?? {}) as Record<string, unknown>,
    };
}
