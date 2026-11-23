/**
 * The SLA a new ticket gets (owner 2026-11-19: SLA "configurable where i can choose": one time per category, or a time
 * for each priority). Set in Brain → Categories & SLAs (categoryConfig.ts). A category with no per-priority times
 * (sla_by_priority empty, or migration 20261119000006 not applied) gives exactly the SLA it gives today.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SLA_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];
export type SlaPlan = Record<SlaPriority, number>;

/** A plan with a sensible number for every priority, or null. 'critical' counts as urgent. */
export function asSlaPlan(raw: unknown): SlaPlan | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const out = {} as SlaPlan;
    for (const p of SLA_PRIORITIES) {
        const n = Number(r[p]);
        if (!Number.isFinite(n) || n <= 0 || n > 720) return null;
        out[p] = n;
    }
    return out;
}

/** The hours for this priority from the plan; else the category's one time; else the fallback (pure). */
export function slaHoursFrom(plan: unknown, priority: string | null | undefined, oneTime: number | null | undefined, fallback: number): number {
    const p = asSlaPlan(plan);
    const key = String(priority ?? '').toLowerCase() === 'critical' ? 'urgent' : String(priority ?? '').toLowerCase();
    if (p && (SLA_PRIORITIES as readonly string[]).includes(key)) return p[key as SlaPriority];
    return oneTime && oneTime > 0 ? oneTime : fallback;
}

/**
 * The hours for a new ticket in this category at this priority. Reads only the per-priority plan; any failure
 * (no category, column not there yet, database slow) gives `today`, the hours the caller worked out as before.
 */
export async function slaHoursFor(db: SupabaseClient, categoryId: string | null | undefined, priority: string | null | undefined, today: number): Promise<number> {
    if (!categoryId) return today;
    try {
        const { data, error } = await db.from('issue_categories').select('sla_by_priority').eq('id', categoryId).maybeSingle();
        if (error || !data) return today;
        return slaHoursFrom((data as Record<string, unknown>).sla_by_priority, priority, today, today);
    } catch {
        return today;
    }
}
