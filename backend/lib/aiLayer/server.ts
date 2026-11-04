/**
 * Real implementations of the layer's dependencies (database, AI model, audit). Server only.
 *
 * Reads use the service-role client, so EVERY query below is limited to the person's propertyIds (and tickets also by
 * organization_id, raised_by / assigned_to for tenants and vendors) in code. propertyIds come from loadActor(), which
 * keeps only active properties of the person's own org; they never come from the AI or the client.
 * Ticket creation does NOT use the service role: it calls the app's own POST /api/tickets handler inside the same
 * request, so it runs as the logged-in person with the same classification, assignment and notifications as the form.
 */
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiData, ConsumptionRow, ReadingsStatusRow, TicketCountRow, TicketListRow, TicketQuery } from './types';
import type { AuditRow, AuditStore } from './audit';
import type { InterpretLlm } from './interpret';
import { parseSettings, type AiSettings } from './settings';
import { BRAIN_INTERPRET_MODELS, HEDGE_UNDERSTAND_MS, engyBrainLlm, withModelFallback } from '@/task-manager/brain/llm';

const CLOSED_STATUSES = ['resolved', 'completed', 'closed'];

function ticketQuery(admin: SupabaseClient, select: string, q: TicketQuery) {
    let query = admin.from('tickets').select(select)
        .eq('organization_id', q.orgId)
        .in('property_id', q.propertyIds)
        .gte('created_at', q.from)
        .lt('created_at', q.to);
    if (q.status === 'open') query = query.not('status', 'in', `(${CLOSED_STATUSES.join(',')})`);
    if (q.status === 'closed') query = query.in('status', CLOSED_STATUSES);
    if (q.recordRule === 'raised_by_me') query = query.eq('raised_by', q.userId);
    if (q.recordRule === 'assigned_to_me') query = query.eq('assigned_to', q.userId);
    if (q.priority) query = query.eq('priority', q.priority);
    return query;
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as T;
}

export function supabaseAiData(admin: SupabaseClient, requestUrl: string): AiData {
    return {
        async countTickets(q) {
            if (!q.propertyIds.length) return [];
            const rows = must(await ticketQuery(admin, 'property_id, status, category:issue_categories(name)', q).limit(5000)) as unknown as Array<{ property_id: string; status: string; category: { name: string } | { name: string }[] | null }>;
            return rows.map((r): TicketCountRow => ({
                propertyId: r.property_id, status: String(r.status || ''),
                category: Array.isArray(r.category) ? (r.category[0]?.name ?? null) : (r.category?.name ?? null),
            }));
        },
        async listTickets(q, limit) {
            if (!q.propertyIds.length) return [];
            const rows = must(await ticketQuery(admin, 'ticket_number, title, status, priority, property_id, created_at', q).order('created_at', { ascending: false }).limit(limit)) as unknown as Array<Record<string, string | null>>;
            return rows.map((r): TicketListRow => ({
                ticketNumber: String(r.ticket_number ?? ''), title: String(r.title ?? ''), status: String(r.status ?? ''),
                priority: r.priority ?? null, propertyId: String(r.property_id), createdAt: String(r.created_at ?? ''),
            }));
        },
        async readingsStatus(propertyIds, date) {
            if (!propertyIds.length) return [];
            const meters = must(await admin.from('electricity_meters').select('id, name, status, property_id').in('property_id', propertyIds).in('status', ['active', 'faulty']).limit(2000)) as Array<{ id: string; name: string; status: string; property_id: string }>;
            if (!meters.length) return [];
            const readings = must(await admin.from('electricity_readings').select('meter_id, alert_status, final_units, computed_units').in('property_id', propertyIds).eq('reading_date', date).limit(5000)) as Array<{ meter_id: string; alert_status: string | null; final_units: number | null; computed_units: number | null }>;
            const byMeter = new Map(readings.map(r => [r.meter_id, r]));
            return meters.map((m): ReadingsStatusRow => {
                const r = byMeter.get(m.id);
                return { propertyId: m.property_id, meterName: m.name, meterStatus: m.status, logged: !!r, alertStatus: r?.alert_status ?? null, units: r ? Number(r.final_units ?? r.computed_units ?? 0) : null };
            });
        },
        async consumption(propertyIds, from, to) {
            if (!propertyIds.length) return [];
            const rows = must(await admin.from('electricity_readings').select('id, property_id, reading_date, final_units, computed_units').in('property_id', propertyIds).gte('reading_date', from).lt('reading_date', to).limit(20000)) as Array<{ id: string; property_id: string; reading_date: string; final_units: number | null; computed_units: number | null }>;
            // Known bad rows are left out of totals. If the view is missing, nothing is excluded (and the total says so).
            const anomalies = await admin.from('electricity_reading_anomalies').select('id').in('property_id', propertyIds).gte('reading_date', from).lt('reading_date', to).limit(5000);
            const bad = new Set(anomalies.error ? [] : ((anomalies.data || []) as Array<{ id: string }>).map(a => a.id));
            return rows.map((r): ConsumptionRow => ({ propertyId: r.property_id, date: r.reading_date, units: Number(r.final_units ?? r.computed_units ?? 0), anomaly: bad.has(r.id) }));
        },
        async createTicket(input) {
            // The app's own ticket handler, as the logged-in person (cookie session of this request). organizationId
            // comes from the property row, never from the AI; assignedTo is never passed.
            const prop = await admin.from('properties').select('organization_id').eq('id', input.propertyId).single();
            if (prop.error || !prop.data) throw new Error('property not found');
            const { POST } = await import('@/app/api/tickets/route');
            const req = new NextRequest(new URL('/api/tickets', requestUrl), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: input.description, title: input.title, propertyId: input.propertyId, organizationId: prop.data.organization_id, ...(input.priority ? { priority: input.priority } : {}) }),
            });
            const res = await POST(req);
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body?.ticket) throw new Error(`ticket route returned ${res.status}`);
            let assigneeName: string | null = null;
            if (body.ticket.assigned_to) {
                const u = await admin.from('users').select('full_name').eq('id', body.ticket.assigned_to).maybeSingle();
                assigneeName = (u.data?.full_name || '').split(' ')[0] || null; // first name only
            }
            return { ticketNumber: String(body.ticket.ticket_number), status: String(body.ticket.status), assigneeName };
        },
    };
}

export function supabaseAuditStore(admin: SupabaseClient): AuditStore {
    return {
        async write(row: AuditRow) {
            const { error } = await admin.from('ai_action_log').insert(row);
            if (error) throw new Error(error.message);
        },
        async countActionsSince(orgId, userId, sinceIso) {
            const { count, error } = await admin.from('ai_action_log').select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId).eq('actor_user_id', userId).in('decision', ['accepted', 'shadow']).gte('created_at', sinceIso);
            if (error) throw new Error(error.message);
            return count ?? 0;
        },
        async countTurnsSince(orgId, userId, sinceIso) {
            const { count, error } = await admin.from('ai_action_log').select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId).eq('actor_user_id', userId).gte('created_at', sinceIso);
            if (error) throw new Error(error.message);
            return count ?? 0;
        },
        async opStatus(orgId, userId, opId) {
            const { data, error } = await admin.from('ai_action_log').select('decision')
                .eq('organization_id', orgId).eq('actor_user_id', userId).eq('op_id', opId).in('decision', ['accepted', 'error']).limit(10);
            if (error) throw new Error(error.message);
            const decisions = new Set(((data || []) as Array<{ decision: string }>).map(r => r.decision));
            return decisions.has('error') ? 'failed' : decisions.has('accepted') ? 'accepted' : 'none';
        },
    };
}

/** The org's settings. A missing table or row means OFF (fail closed). */
export async function loadSettings(admin: SupabaseClient, orgId: string): Promise<{ settings: AiSettings; tableMissing: boolean }> {
    const { data, error } = await admin.from('ai_access_settings').select('config').eq('organization_id', orgId).maybeSingle();
    if (error) {
        const missing = ['42P01', 'PGRST205', 'PGRST202'].includes((error as { code?: string }).code ?? '');
        if (!missing) throw new Error(error.message);
        return { settings: parseSettings({ enabled: false }), tableMissing: true };
    }
    return { settings: parseSettings(data?.config ?? { enabled: false }), tableMissing: false };
}

/** Reuses the WhatsApp brain's model chain (Claude Haiku first, then the backups) and its fallback logic. */
export function brainInterpretLlm(): InterpretLlm {
    const llm = engyBrainLlm();
    return {
        async complete(system, user) {
            const { value, trace } = await withModelFallback(BRAIN_INTERPRET_MODELS, async model => {
                const r = await llm.complete({ model, system, user, json: true, maxTokens: 400 });
                if (!/\{[\s\S]*\}/.test(r.text)) throw new Error('no JSON in reply');
                return r;
            }, 'ai-layer interpret', { hedgeMs: HEDGE_UNDERSTAND_MS });
            return { text: value.text, tokensIn: value.tokensIn, tokensOut: value.tokensOut, model: trace.model };
        },
    };
}
