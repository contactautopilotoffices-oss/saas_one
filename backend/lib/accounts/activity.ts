import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { PoActivityAction, ActorChannel } from './trackerTypes';

/**
 * The PO timeline writer — one entry per thing that happened to a purchase order.
 *
 * Modelled on petty_cash_activity, which this org already reads fluently, with one
 * difference that matters: the actor's NAME AND ROLE ARE DENORMALISED AT WRITE TIME.
 * A uuid alone stops telling the story the moment a user is deactivated (users rows are
 * kept, but memberships go inactive and roles change), and an audit trail that becomes
 * unreadable in six months is not an audit trail.
 *
 * TWO HARD RULES:
 *   1. Logging must NEVER break a mutation. Every failure — including the table not
 *      existing because 20260805000001 has not been applied — is swallowed. A payment
 *      that succeeded must not 500 because its diary entry did not.
 *   2. Logging happens AFTER the write it describes. The log records history, not intent.
 */

export interface LogPoActivityInput {
    organizationId: string;
    /** Omit for vendor-level events; pass `vendorProfileId` instead. One of the two is required. */
    poId?: string | null;
    /**
     * The subject for events that belong to a supplier rather than a purchase order —
     * a Zoho compliance sync, a certificate expiring. po_activity_log.po_id is nullable
     * and carries a CHECK that one of the two is set, so these entries stand on their own.
     */
    vendorProfileId?: string | null;
    paymentId?: string | null;
    action: PoActivityAction;
    fromStatus?: string | null;
    toStatus?: string | null;
    /** Omit for system/cron writes; the entry is then attributed to the channel alone. */
    actorId?: string | null;
    /** Pass when already known (saves a lookup). Otherwise resolved from `users`. */
    actorName?: string | null;
    /** Pass when already known — e.g. AccountsAccess.roles. Otherwise resolved from memberships. */
    actorRole?: string | null;
    actorChannel?: ActorChannel;
    note?: string | null;
    detail?: Record<string, unknown> | null;
}

interface ActorIdentity {
    name: string | null;
    role: string | null;
}

// A short-lived cache: a burst of log writes in one request must not re-query the same
// user. Deliberately tiny and time-boxed — a stale role for 60s is harmless, a stale role
// forever is the denormalisation bug this file exists to avoid.
const IDENTITY_TTL_MS = 60_000;
const identityCache = new Map<string, { at: number; value: ActorIdentity }>();

/** Roles that mean something in this module, most specific first. */
const ROLE_PRIORITY = [
    'accounts', 'org_super_admin', 'master_admin', 'org_admin',
    'purchase_manager', 'purchase_executive', 'procurement',
];

function pickRole(roles: string[]): string | null {
    for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
    return roles[0] ?? null;
}

async function resolveActor(userId: string, organizationId: string): Promise<ActorIdentity> {
    const key = `${userId}:${organizationId}`;
    const hit = identityCache.get(key);
    if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value;

    // Both membership tables, because an accounts/procurement role legitimately lives on
    // either one — see backend/lib/accounts/access.ts:82,85.
    const [profile, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('full_name, email, is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin.from('organization_memberships').select('role')
            .eq('user_id', userId).eq('organization_id', organizationId).eq('is_active', true),
        supabaseAdmin.from('property_memberships').select('role')
            .eq('user_id', userId).eq('organization_id', organizationId).eq('is_active', true),
    ]);

    const roles = [...(orgRes.data || []), ...(propRes.data || [])]
        .map((m: { role: string | null }) => m.role)
        .filter(Boolean) as string[];

    const value: ActorIdentity = {
        // email is the fallback label, not a placeholder like "Unknown user": it is a real
        // identifier someone can act on.
        name: profile.data?.full_name || profile.data?.email || null,
        role: pickRole(roles) || (profile.data?.is_master_admin ? 'master_admin' : null),
    };
    identityCache.set(key, { at: Date.now(), value });
    return value;
}

/**
 * Append one entry to a PO's — or a vendor's — timeline. Never throws, never rejects.
 *
 * Fire it without awaiting only if you do not care about ordering; awaiting costs one
 * insert and keeps the timeline in the order things actually happened.
 */
export async function logPoActivity(input: LogPoActivityInput): Promise<void> {
    try {
        // Mirrors the po_activity_has_subject CHECK: an entry with neither subject is
        // unreachable from every view, so it is dropped here rather than 23514'ing.
        if (!input.organizationId || (!input.poId && !input.vendorProfileId)) return;

        let actorName = input.actorName ?? null;
        let actorRole = input.actorRole ?? null;
        if (input.actorId && (actorName === null || actorRole === null)) {
            const resolved = await resolveActor(input.actorId, input.organizationId);
            actorName = actorName ?? resolved.name;
            actorRole = actorRole ?? resolved.role;
        }

        const { error } = await supabaseAdmin.from('po_activity_log').insert({
            organization_id: input.organizationId,
            po_id: input.poId ?? null,
            vendor_profile_id: input.vendorProfileId ?? null,
            payment_id: input.paymentId ?? null,
            action: input.action,
            from_status: input.fromStatus ?? null,
            to_status: input.toStatus ?? null,
            actor_id: input.actorId ?? null,
            actor_name: actorName,
            actor_role: actorRole,
            actor_channel: input.actorChannel ?? 'app',
            note: input.note ?? null,
            detail: input.detail ?? null,
        });

        // 42P01 = 20260805000001 has not been applied yet. That is a deployment state, not
        // an error worth shouting about on every mutation.
        if (error && error.code !== '42P01') {
            console.error('[po activity] insert failed:', error.message);
        }
    } catch (e) {
        console.error('[po activity] log failed:', e);
    }
}

/**
 * Log the same event against several POs — used when a vendor-level change affects every
 * PO that vendor currently has in flight.
 *
 * NOT the way to record a vendor event itself: po_activity_log.po_id is nullable and the
 * table carries vendor_profile_id, so a supplier-level change belongs on the vendor's own
 * timeline (`logPoActivity({ vendorProfileId })`). This function is for FAN-OUT — putting a
 * notice on the in-flight POs whose next step the change alters. Bounded on purpose: a
 * compliance flip on a vendor with 400 POs must not write 400 rows.
 */
export async function logPoActivityForPos(
    poIds: string[],
    input: Omit<LogPoActivityInput, 'poId'>,
    limit = 50,
): Promise<void> {
    const unique = [...new Set(poIds)].slice(0, limit);
    for (const poId of unique) {
        await logPoActivity({ ...input, poId });
    }
}
