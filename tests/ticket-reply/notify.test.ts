import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

// The Supabase client is created at import time; nothing below reaches a network, `from` is replaced in every test.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-only';

type Processor = typeof import('../../backend/services/WhatsAppEventProcessor').WhatsAppEventProcessor;
type Options = Parameters<Processor['dispatch']>[0];
type Remember = typeof import('../../backend/lib/whatsapp/ticketReply').rememberTicketReplyMessage;

let WhatsAppEventProcessor: Processor;
let rememberTicketReplyMessage: Remember;
let admin: { from: unknown };
let realFrom: unknown;
let realDispatch: Processor['dispatch'];
const realProject = process.env.AISENSY_PROJECT_ID;

before(async () => {
    ({ WhatsAppEventProcessor } = await import('../../backend/services/WhatsAppEventProcessor'));
    ({ rememberTicketReplyMessage } = await import('../../backend/lib/whatsapp/ticketReply'));
    admin = (await import('../../backend/lib/supabase/admin')).supabaseAdmin as unknown as { from: unknown };
    realFrom = admin.from;
    realDispatch = WhatsAppEventProcessor.dispatch;
});

const payload = {
    comment_id: 'comment-1', ticket_id: 'ticket-1', ticket_number: 'TICK-1042', title: 'Company emails creation',
    property_id: 'property-1', organization_id: 'org-1', sender_id: 'rahul', recipient_id: 'lohit', recipient_role: 'requester',
    message: 'I need the email approval\n\nattachment first.',
};

let sent: Options[];
beforeEach(() => {
    sent = [];
    WhatsAppEventProcessor.dispatch = async options => { sent.push(options); };
    admin.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Rahul Verma' } }) }) }) });
});
afterEach(() => {
    WhatsAppEventProcessor.dispatch = realDispatch;
    admin.from = realFrom;
    process.env.AISENSY_PROJECT_ID = realProject;
});

describe('the TICKET_REPLY event', () => {
    it('sends the assignee reply to the raiser only, keyed by the comment', async () => {
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(sent.length, 1);
        const [options] = sent;
        assert.equal(options.featureKey, 'ticket_reply');
        assert.equal(options.entityId, 'comment-1');
        assert.equal(options.durableBatch, true);
        assert.deepEqual(options.contextualUserIds, { requesterId: 'lohit' });
        assert.deepEqual(options.excludeUserIds, ['rahul']);
        assert.equal(options.paramValues.replied_by, 'Rahul Verma');
        assert.equal(options.paramValues.ticket_number, 'TICK-1042');
    });

    it('sends the raiser reply to the assignee only', async () => {
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload: { ...payload, sender_id: 'lohit', recipient_id: 'rahul', recipient_role: 'assignee' } });
        assert.deepEqual(sent[0].contextualUserIds, { assigneeId: 'rahul' });
        assert.deepEqual(sent[0].excludeUserIds, ['lohit']);
    });

    it('removes line breaks, which Meta rejects inside a template value', async () => {
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(sent[0].paramValues.reply_text, 'I need the email approval attachment first.');
    });

    it('cuts a long reply to 300 characters', async () => {
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload: { ...payload, message: 'a'.repeat(900) } });
        assert.equal(sent[0].paramValues.reply_text.length, 300);
        assert.ok(sent[0].paramValues.reply_text.endsWith('...'));
    });

    it('sends nothing for an incomplete event', async () => {
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload: { ...payload, comment_id: null } });
        assert.equal(sent.length, 0);
    });
});

describe('the real path from event to queue', () => {
    /** Only the database is fake: the processor, resolver and queue service below are the real ones. */
    function database(configError: { code: string; message: string } | null) {
        const queued: Record<string, unknown>[] = [];
        admin.from = (table: string) => {
            const result = () => {
                if (table === 'system_config') return { data: null, error: configError };
                if (table === 'organization_settings') return { data: { notification_matrix: {}, whatsapp_service_config: {}, whatsapp_templates: {} }, error: null };
                if (table === 'users') return { data: [{ id: 'lohit', phone: '9876543210', full_name: 'Lohit' }], error: null };
                return { data: [], error: null };
            };
            const query = {
                select: () => query, eq: () => query, in: () => query, gte: () => query,
                insert: (rows: Record<string, unknown>[]) => { queued.push(...rows); return query; },
                maybeSingle: async () => ({ data: table === 'users' ? { full_name: 'Rahul Verma' } : result().data, error: null }),
                then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
            };
            return query;
        };
        return queued;
    }

    it('queues the message when the system_config table does not exist (live 2026-11-04)', async () => {
        WhatsAppEventProcessor.dispatch = realDispatch;
        const queued = database({ code: 'PGRST205', message: "Could not find the table 'public.system_config' in the schema cache" });
        await WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(queued.length, 1);
        assert.equal(queued[0].user_id, 'lohit');
        assert.equal(queued[0].entity_id, 'comment-1');
        assert.equal(queued[0].event_type, 'TICKET_REPLY');
        assert.equal(queued[0].template_name, 'ticket_reply_v1');
        assert.deepEqual(queued[0].template_params, ['Lohit', 'Rahul Verma', 'TICK-1042', 'Company emails creation', 'I need the email approval attachment first.']);
    });

    it('still stops on a real read failure, so a switch that is set cannot be skipped', async () => {
        WhatsAppEventProcessor.dispatch = realDispatch;
        const queued = database({ code: '08006', message: 'connection failure' });
        await assert.rejects(WhatsAppEventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload }));
        assert.equal(queued.length, 0);
    });
});

describe('saving the sent message id for swipe-reply', () => {
    function capture() {
        const saved: { table: string; rows: Record<string, unknown>[] }[] = [];
        admin.from = (table: string) => ({ upsert: async (rows: Record<string, unknown>[]) => { saved.push({ table, rows }); return { error: null }; } });
        return saved;
    }

    it('links every provider id to the comment, for 30 days, in the phone format the webhook uses', async () => {
        const saved = capture();
        process.env.AISENSY_PROJECT_ID = 'project-1';
        await rememberTicketReplyMessage({ event_type: 'TICKET_REPLY', phone: '98765 43210', entity_id: 'comment-1' }, ['wamid.a', 'submitted.b']);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].table, 'whatsapp_outgoing_context');
        assert.deepEqual(saved[0].rows.map(row => row.message_alias), ['wamid.a', 'submitted.b']);
        const [row] = saved[0].rows;
        assert.equal(row.phone, '919876543210');
        assert.equal(row.workflow, 'ticket_reply');
        assert.equal(row.conversation_id, 'comment-1');
        const days = (Date.parse(String(row.expires_at)) - Date.now()) / 86_400_000;
        assert.ok(days > 29.9 && days <= 30);
    });

    it('does nothing for any other kind of message', async () => {
        const saved = capture();
        process.env.AISENSY_PROJECT_ID = 'project-1';
        await rememberTicketReplyMessage({ event_type: 'TICKET_COMPLETED', phone: '9876543210', entity_id: 'ticket-1' }, ['wamid.a']);
        assert.equal(saved.length, 0);
    });

    it('stays quiet when the provider returns no id', async () => {
        const saved = capture();
        process.env.AISENSY_PROJECT_ID = 'project-1';
        await rememberTicketReplyMessage({ event_type: 'TICKET_REPLY', phone: '9876543210', entity_id: 'comment-1' }, []);
        assert.equal(saved.length, 0);
    });

    it('a failed save never turns a sent message into a failure', async () => {
        process.env.AISENSY_PROJECT_ID = 'project-1';
        admin.from = () => ({ upsert: async () => ({ error: new Error('check constraint') }) });
        await rememberTicketReplyMessage({ event_type: 'TICKET_REPLY', phone: '9876543210', entity_id: 'comment-1' }, ['wamid.a']);
    });
});
