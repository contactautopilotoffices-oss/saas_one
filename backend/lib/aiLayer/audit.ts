/**
 * ai_action_log: one row per turn. Answers "who asked or did what, through the AI, and what happened".
 *
 * HR anonymity (plan gap S22). The log must never reveal who raised an anonymous or confidential HR item, not even to an
 * org super admin. For entries marked sensitive:
 *   - actor_user_id is NOT stored. A keyed hash (HMAC-SHA256 with AI_AUDIT_SALT) is stored instead, so HR can still see
 *     "the same person sent 40 messages" for abuse control, but nobody can turn the hash back into a person without the
 *     server secret, and you can't confirm a guess without it either.
 *   - fields and result_ref are not stored (a ticket number would lead straight back to the raiser).
 *   - visibility = 'hr': the activity view and the RLS policy show these rows only to HR roles.
 * Unanswered questions are stored as a short topic, never as the person's text.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Channel, Lang } from './types';

/** Entries whose audit rows must not identify the person. HR entries join this list when they are added. */
export const SENSITIVE_ENTRIES = new Set<string>(['hr.ticket.create', 'hr.ticket.list']);

/** accepted = the person said Yes and the write started (written BEFORE the write); acted = it finished, with result_ref. */
export type Decision = 'answered' | 'asked' | 'confirm_shown' | 'accepted' | 'acted' | 'shadow' | 'cancelled' | 'refused' | 'handed_off' | 'error';

export interface AuditInput {
    orgId: string;
    userId: string;
    channel: Channel;
    lang: Lang;
    entryId: string | null;
    decision: Decision;
    refusalReason?: string | null;
    fields?: Record<string, unknown> | null;
    resultRef?: string | null;
    topic?: string | null;
    model?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    opId?: string;
}

export interface AuditRow {
    op_id: string;
    organization_id: string;
    actor_user_id: string | null;
    actor_hash: string | null;
    visibility: 'org_admin' | 'hr';
    channel: Channel;
    language: Lang;
    entry_id: string | null;
    decision: Decision;
    refusal_reason: string | null;
    fields: Record<string, unknown> | null;
    result_ref: string | null;
    topic: string | null;
    model: string | null;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
}

export function actorHash(salt: string | undefined, orgId: string, userId: string): string | null {
    if (!salt) return null;
    return createHmac('sha256', salt).update(`${orgId}:${userId}`).digest('hex').slice(0, 32);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only short, non-personal values survive: enums, booleans, ids of properties. Free text is dropped. */
export function redactFields(fields: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!fields) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (k === 'description' || k === 'location' || k === 'title') { out[`has_${k}`] = typeof v === 'string' && v.trim().length > 0; continue; }
        if (typeof v === 'boolean' || typeof v === 'number') out[k] = v;
        else if (typeof v === 'string' && (UUID.test(v) || (v.length <= 64 && !/\d{6,}/.test(v)))) out[k] = v; // no phone numbers
    }
    return out;
}

export function buildAuditRow(input: AuditInput, salt: string | undefined = process.env.AI_AUDIT_SALT): AuditRow {
    const sensitive = !!input.entryId && SENSITIVE_ENTRIES.has(input.entryId);
    return {
        op_id: input.opId ?? randomUUID(),
        organization_id: input.orgId,
        actor_user_id: sensitive ? null : input.userId,
        actor_hash: sensitive ? actorHash(salt, input.orgId, input.userId) : null,
        visibility: sensitive ? 'hr' : 'org_admin',
        channel: input.channel,
        language: input.lang,
        entry_id: input.entryId,
        decision: input.decision,
        refusal_reason: input.refusalReason ?? null,
        fields: sensitive ? null : redactFields(input.fields),
        result_ref: sensitive ? null : (input.resultRef ?? null),
        topic: input.topic ?? null,
        model: input.model ?? null,
        tokens_in: input.tokensIn ?? 0,
        tokens_out: input.tokensOut ?? 0,
        latency_ms: input.latencyMs ?? 0,
    };
}

export interface AuditStore {
    write(row: AuditRow): Promise<void>;
    /** Actions (accepted + shadow rows) by this person since an instant, for the daily cap. */
    countActionsSince(orgId: string, userId: string, sinceIso: string): Promise<number>;
    /** Turns (all rows) by this person since an instant: the per-hour limit, shared across server instances. */
    countTurnsSince(orgId: string, userId: string, sinceIso: string): Promise<number>;
    /** What happened to this operation, for this person. A second "Yes" must not create a second ticket. */
    opStatus(orgId: string, userId: string, opId: string): Promise<'none' | 'accepted' | 'failed'>;
}
