import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * The bill audit trail — who checked, who approved, and when.
 *
 * SPEC-ELECTRICITY.md REQ-E-11 asks: "Six months from now, can I prove who checked and who
 * approved?" Before this module the answer was no: workflow_status was an UPDATE in place,
 * so each transition overwrote the last and the checker's identity was gone the moment the
 * accepter touched the record.
 *
 * TWO WRITE PATHS, ON PURPOSE
 *   transitionBill()  — the instrumented path. Actor travels with the update inside one
 *                       transaction (RPC electricity_transition_bill), so the trail names
 *                       a person.
 *   a direct UPDATE   — still captured, by the AFTER trigger on electricity_bills, and
 *                       attributed to 'system:*'. Cron transitions genuinely have no human
 *                       behind them and saying so is more honest than borrowing a name.
 *
 * Nothing here can rewrite history: electricity_bill_events revokes UPDATE/DELETE and a
 * trigger raises on any attempt.
 */

export interface BillEvent {
    id: string;
    bill_id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    actor_id: string | null;
    actor_label: string | null;
    note: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    /** Joined for display — the trail must be readable without a second lookup. */
    actor_name?: string | null;
}

export interface TransitionInput {
    billId: string;
    toStatus: string;
    actorId?: string | null;
    /** 'ops_super_admin:dipti@…' or 'system:electricity-validate'. */
    actorLabel?: string | null;
    note?: string | null;
}

/**
 * Move a bill's workflow_status with the actor attached. Returns false when the audit
 * migration is not applied yet, so callers can fall back to a plain update rather than
 * failing the user's action outright.
 */
export async function transitionBill(input: TransitionInput): Promise<boolean> {
    const { error } = await supabaseAdmin.rpc('electricity_transition_bill', {
        p_bill_id: input.billId,
        p_to_status: input.toStatus,
        p_actor_id: input.actorId ?? null,
        p_actor_label: input.actorLabel ?? null,
        p_note: input.note ?? null,
    });

    if (error) {
        // 42883 = function does not exist (migration not applied). Anything else is real.
        if (isMissingRelation(error) || error.code === '42883') {
            console.warn('[electricity audit] transition RPC unavailable, falling back:', error.message);
            return false;
        }
        throw new Error(error.message);
    }
    return true;
}

/**
 * Transition, falling back to a plain update when the RPC is absent. The fallback still
 * records an event via the trigger if THAT is present — it only loses the actor name.
 */
export async function transitionBillOrUpdate(input: TransitionInput): Promise<void> {
    const viaRpc = await transitionBill(input);
    if (viaRpc) return;

    const patch: Record<string, unknown> = { workflow_status: input.toStatus, updated_at: new Date().toISOString() };
    if (input.toStatus === 'paid') patch.cycle_completed_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from('electricity_bills').update(patch).eq('id', input.billId);
    if (error && !isMissingRelation(error)) throw new Error(error.message);
}

/** A free-standing note on a bill — a dispute opened, a validation re-run, a manual fix. */
export async function recordBillEvent(params: {
    organizationId: string;
    billId: string;
    eventType: 'dispute' | 'validation' | 'note' | 'ingest';
    fromStatus?: string | null;
    toStatus?: string | null;
    actorId?: string | null;
    actorLabel?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const { error } = await supabaseAdmin.from('electricity_bill_events').insert({
        organization_id: params.organizationId,
        bill_id: params.billId,
        event_type: params.eventType,
        from_status: params.fromStatus ?? null,
        to_status: params.toStatus ?? null,
        actor_id: params.actorId ?? null,
        actor_label: params.actorLabel ?? null,
        note: params.note ?? null,
        metadata: params.metadata ?? {},
    });
    // An audit write must never break the action it is describing, but it must also never
    // vanish silently — log loudly and continue (FP-04).
    if (error && !isMissingRelation(error)) {
        console.error('[electricity audit] event insert failed:', error.message);
    }
}

/** The trail for one bill, newest first, with actor names resolved. */
export async function loadBillTrail(
    organizationId: string,
    billId: string,
): Promise<{ provisioned: boolean; events: BillEvent[] }> {
    const { data, error } = await supabaseAdmin
        .from('electricity_bill_events')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('bill_id', billId)
        .order('created_at', { ascending: false })
        .range(0, 499);

    if (error) {
        if (isMissingRelation(error)) return { provisioned: false, events: [] };
        throw new Error(error.message);
    }

    const events = (data || []) as BillEvent[];
    const actorIds = [...new Set(events.map(e => e.actor_id).filter(Boolean))] as string[];
    if (actorIds.length === 0) return { provisioned: true, events };

    const { data: users } = await supabaseAdmin
        .from('users').select('id, full_name, email').in('id', actorIds);
    const nameById = new Map((users || []).map(u => [u.id, u.full_name || u.email || null]));

    return {
        provisioned: true,
        events: events.map(e => ({ ...e, actor_name: e.actor_id ? nameById.get(e.actor_id) ?? null : null })),
    };
}

/** Builds the actor label for a request. Keeps 'role:identity' shape consistent. */
export function actorLabelFor(access: { user: { email?: string }; roles: string[] }): string {
    const role = access.roles[0] || 'user';
    return `${role}:${access.user.email || 'unknown'}`;
}
