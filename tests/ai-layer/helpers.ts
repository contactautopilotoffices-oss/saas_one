import type { ActorContext, AiData, TicketCountRow, TicketListRow, TicketQuery, ReadingsStatusRow, ConsumptionRow } from '../../backend/lib/aiLayer/types';
import type { AuditRow, AuditStore } from '../../backend/lib/aiLayer/audit';
import type { InterpretLlm } from '../../backend/lib/aiLayer/interpret';
import type { PipelineDeps } from '../../backend/lib/aiLayer/pipeline';
import { parseSettings, type AiSettings } from '../../backend/lib/aiLayer/settings';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
export const ANDHERI = '22222222-2222-4222-8222-222222222222';
export const PAREL = '33333333-3333-4333-8333-333333333333';
export const THANE = '44444444-4444-4444-8444-444444444444';
export const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const NAMES: Record<string, string> = { [ANDHERI]: 'Work Square Andheri', [PAREL]: 'VFS Lower Parel', [THANE]: 'Thane One' };

export function actor(over: Partial<ActorContext> = {}): ActorContext {
    const propertyIds = over.propertyIds ?? [ANDHERI];
    return {
        userId: USER, orgId: ORG, roles: ['property_admin'], orgWide: false, propertyIds,
        propertyNames: Object.fromEntries(propertyIds.map(id => [id, NAMES[id]])), ownRecordsOnly: false, recordRule: 'all_in_scope',
        ...over,
    };
}

/** Settings with the AI on for everyone in the grid roles. */
export function settings(over: Record<string, unknown> = {}): AiSettings {
    return parseSettings({
        enabled: true,
        access: { mode: 'all_staff', userIds: [], roles: [] },
        grid: {
            property_admin: { tickets: 'questions_actions', electricity_readings: 'questions' },
            org_super_admin: { tickets: 'questions_actions', electricity_readings: 'questions' },
            tenant: { tickets: 'questions_actions', electricity_readings: 'questions' },
        },
        ...over,
    });
}

export class FakeData implements AiData {
    tickets: Array<{ propertyId: string; status: string; category: string | null; raisedBy: string; assignedTo: string | null; createdAt: string; title: string; number: string; priority: string }> = [];
    meters: ReadingsStatusRow[] = [];
    readings: ConsumptionRow[] = [];
    created: Array<{ propertyId: string; description: string; title?: string; priority?: string }> = [];
    queries: TicketQuery[] = [];
    failCreate = false;

    private match(q: TicketQuery) {
        this.queries.push(q);
        return this.tickets.filter(t => q.propertyIds.includes(t.propertyId) && t.createdAt >= q.from && t.createdAt < q.to
            && (q.status === 'all' || (q.status === 'closed') === ['resolved', 'completed', 'closed'].includes(t.status))
            && (q.recordRule !== 'raised_by_me' || t.raisedBy === q.userId)
            && (q.recordRule !== 'assigned_to_me' || t.assignedTo === q.userId)
            && (!q.priority || t.priority === q.priority));
    }
    async countTickets(q: TicketQuery): Promise<TicketCountRow[]> {
        return this.match(q).map(t => ({ propertyId: t.propertyId, status: t.status, category: t.category }));
    }
    async listTickets(q: TicketQuery, limit: number): Promise<TicketListRow[]> {
        return this.match(q).slice(0, limit).map(t => ({ ticketNumber: t.number, title: t.title, status: t.status, priority: t.priority, propertyId: t.propertyId, createdAt: t.createdAt }));
    }
    async readingsStatus(propertyIds: string[]): Promise<ReadingsStatusRow[]> {
        return this.meters.filter(m => propertyIds.includes(m.propertyId));
    }
    async consumption(propertyIds: string[], from: string, to: string): Promise<ConsumptionRow[]> {
        return this.readings.filter(r => propertyIds.includes(r.propertyId) && r.date >= from && r.date < to);
    }
    async createTicket(input: { propertyId: string; description: string; title?: string; priority?: string }) {
        if (this.failCreate) throw new Error('boom');
        this.created.push(input);
        return { ticketNumber: `TKT-${this.created.length}`, status: 'assigned', assigneeName: 'Suresh' };
    }
}

export class FakeAudit implements AuditStore {
    rows: AuditRow[] = [];
    failWrites = false;
    async write(row: AuditRow) { if (this.failWrites) throw new Error('db down'); this.rows.push(row); }
    async countActionsSince(orgId: string, userId: string) {
        return this.rows.filter(r => r.organization_id === orgId && r.actor_user_id === userId && (r.decision === 'accepted' || r.decision === 'shadow')).length;
    }
    async countTurnsSince(orgId: string, userId: string) { return this.rows.filter(r => r.organization_id === orgId && r.actor_user_id === userId).length; }
    async opStatus(orgId: string, userId: string, opId: string): Promise<'none' | 'accepted' | 'failed'> {
        const mine = this.rows.filter(r => r.organization_id === orgId && r.actor_user_id === userId && r.op_id === opId);
        return mine.some(r => r.decision === 'error') ? 'failed' : mine.some(r => r.decision === 'accepted') ? 'accepted' : 'none';
    }
}

/** A fake model: returns the scripted JSON for the first matching pattern, records every prompt it was shown. */
export class FakeLlm implements InterpretLlm {
    prompts: string[] = [];
    calls = 0;
    fail = false;
    constructor(private script: Array<[RegExp, unknown]>) {}
    async complete(system: string, user: string) {
        this.calls++;
        this.prompts.push(system);
        if (this.fail) throw new Error('every model failed');
        const hit = this.script.find(([re]) => re.test(user));
        return { text: hit ? JSON.stringify(hit[1]) : '{"entry":"none","fields":{},"topic":"something else"}', tokensIn: 100, tokensOut: 20, model: 'fake' };
    }
}

export const NOW = new Date('2026-11-04T06:30:00Z'); // 12:00 noon in India

export function deps(data: FakeData, llm: FakeLlm, audit: FakeAudit, allow = () => true): PipelineDeps {
    return { data, llm, audit, now: () => NOW, allowMessage: allow };
}
