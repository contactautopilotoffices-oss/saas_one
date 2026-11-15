/**
 * Ticket skills. Every read is limited to the person's properties and record rule (a client sees only tickets they
 * raised, a vendor only tickets assigned to them); the same rule is applied again when a write runs.
 */
import { z } from 'zod';
import type { AiData } from '../../types';
import { ticketsCount } from '../../catalog';
import { PERIODS, rangeFor, type Period } from '../../dates';
import { periodLabel, scopeLabel, t } from '../../language';
import { grounded } from '../../pipeline';
import { bt } from '../text';
import type { ReadSkill, SkillContext, TicketDetail, WriteSkill } from '../types';
import { bool, clip, nullableOneOf, nullableStr, oneOf, pickAttachment, pickProperty, quote, schema, scopeProperties, str } from './common';

const STATUS = ['open', 'closed', 'all'] as const;
const PRIORITY = ['low', 'medium', 'high', 'urgent', 'critical'] as const;
const LIST_PERIODS = [...PERIODS, 'any'] as const;
const TICKET_REF = /^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/;

const day = (iso: string) => iso.slice(0, 10);

function detailLine(ctx: SkillContext, d: TicketDetail): string {
    const h = ctx.handle('ticket', d.ticketNumber, `${d.ticketNumber} ${clip(d.title, 40)}`, d.propertyId);
    return `${h} | ${d.ticketNumber} | ${quote(d.title)} | status ${d.status}${d.priority ? ` | priority ${d.priority}` : ''} | ${ctx.actor.propertyNames[d.propertyId] ?? 'property'} | raised ${day(d.createdAt)}`
        + `${d.assigneeName ? ` | assigned to ${d.assigneeName}` : ''} | photo ${d.hasPhoto ? 'yes' : 'no'}`;
}

// ── tickets.count ──────────────────────────────────────────────────────────────────────────────────────────────────

const countArgs = z.object({ period: z.enum(PERIODS).default('today'), status: z.enum(STATUS).default('all'), property: z.string().trim().max(120).nullish() }).strip();

export const ticketsCountSkill: ReadSkill<z.infer<typeof countArgs>> = {
    id: 'tickets.count', module: 'tickets', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Count tickets raised in a period, split into open and closed, with the busiest category. Use for "how many tickets today / this week / pending". Do NOT use to list or find individual tickets (use tickets_list) or to check one ticket (use ticket_status).',
    input: schema({
        period: oneOf(PERIODS, 'The period asked about. Example: "this_week".'),
        status: oneOf(STATUS, '"open", "closed" or "all". Example: "all".'),
        property: nullableStr('The property name as the person said it, or null for all their properties. Example: "Andheri".'),
    }),
    args: countArgs,
    examples: ['how many tickets today', 'is hafte kitne ticket aaye', 'pending tickets count for Andheri'],
    ability: { en: 'count tickets', hi: 'टिकट गिनना', hinglish: 'tickets count karna' },
    allowed: () => true,
    async run(ctx, a) {
        const scope = scopeProperties(ctx, a.property);
        if (!scope.ok) return { text: scope.problem };
        // The answer the existing AI layer already gives: same query, same wording, same scope rules.
        const out = await ticketsCount.run({ actor: ctx.actor, data: ctx.data as unknown as AiData, lang: ctx.lang, now: ctx.now }, { period: a.period, status: a.status, property_name: null }, scope.propertyIds);
        return { text: out.reply, display: out.reply };
    },
};

// ── tickets.list ───────────────────────────────────────────────────────────────────────────────────────────────────

const listArgs = z.object({
    period: z.enum(LIST_PERIODS).default('any'), status: z.enum(STATUS).default('open'),
    priority: z.enum(PRIORITY).nullish(), property: z.string().trim().max(120).nullish(), raised_by_me: z.boolean().default(false),
}).strip();

export const ticketsListSkill: ReadSkill<z.infer<typeof listArgs>> = {
    id: 'tickets.list', module: 'tickets', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'List up to 10 tickets, newest first, each with a handle (T1, T2…) you can use in ticket_status or ticket_add_photo. Use it FIRST whenever the person refers to a ticket without its number ("my AC complaint", "the leak ticket", "my open tickets", "show today\'s critical tickets"). Each row already shows the status and priority, so answer from it; call ticket_status afterwards only when the person asks who it is assigned to. Do NOT use for a count only (use tickets_count).',
    input: schema({
        period: oneOf(LIST_PERIODS, 'When the tickets were raised. Use "any" when the person gave no period. Example: "any".'),
        status: oneOf(STATUS, '"open", "closed" or "all". Use "all" when looking for one particular ticket. Example: "open".'),
        priority: nullableOneOf(PRIORITY, 'Only this priority, or null. Example: "critical".'),
        property: nullableStr('The property name as the person said it, or null. Example: "Lower Parel".'),
        raised_by_me: bool('true when the person means tickets THEY raised ("my ticket", "my complaint"). Example: true.'),
    }),
    args: listArgs,
    examples: ['show my open tickets', 'what happened to my AC complaint', "today's critical tickets at Lower Parel"],
    ability: { en: 'list tickets', hi: 'टिकट की सूची', hinglish: 'tickets ki list' },
    allowed: () => true,
    async run(ctx, a) {
        const scope = scopeProperties(ctx, a.property);
        if (!scope.ok) return { text: scope.problem };
        const { actor } = ctx;
        // raised_by_me can only narrow: a client or vendor keeps their own rule whatever the model passes.
        const recordRule = a.raised_by_me && actor.recordRule === 'all_in_scope' ? 'raised_by_me' as const : actor.recordRule;
        const names = scope.propertyIds.map(id => actor.propertyNames[id]);
        if (a.period === 'any') {
            const rows = await ctx.data.recentTickets({ orgId: actor.orgId, propertyIds: scope.propertyIds, recordRule, userId: actor.userId, openOnly: a.status === 'open' }, 10);
            const kept = rows.filter(r => (a.status !== 'closed' || ['resolved', 'completed', 'closed'].includes(r.status)) && (!a.priority || r.priority === a.priority));
            if (!kept.length) return { text: 'No tickets match.', display: t('tickets_none', ctx.lang, { period: ctx.lang === 'en' ? 'Recent' : ctx.lang === 'hi' ? 'हाल के' : 'Recent', scope: scopeLabel(names, ctx.lang) }) };
            const multi = scope.propertyIds.length > 1;
            return {
                text: `${kept.length} ticket(s), newest first:\n${kept.map(r => detailLine(ctx, r)).join('\n')}`,
                display: kept.map(r => `• ${r.ticketNumber} · ${clip(r.title.replace(/\s+/g, ' '), 60)} · ${r.status}${multi ? ` · ${actor.propertyNames[r.propertyId]}` : ''}`).join('\n'),
            };
        }
        const r = rangeFor(a.period as Period, ctx.now);
        const q = { orgId: actor.orgId, propertyIds: scope.propertyIds, from: r.fromIso, to: r.toIso, status: a.status, recordRule, userId: actor.userId, priority: a.priority ?? null };
        const [rows, all] = await Promise.all([ctx.data.listTickets(q, 10), ctx.data.countTickets(q)]);
        const label = periodLabel(a.period as Period, ctx.lang);
        if (!rows.length) return { text: 'No tickets match.', display: t('tickets_none', ctx.lang, { period: label, scope: scopeLabel(names, ctx.lang) }) };
        const multi = scope.propertyIds.length > 1;
        const lines = rows.map(x => {
            const h = ctx.handle('ticket', x.ticketNumber, `${x.ticketNumber} ${clip(x.title, 40)}`, x.propertyId);
            return `${h} | ${x.ticketNumber} | ${quote(x.title)} | status ${x.status}${x.priority ? ` | priority ${x.priority}` : ''} | ${actor.propertyNames[x.propertyId] ?? 'property'} | raised ${day(x.createdAt)}`;
        });
        return {
            text: `Showing ${rows.length} of ${all.length} ticket(s):\n${lines.join('\n')}`,
            display: `${t('tickets_list_head', ctx.lang, { period: label, scope: scopeLabel(names, ctx.lang), shown: rows.length, total: all.length })}\n`
                + rows.map(x => `• ${x.ticketNumber} · ${clip(x.title.replace(/\s+/g, ' '), 60)} · ${x.status}${x.priority ? ` · ${x.priority}` : ''}${multi ? ` · ${actor.propertyNames[x.propertyId]}` : ''}`).join('\n'),
        };
    },
};

// ── ticket.status ──────────────────────────────────────────────────────────────────────────────────────────────────

const statusArgs = z.object({ ticket: z.string().trim().min(1).max(40) }).strip();

async function findTicket(ctx: SkillContext, ref: string): Promise<TicketDetail | null> {
    const fromHandle = ctx.resolve(ref, 'ticket');
    const number = fromHandle?.id ?? (TICKET_REF.test(ref) ? ref : null);
    if (!number) return null;
    const { actor } = ctx;
    return ctx.data.ticketDetail({ orgId: actor.orgId, propertyIds: actor.propertyIds, recordRule: actor.recordRule, userId: actor.userId, ticketNumber: number });
}

export const ticketStatusSkill: ReadSkill<z.infer<typeof statusArgs>> = {
    id: 'ticket.status', module: 'tickets', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'The current status of ONE ticket: status, priority, who it is assigned to, when it was raised, whether it has a photo. Use when you have its handle (from tickets_list) or the person typed its number. Do NOT guess a number; if you have neither, call tickets_list first.',
    input: schema({ ticket: str('A ticket handle from tickets_list, or the ticket number the person typed. Example: "T1".') }),
    args: statusArgs,
    examples: ['status of TKT-1042', 'is that ticket assigned yet', 'meri ticket ka kya hua'],
    ability: { en: 'check a ticket', hi: 'टिकट की स्थिति', hinglish: 'ticket ka status' },
    allowed: () => true,
    async run(ctx, a) {
        const d = await findTicket(ctx, a.ticket);
        if (!d) return { text: `No ticket "${clip(a.ticket, 30)}" is visible to this person. Do not invent one; call tickets_list or tell them it was not found.` };
        const en = `${d.ticketNumber} · ${clip(d.title.replace(/\s+/g, ' '), 60)}\nStatus: ${d.status}${d.priority ? ` · Priority: ${d.priority}` : ''}\n📍 ${ctx.actor.propertyNames[d.propertyId] ?? ''} · raised ${day(d.createdAt)}${d.assigneeName ? `\nAssigned to: ${d.assigneeName}` : ''}`;
        return { text: detailLine(ctx, d), display: en };
    },
};

// ── ticket.create ──────────────────────────────────────────────────────────────────────────────────────────────────

const createArgs = z.object({
    description: z.string().trim().max(1000).nullish(),
    description_source: z.enum(['person', 'photo']).default('person'),
    location: z.string().trim().max(200).nullish(),
    property: z.string().trim().max(120).nullish(),
    urgent: z.boolean().default(false),
    attachment: z.string().trim().max(10).nullish(),
}).strip();

const createPayload = z.object({
    propertyId: z.string().uuid(), description: z.string().min(3).max(1000), location: z.string().max(200).nullable(),
    urgent: z.boolean(), attachmentId: z.string().uuid().nullable(), fromPhoto: z.boolean(),
}).strict();
type CreatePayload = z.infer<typeof createPayload>;

export const ticketCreateSkill: WriteSkill<z.infer<typeof createArgs>, CreatePayload> = {
    id: 'ticket.create', module: 'tickets', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose a new maintenance / facility ticket (AC not working, leak, light fused, cleaning needed). Calling it does NOT create the ticket: it shows the person a confirmation card and they must say Yes. Use when the person reports a problem or asks to raise a ticket. Do NOT use to check, close, assign or delete tickets. Do NOT use for HR matters (complaints about a person, salary, leave).',
    input: schema({
        description: nullableStr('The problem in the person\'s OWN words, copied, not improved. If they sent only a photo and it plainly shows a fault, a short plain description of what the photo shows. null if you do not know it yet. Example: "AC not cooling".'),
        description_source: oneOf(['person', 'photo'], '"person" when the description is the person\'s words; "photo" only when you wrote it from their photo.'),
        location: nullableStr('Floor, room or cabin if the person said it, else null. Example: "3rd floor, cabin 304".'),
        property: nullableStr('The property name as the person said it, or null. Example: "Andheri".'),
        urgent: bool('true only if the person said urgent or emergency.'),
        attachment: nullableStr('The handle of the photo to attach (from open_files), or null. Example: "A1".'),
    }),
    args: createArgs,
    payload: createPayload,
    examples: ['AC is leaking in cabin 4', 'washroom ki light kharab hai, ticket bana do', 'raise a ticket: lift not working, urgent'],
    ability: { en: 'raise a ticket', hi: 'टिकट बनाना', hinglish: 'ticket raise karna' },
    allowed: actor => actor.propertyIds.length > 0,
    async prepare(ctx, a) {
        let attachmentId: string | null = null;
        const wantsPhoto = !!a.attachment || a.description_source === 'photo';
        if (wantsPhoto) {
            const pick = pickAttachment(ctx, a.attachment, ['image']);
            if (!pick.ok) return { ok: false, problem: pick.problem };
            attachmentId = pick.attachment.id;
        }
        const fromPhoto = a.description_source === 'photo';
        // Grounding (guardrail G4): the description is the person's words, or, declared as such, what their photo shows.
        const description = fromPhoto ? (a.description && a.description.length >= 3 ? a.description.slice(0, 200) : null) : grounded(a.description ?? null, ctx.userWords);
        if (!description) return { ok: false, problem: a.description && !fromPhoto
            ? 'The description must be the person\'s own words. Call ask_user: "What is the problem? Please describe it in a line."'
            : 'MISSING description. Call ask_user: "What is the problem? Please describe it in a line."' };
        const prop = pickProperty(ctx, a.property);
        if (!prop.ok) return prop;
        const location = a.location ? grounded(a.location, ctx.userWords) : null;
        const propertyName = ctx.actor.propertyNames[prop.propertyId];
        const card = `${bt('ticket_card', ctx.lang, {
            property: propertyName, location: location ? `, ${location}` : '',
            description: description + (a.urgent && !ctx.actor.ownRecordsOnly ? ' (urgent)' : ''),
            source: fromPhoto ? bt('from_photo', ctx.lang) : '', photo: attachmentId ? bt('photo_line', ctx.lang) : '',
        })}\n${bt('confirm_tail', ctx.lang)}`;
        return {
            ok: true, card,
            payload: { propertyId: prop.propertyId, description, location, urgent: a.urgent, attachmentId, fromPhoto },
            auditFields: { property_id: prop.propertyId, description, location, urgent: a.urgent, has_photo: !!attachmentId, title_source: fromPhoto ? 'photo' : 'person' },
        };
    },
    async execute(ctx, p, opId) {
        if (!ctx.actor.propertyIds.includes(p.propertyId)) return { ok: false, reply: bt('access_changed', ctx.lang) };
        const photo = p.attachmentId ? await ctx.data.loadAttachment(p.attachmentId) : null;
        const description = p.location ? `${p.description} (Location: ${p.location})` : p.description;
        // Only staff may mark a ticket urgent; for clients and vendors the classifier decides the priority.
        const priority = p.urgent && !ctx.actor.ownRecordsOnly ? 'high' : undefined;
        const created = await ctx.data.createTicket({ opId, propertyId: p.propertyId, description, title: p.description.slice(0, 100), priority, photo });
        const property = ctx.actor.propertyNames[p.propertyId] ?? '';
        return {
            ok: true,
            reply: bt('ticket_done', ctx.lang, {
                number: created.ticketNumber, property, status: created.status,
                assignee: created.assigneeName ? (ctx.lang === 'en' ? `, assigned to ${created.assigneeName}` : `, ${created.assigneeName}`) : '',
                photo: p.attachmentId ? bt(created.photoAttached ? 'photo_attached' : photo ? 'photo_failed' : 'photo_expired', ctx.lang) : '',
            }),
            resultRef: created.ticketNumber,
            episode: `Raised ticket ${created.ticketNumber} ${quote(p.description, 60)} at ${property}${p.location ? `, ${clip(p.location, 40)}` : ''}`,
            // A photo that could not be stored stays open, so it can be added with "add the photo to that ticket".
            usedAttachments: created.photoAttached && p.attachmentId ? [p.attachmentId] : [],
        };
    },
};

// ── ticket.add_photo ───────────────────────────────────────────────────────────────────────────────────────────────

const addPhotoArgs = z.object({ ticket: z.string().trim().min(1).max(40), attachment: z.string().trim().max(10).nullish() }).strip();
const addPhotoPayload = z.object({ ticketNumber: z.string().min(1).max(40), attachmentId: z.string().uuid() }).strict();

export const ticketAddPhotoSkill: WriteSkill<z.infer<typeof addPhotoArgs>, z.infer<typeof addPhotoPayload>> = {
    id: 'ticket.add_photo', module: 'tickets', kind: 'write', risk: 1, defaultMode: 'shadow',
    description: 'Propose adding a photo the person sent to one of their EXISTING tickets. Shows a confirmation card; the person must say Yes. Use when they send a photo for a ticket that already exists ("here is the photo for my AC ticket"). Do NOT use for a new problem (use ticket_create with the attachment).',
    input: schema({
        ticket: str('A ticket handle from tickets_list, or the ticket number the person typed. Example: "T1".'),
        attachment: nullableStr('The handle of the photo (from open_files), or null when there is only one. Example: "A1".'),
    }),
    args: addPhotoArgs,
    payload: addPhotoPayload,
    examples: ['add this photo to TKT-1042', 'yeh photo meri AC wali ticket mein laga do', 'here is the picture for that ticket'],
    ability: { en: 'add a photo to a ticket', hi: 'टिकट में फ़ोटो जोड़ना', hinglish: 'ticket mein photo add karna' },
    allowed: actor => actor.propertyIds.length > 0 && actor.recordRule !== 'assigned_to_me',
    async prepare(ctx, a) {
        const pick = pickAttachment(ctx, a.attachment, ['image']);
        if (!pick.ok) return { ok: false, problem: pick.problem };
        const d = await findTicket(ctx, a.ticket);
        if (!d) return { ok: false, problem: `No ticket "${clip(a.ticket, 30)}" is visible to this person. Call tickets_list (raised_by_me true, status "all") and use a handle from it.` };
        if (d.hasPhoto) return { ok: false, problem: `Ticket ${d.ticketNumber} already has a photo. Tell the person more photos can be added in the app.` };
        return {
            ok: true, payload: { ticketNumber: d.ticketNumber, attachmentId: pick.attachment.id },
            card: `${bt('add_photo_card', ctx.lang, { number: d.ticketNumber, title: clip(d.title.replace(/\s+/g, ' '), 50) })}\n${bt('confirm_tail', ctx.lang)}`,
            auditFields: { has_photo: true },
        };
    },
    async execute(ctx, p) {
        const { actor } = ctx;
        // Looked up again under the person's CURRENT scope: the stored number is only a reference.
        const d = await ctx.data.ticketDetail({ orgId: actor.orgId, propertyIds: actor.propertyIds, recordRule: actor.recordRule, userId: actor.userId, ticketNumber: p.ticketNumber });
        if (!d) return { ok: false, reply: bt('access_changed', ctx.lang) };
        // Checked again now: a photo may have been added in the app since the card was shown.
        if (d.hasPhoto) return { ok: false, reply: bt('already_has_photo', ctx.lang, { number: d.ticketNumber }) };
        const photo = await ctx.data.loadAttachment(p.attachmentId);
        if (!photo) return { ok: false, reply: bt('photo_expired', ctx.lang).trim() };
        await ctx.data.addTicketPhoto({ ticketId: d.id, photo });
        return { ok: true, reply: bt('add_photo_done', ctx.lang, { number: d.ticketNumber }), resultRef: d.ticketNumber, episode: `Added a photo to ticket ${d.ticketNumber}`, usedAttachments: [p.attachmentId] };
    },
};

export const TICKET_SKILLS = [ticketsListSkill, ticketStatusSkill, ticketsCountSkill, ticketCreateSkill, ticketAddPhotoSkill] as const;
