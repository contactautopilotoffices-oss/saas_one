/**
 * The fake world the brain's test set runs in: made-up tickets, rooms, tasks, memory and an in-memory audit log.
 * Nothing here touches a database, a model key, the network or WhatsApp, which is why a test of the brain (from the
 * tests, from scripts/brain/eval.ts, or from the console's guidance test) can never write anything real or send a
 * message. It lives with the brain's code, not under tests/, because the console's guidance test runs it on the server.
 */
import type { AuditRow, AuditStore } from '../../audit';
import type { ActorContext, ConsumptionRow, ReadingsStatusRow, TicketCountRow, TicketListRow, TicketQuery } from '../../types';
import { parseBrainSettings, type BrainSettings } from '../config';
import type { AttachmentRef, BookingRow, BrainData, EpisodeRow, GivenTask, MemoryFact, RoomRow, StagedFile, TaskPerson, TaskRow, TicketDetail } from '../types';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const ANDHERI = '22222222-2222-4222-8222-222222222222';
export const PAREL = '33333333-3333-4333-8333-333333333333';
export const THANE = '44444444-4444-4444-8444-444444444444';
export const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const NAMES: Record<string, string> = { [ANDHERI]: 'Work Square Andheri', [PAREL]: 'VFS Lower Parel', [THANE]: 'Thane One' };
/** The fixed clock of every test: 4 November 2026, 12:00 noon in India. */
export const NOW = new Date('2026-11-04T06:30:00Z');

export const ROOM_A = 'aaaa1111-1111-4111-8111-111111111111';
export const ROOM_B = 'bbbb2222-2222-4222-8222-222222222222';
export const TASK_1 = 'cccc3333-3333-4333-8333-333333333333';
export const TASK_2 = 'dddd4444-4444-4444-8444-444444444444';
export const FILE_1 = 'eeee5555-5555-4555-8555-555555555555';
export const COLLEAGUE_2 = 'ffff6666-6666-4666-8666-666666666666';
export const GIVEN_1 = '99998888-7777-4666-8555-444433332222';

export function actor(over: Partial<ActorContext> = {}): ActorContext {
    const propertyIds = over.propertyIds ?? [ANDHERI];
    return {
        userId: USER, orgId: ORG, roles: ['property_admin'], orgWide: false, propertyIds,
        propertyNames: Object.fromEntries(propertyIds.map(id => [id, NAMES[id]])), ownRecordsOnly: false, recordRule: 'all_in_scope',
        ...over,
    };
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

const CLOSED = ['resolved', 'completed', 'closed'];

export interface FakeTicket { id: string; number: string; title: string; status: string; priority: string | null; propertyId: string; raisedBy: string; assignedTo: string | null; createdAt: string; category: string | null; hasPhoto: boolean }

export class FakeBrainData implements BrainData {
    tickets: FakeTicket[] = [];
    rooms: RoomRow[] = [{ id: ROOM_A, name: 'Board Room', propertyId: ANDHERI }, { id: ROOM_B, name: 'Huddle 2', propertyId: ANDHERI }];
    /** Room ids that are taken for any window asked about. */
    taken = new Set<string>();
    bookings: BookingRow[] = [];
    tasks: TaskRow[] | null = [{ id: TASK_1, n: 1, title: 'Paint the lobby wall', status: 'pending' }, { id: TASK_2, n: 2, title: 'Check the DG set', status: 'in_progress' }];
    memory: MemoryFact[] = [];
    episodes: EpisodeRow[] = [];
    files = new Map<string, StagedFile>([[FILE_1, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', fileName: 'photo.jpg' }]]);
    meters: ReadingsStatusRow[] = [];
    readings: ConsumptionRow[] = [];
    wiki: { found: boolean; answer: string } = { found: false, answer: '' };

    created: Array<{ opId: string; propertyId: string; description: string; title?: string; priority?: string; photo?: StagedFile | null }> = [];
    booked: Array<{ opId: string; roomId: string; date: string; startTime: string; endTime: string }> = [];
    ticketPhotos: Array<{ ticketId: string }> = [];
    taskFiles: Array<{ userId: string; taskId: string }> = [];
    used: Array<{ id: string; usedBy: string }> = [];
    queries: Array<{ recordRule: string; propertyIds: string[]; userId: string }> = [];
    failReads = false;
    failBooking: string | null = null;
    failMemory = false;
    failPhoto = false;

    private visible(q: { propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string }) {
        if (this.failReads) throw new Error('db down');
        this.queries.push({ recordRule: q.recordRule, propertyIds: q.propertyIds, userId: q.userId });
        return this.tickets.filter(t => q.propertyIds.includes(t.propertyId)
            && (q.recordRule !== 'raised_by_me' || t.raisedBy === q.userId) && (q.recordRule !== 'assigned_to_me' || t.assignedTo === q.userId));
    }
    private detail = (t: FakeTicket): TicketDetail => ({ id: t.id, ticketNumber: t.number, title: t.title, status: t.status, priority: t.priority, propertyId: t.propertyId, createdAt: t.createdAt, assigneeName: t.assignedTo ? 'Suresh' : null, hasPhoto: t.hasPhoto });
    private inPeriod(q: TicketQuery) {
        return this.visible(q).filter(t => t.createdAt >= q.from && t.createdAt < q.to && (q.status === 'all' || (q.status === 'closed') === CLOSED.includes(t.status)) && (!q.priority || t.priority === q.priority));
    }
    async countTickets(q: TicketQuery): Promise<TicketCountRow[]> { return this.inPeriod(q).map(t => ({ propertyId: t.propertyId, status: t.status, category: t.category })); }
    async listTickets(q: TicketQuery, limit: number): Promise<TicketListRow[]> { return this.inPeriod(q).slice(0, limit).map(t => ({ ticketNumber: t.number, title: t.title, status: t.status, priority: t.priority, propertyId: t.propertyId, createdAt: t.createdAt })); }
    async ticketDetail(q: { orgId: string; propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string; ticketNumber: string }) {
        const hit = this.visible(q).find(t => t.number.toLowerCase() === q.ticketNumber.toLowerCase());
        return hit ? this.detail(hit) : null;
    }
    async recentTickets(q: { orgId: string; propertyIds: string[]; recordRule: ActorContext['recordRule']; userId: string; openOnly: boolean }, limit: number) {
        return this.visible(q).filter(t => !q.openOnly || !CLOSED.includes(t.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(this.detail);
    }
    async createTicket(input: { opId: string; propertyId: string; description: string; title?: string; priority?: string; photo?: StagedFile | null }) {
        this.created.push(input);
        return { ticketNumber: `TKT-${900 + this.created.length}`, status: 'assigned', assigneeName: 'Suresh', photoAttached: !!input.photo && !this.failPhoto };
    }
    async addTicketPhoto(input: { ticketId: string; photo: StagedFile }) { this.ticketPhotos.push({ ticketId: input.ticketId }); }
    async readingsStatus(propertyIds: string[]) { return this.meters.filter(m => propertyIds.includes(m.propertyId)); }
    async consumption(propertyIds: string[], from: string, to: string) { return this.readings.filter(r => propertyIds.includes(r.propertyId) && r.date >= from && r.date < to); }
    async listRooms(propertyId: string) { return this.rooms.filter(r => r.propertyId === propertyId); }
    async availableRooms(propertyId: string) { return this.rooms.filter(r => r.propertyId === propertyId && !this.taken.has(r.id)); }
    async myBookings(_userId: string, propertyIds: string[], fromDate: string) { return this.bookings.filter(b => propertyIds.includes(b.propertyId) && b.date >= fromDate); }
    async bookRoom(input: { opId: string; userId: string; propertyId: string; roomId: string; date: string; startTime: string; endTime: string; purpose: string | null }) {
        if (this.failBooking) throw Object.assign(new Error(this.failBooking), { code: this.failBooking });
        this.booked.push({ opId: input.opId, roomId: input.roomId, date: input.date, startTime: input.startTime, endTime: input.endTime });
        return { bookingId: `BK-${this.booked.length}` };
    }
    async myTasks() { return this.tasks; }
    async addTaskFile(input: { userId: string; taskId: string; file: StagedFile }) { this.taskFiles.push({ userId: input.userId, taskId: input.taskId }); }
    // Tasks in the brain (owner 2026-11-15). Nothing is sent: each call is only recorded.
    people: TaskPerson[] | null = [{ id: OTHER_USER, name: 'Ravi Kumar', department: 'Facilities' }, { id: COLLEAGUE_2, name: 'Asha Rao', department: 'Facilities' }];
    given: GivenTask[] | null = [{ id: GIVEN_1, title: 'Send the monthly DG report', assigneeName: 'Ravi Kumar', status: 'pending', date: '2026-11-03' }];
    taskCalls: Array<{ op: string; input: Record<string, unknown> }> = [];
    /** Task ids / titles the Task Manager refuses, with its reason. */
    refuseTask = new Map<string, string>();
    async taskPeople() { return this.people; }
    async tasksGiven() { return this.given; }
    async createTasks(input: { userId: string; assigneeId: string; titles: string[]; date: string; note: string | null }) {
        this.taskCalls.push({ op: 'create', input });
        const failed = input.titles.filter(t => this.refuseTask.has(t)).map(t => ({ label: t, why: this.refuseTask.get(t)! }));
        return { done: input.titles.filter(t => !this.refuseTask.has(t)), failed, assigneeName: this.people?.find(p => p.id === input.assigneeId)?.name ?? '' };
    }
    async completeTasks(input: { userId: string; taskIds: string[]; remark: string | null }) {
        this.taskCalls.push({ op: 'complete', input });
        return { done: input.taskIds.filter(id => !this.refuseTask.has(id)), failed: input.taskIds.filter(id => this.refuseTask.has(id)).map(id => ({ label: id, why: this.refuseTask.get(id)! })) };
    }
    async handOverTask(input: { userId: string; taskId: string; toId: string; note: string | null }) {
        this.taskCalls.push({ op: 'hand_over', input });
        if (this.refuseTask.has(input.taskId)) throw new Error(this.refuseTask.get(input.taskId));
        return { toName: this.people?.find(p => p.id === input.toId)?.name ?? '' };
    }
    async remindTasks(input: { userId: string; taskIds: string[] }) {
        this.taskCalls.push({ op: 'remind', input });
        const ok = input.taskIds.filter(id => !this.refuseTask.has(id));
        return { reminded: ok.length ? [{ name: 'Ravi Kumar', count: ok.length }] : [], skipped: input.taskIds.filter(id => this.refuseTask.has(id)).map(id => ({ title: this.given?.find(g => g.id === id)?.title ?? id, why: this.refuseTask.get(id)! })) };
    }
    async askKnowledge() { return this.wiki; }
    async listMemory() { if (this.failMemory) throw new Error('memory down'); return this.memory; }
    async saveMemory(input: { orgId: string; userId: string; key: string; value: string; label: string; source: string }) {
        this.memory = [...this.memory.filter(m => m.key !== input.key), { key: input.key, value: input.value, label: input.label, source: input.source, confirmedAt: NOW.toISOString(), lastUsedAt: null }];
    }
    async forgetMemory(_o: string, _u: string, key: string | null) { const before = this.memory.length; this.memory = key ? this.memory.filter(m => m.key !== key) : []; return before - this.memory.length; }
    async recallEpisodes(_o: string, _u: string, query: string, limit: number) { return this.episodes.filter(e => query.toLowerCase().split(/\s+/).some(w => e.summary.toLowerCase().includes(w))).slice(0, limit); }
    async addEpisode(input: { orgId: string; userId: string; summary: string; skillId: string }) { this.episodes.push({ at: NOW.toISOString(), summary: input.summary }); }
    async loadAttachment(id: string) { return this.files.get(id) ?? null; }
    async markAttachmentUsed(id: string, usedBy: string) { this.used.push({ id, usedBy }); }
}

export function ticket(over: Partial<FakeTicket> = {}): FakeTicket {
    return { id: '77777777-7777-4777-8777-777777777777', number: 'TKT-101', title: 'AC not cooling in cabin 4', status: 'open', priority: 'high', propertyId: ANDHERI, raisedBy: USER, assignedTo: null, createdAt: '2026-11-03T05:00:00Z', category: 'HVAC', hasPhoto: false, ...over };
}

/** Live for everyone, every action skill live (the default for an action skill is practice). */
export function brainSettings(over: Record<string, unknown> = {}): BrainSettings {
    return parseBrainSettings({
        mode: 'live', audience: 'everyone', channels: { whatsapp: true, app_chat: true },
        skillModes: { 'ticket.create': 'live', 'ticket.add_photo': 'live', 'room.book': 'live', 'task.add_file': 'live' },
        ...over,
    });
}

export const photo = (over: Partial<AttachmentRef> = {}): AttachmentRef => ({ handle: 'A1', id: FILE_1, kind: 'image', mime: 'image/jpeg', caption: null, receivedAt: NOW.toISOString(), ...over });
