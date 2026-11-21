/**
 * Plays one test case of the brain's test set through the real turn loop in the FAKE world (world.ts). Used by
 * scripts/brain/eval.ts (a real model), by the console's guidance test (a real model), and by the tests (a scripted
 * model). No database, no sender: a case cannot write anything real or send a WhatsApp message.
 */
import type { ActorContext } from '../../types';
import type { BrainSettings } from '../config';
import { NO_LEARNING, type Learned, type Lesson } from '../learning/lessons';
import { runTurn } from '../loop/turn';
import type { Block, BrainModel, ModelCall, ModelReply } from '../types';
import type { Fixture, GoldenCase } from './cases';
import type { CaseRun } from './grade';
import { ANDHERI, FILE_1, FakeAudit, FakeBrainData, NOW, OTHER_USER, PAREL, ROOM_A, USER, actor, brainSettings, photo, ticket } from './world';

/** The fake world, counting memory changes too, so "nothing was done without a Yes" covers every kind of action. */
export class EvalData extends FakeBrainData {
    memoryWrites = 0;
    override async saveMemory(input: { orgId: string; userId: string; key: string; value: string; label: string; source: string }) { this.memoryWrites++; return super.saveMemory(input); }
    override async forgetMemory(o: string, u: string, key: string | null) { const n = await super.forgetMemory(o, u, key); if (n) this.memoryWrites++; return n; }
    writes(): number { return this.created.length + this.booked.length + this.ticketPhotos.length + this.taskFiles.length + this.memoryWrites; }
}

/** `label` is what a remembered fact is shown as (for a property the name, otherwise the person's own words). */
const fact = (key: string, value: string) => ({ key, value, label: value, source: 'test', confirmedAt: NOW.toISOString(), lastUsedAt: null });

const FIXTURES: Record<Fixture, (data: EvalData, who: { propertyIds: string[] }) => void> = {
    ticket_open: d => { d.tickets.push(ticket()); },
    tickets_many: d => {
        d.tickets.push(
            ticket(),
            ticket({ id: '77777777-7777-4777-8777-777777777702', number: 'TKT-102', title: 'Lift stuck between floors', status: 'closed', priority: 'medium', createdAt: '2026-11-02T04:00:00Z', category: 'Lift' }),
            ticket({ id: '77777777-7777-4777-8777-777777777703', number: 'TKT-103', title: 'Water leak in washroom', status: 'open', priority: 'critical', createdAt: '2026-11-04T04:00:00Z', category: 'Plumbing' }),
        );
    },
    ticket_has_photo: d => { d.tickets.push(ticket({ hasPhoto: true })); },
    ticket_of_other: d => { d.tickets.push(ticket({ id: '77777777-7777-4777-8777-777777777555', number: 'TKT-555', title: 'Projector not working in Huddle 2', raisedBy: OTHER_USER, assignedTo: null, category: 'IT' })); },
    ticket_assigned: d => { d.tickets.push(ticket({ id: '77777777-7777-4777-8777-777777777301', number: 'TKT-301', title: 'Replace tube light, 2nd floor', raisedBy: OTHER_USER, assignedTo: USER, category: 'Electrical' })); },
    room_taken: d => { d.taken.add(ROOM_A); },
    booking: d => { d.bookings.push({ id: 'b0000000-0000-4000-8000-000000000001', roomName: 'Board Room', propertyId: ANDHERI, date: '2026-11-05', startTime: '15:00', endTime: '16:00', status: 'confirmed', roomId: ROOM_A }); },
    memory_room: d => { d.memory.push(fact('preferred_room', 'Board Room')); },
    memory_floor: d => { d.memory.push(fact('usual_location', '3rd floor, cabin 304')); },
    episode: d => { d.episodes.push({ at: '2026-10-28T06:00:00Z', summary: "Raised ticket TKT-88 'Printer jam' at Work Square Andheri" }); },
    meters: d => {
        d.meters.push(
            { propertyId: ANDHERI, meterName: 'Main LT panel', meterStatus: 'active', logged: true, alertStatus: 'normal', units: 120 },
            { propertyId: ANDHERI, meterName: 'DG meter', meterStatus: 'active', logged: false, alertStatus: null, units: null },
        );
    },
    usage: d => {
        d.readings.push(
            { propertyId: ANDHERI, date: '2026-11-01', units: 110, anomaly: false },
            { propertyId: ANDHERI, date: '2026-11-02', units: 120, anomaly: false },
            { propertyId: ANDHERI, date: '2026-11-03', units: 130, anomaly: false },
        );
    },
    wiki: d => { d.wiki = { found: true, answer: 'Pest control is done by GreenShield Services, every second Saturday of the month.' }; },
    two_properties: (_d, who) => { who.propertyIds = [ANDHERI, PAREL]; },
};

export function buildWorld(c: GoldenCase): { data: EvalData; actor: ActorContext } {
    const data = new EvalData();
    const who = { propertyIds: [ANDHERI] };
    for (const f of c.fixtures) FIXTURES[f](data, who);
    const base = { propertyIds: who.propertyIds };
    const person = c.role === 'client' ? actor({ ...base, roles: ['tenant'], ownRecordsOnly: true, recordRule: 'raised_by_me' })
        : c.role === 'vendor' ? actor({ ...base, roles: ['vendor'], ownRecordsOnly: true, recordRule: 'assigned_to_me' })
            : actor(base);
    return { data, actor: person };
}

/** Passes every call through, and keeps what the tools returned to the model (for the grading model). */
class Recording implements BrainModel {
    calls = 0;
    results: string[] = [];
    constructor(private inner: BrainModel) {}
    async call(req: ModelCall): Promise<ModelReply> {
        this.calls++;
        // The last request of a turn carries every tool result of that turn.
        this.results = req.messages.flatMap(m => m.blocks.filter((b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result').map(b => b.text));
        return this.inner.call(req);
    }
}

export interface RunOptions {
    /** A guidance note to play the case with (the console's guidance test). */
    guidance?: string | null;
    /** Lessons to have on hand, with lessons switched on (the safety run: a lesson must never unlock anything). */
    lessons?: Lesson[];
}

export async function runCase(model: BrainModel, modelId: string, c: GoldenCase, o: RunOptions = {}): Promise<CaseRun> {
    const { data, actor: person } = buildWorld(c);
    const audit = new FakeAudit();
    const settings: BrainSettings = brainSettings(o.lessons?.length ? { learning: { lessons: true, maxLessons: 4 } } : {});
    const learned: Learned = { ...NO_LEARNING, lessons: o.lessons ?? [], guidance: o.guidance ? { version: 0, text: o.guidance } : null };
    let state: unknown = null;
    let caption: string | null | undefined; // undefined = no photo has arrived yet
    const turn = async (text: string, withPhoto: boolean, via: BrainModel) => {
        if (withPhoto) caption = text || null;
        // A photo stays open (it is never asked for again) until an action attaches it somewhere.
        const open = caption !== undefined && !data.used.some(u => u.id === FILE_1);
        const out = await runTurn(
            { data, model: via, audit, chain: async () => [modelId], now: () => NOW, allowMessage: () => true, learning: async () => learned },
            { actor: person, settings, channel: c.channel, text, attachments: open ? [photo({ caption: caption ?? null })] : [], state },
        );
        state = out.state;
        return out;
    };
    try {
        for (const b of c.before ?? []) await turn(b.text, !!b.photo, model);
        const before = data.writes();
        const rec = new Recording(model);
        const out = await turn(c.text, !!c.photo, rec);
        const t = out.trace;
        const failed = out.outcome === 'error' && t.hops.length ? t.hops.map(h => h.error).join(' | ').slice(0, 300) : null;
        return {
            outcome: out.outcome, skillId: t.skillId, handoffTo: out.handoffTo, reply: out.reply?.text ?? null, reason: t.reason,
            tools: t.toolCalls.map(x => ({ skillId: x.skillId, kind: x.kind, args: x.args, ok: x.ok })),
            writes: data.writes() - before, modelCalls: t.modelCalls.length, costUsd: t.costUsd, latencyMs: t.latencyMs, toolResults: rec.results, error: failed,
        };
    } catch (err) {
        return { outcome: 'error', skillId: null, handoffTo: null, reply: null, reason: null, tools: [], writes: 0, modelCalls: 0, costUsd: null, latencyMs: 0, toolResults: [], error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
}
