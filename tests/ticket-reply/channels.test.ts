import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

// The Supabase client is created at import time; nothing below reaches a network, `from` is replaced in every test.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-only';
process.env.SMTP_USER ||= 'test-only@example.com';

type Processor = typeof import('../../backend/services/EventProcessor').EventProcessor;
type Emails = typeof import('../../backend/services/EmailService').EmailService;
type Notifications = typeof import('../../backend/services/NotificationService').NotificationService;

let EventProcessor: Processor;
let EmailService: Emails;
let NotificationService: Notifications;
let admin: { from: unknown };
let realFrom: unknown;
let realEmail: Emails['sendGenericNotificationEmail'];
let realSendToMany: Notifications['sendToMany'];

const payload = {
    comment_id: 'comment-1', ticket_id: 'ticket-1', ticket_number: 'TICK-1042', title: 'Company emails creation',
    property_id: 'property-1', organization_id: 'org-1',
    sender_id: 'rahul', requester_id: 'lohit', assignee_id: 'rahul',
    message: 'The approval is in, closing this today.',
};

const ruleFor = (key: string, over: Record<string, unknown> = {}) => ({
    tickets: {
        [key]: {
            enabled: true,
            channels: { email: true, whatsapp: true, push: true },
            roles: [], user_ids: [], notify_requester: true, notify_assignee: true,
            ...over
        }
    }
});

const rule = (over: Record<string, unknown> = {}) => ruleFor('ticket_reply', over);

let mailed: { to: string; subject: string; html: string }[];
let pushed: { ids: string[]; type: string; message: string }[];

const TICKET_ROW = {
    id: 'ticket-1', ticket_number: 'TICK-1042', title: payload.title, property_id: 'property-1',
    organization_id: 'org-1', raised_by: 'lohit', assigned_to: 'rahul',
};

/** Only the database is fake: the processor and the recipient resolver below are the real ones. */
function database(matrix: Record<string, unknown>, memberships: Record<string, unknown>[] = [], ticketRow: Record<string, unknown> = TICKET_ROW) {
    admin.from = (table: string) => {
        const result = () => {
            if (table === 'users') return { data: [
                { id: 'lohit', full_name: 'Lohit', email: 'lohit@example.com' },
                { id: 'rahul', full_name: 'Rahul Verma', email: 'rahul@example.com' },
            ], error: null };
            if (table === 'property_memberships' || table === 'organization_memberships') return { data: memberships, error: null };
            return { data: [], error: null };
        };
        const query: any = {
            select: () => query, eq: () => query, in: () => query, gte: () => query, like: () => query,
            maybeSingle: async () => {
                if (table === 'organization_settings') return { data: { notification_matrix: matrix, email_service_config: {}, email_preferences: {} }, error: null };
                if (table === 'tickets') return { data: ticketRow, error: null };
                if (table === 'users') return { data: { id: 'rahul', full_name: 'Rahul Verma', email: 'rahul@example.com' }, error: null };
                return { data: null, error: null };
            },
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return query;
    };
}

before(async () => {
    ({ EventProcessor } = await import('../../backend/services/EventProcessor'));
    ({ EmailService } = await import('../../backend/services/EmailService'));
    ({ NotificationService } = await import('../../backend/services/NotificationService'));
    admin = (await import('../../backend/lib/supabase/admin')).supabaseAdmin as unknown as { from: unknown };
    realFrom = admin.from;
    realEmail = EmailService.sendGenericNotificationEmail;
    realSendToMany = NotificationService.sendToMany;
});

beforeEach(() => {
    mailed = [];
    pushed = [];
    EmailService.sendGenericNotificationEmail = (async ({ emailTo, subject, htmlBody }: any) => {
        mailed.push({ to: emailTo, subject, html: htmlBody });
        return true;
    }) as Emails['sendGenericNotificationEmail'];
    NotificationService.sendToMany = (async (userIds: string[], notification: any) => {
        pushed.push({ ids: [...userIds].sort(), type: notification.type, message: notification.message });
    }) as Notifications['sendToMany'];
});

afterEach(() => {
    admin.from = realFrom;
    EmailService.sendGenericNotificationEmail = realEmail;
    NotificationService.sendToMany = realSendToMany;
});

describe('email and in-app notifications for a ticket reply', () => {
    it('reaches the other side of the conversation and never the person who wrote it', async () => {
        database(rule());
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });

        assert.deepEqual(mailed.map(m => m.to), ['lohit@example.com']);
        assert.match(mailed[0].subject, /TICK-1042/);
        assert.match(mailed[0].html, /Rahul Verma/);
        assert.match(mailed[0].html, /closing this today/);

        assert.equal(pushed.length, 1);
        assert.deepEqual(pushed[0].ids, ['lohit']);
        assert.equal(pushed[0].type, 'TICKET_REPLY');
        assert.match(pushed[0].message, /Rahul Verma/);
    });

    it('sends nothing on a channel that is switched off', async () => {
        database(rule({ channels: { email: false, whatsapp: true, push: false } }));
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(mailed.length, 0);
        assert.equal(pushed.length, 0);
    });

    it('sends nothing at all when the event is switched off', async () => {
        database(rule({ enabled: false }));
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(mailed.length, 0);
        assert.equal(pushed.length, 0);
    });

    it('also notifies the roles chosen in the Omnichannel rule', async () => {
        database(rule({ roles: ['property_admin'] }), [{ user_id: 'admin-9' }]);
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.deepEqual(pushed[0].ids, ['admin-9', 'lohit']);
    });

    it('leaves the requester out when notify_requester is off', async () => {
        database(rule({ notify_requester: false }));
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload });
        assert.equal(pushed.length, 0);
        assert.equal(mailed.length, 0);
    });

    it('ignores an event with no comment', async () => {
        database(rule());
        await EventProcessor.processEvent({ event_type: 'TICKET_REPLY', payload: { ...payload, comment_id: null } });
        assert.equal(mailed.length, 0);
        assert.equal(pushed.length, 0);
    });
});

describe('the ticket events that used to notify from inside the API routes', () => {
    const created = {
        ticket_id: 'ticket-1', ticket_number: 'TICK-1042', title: 'Company emails creation',
        property_id: 'property-1', organization_id: 'org-1', raised_by: 'lohit', assigned_to: null,
        status: 'open', priority: 'medium',
    };

    const unassigned = { ...TICKET_ROW, assigned_to: null };

    it('a new ticket reaches the roles on the ticket_created rule and the requester', async () => {
        database(ruleFor('ticket_created', { roles: ['property_admin'] }), [{ user_id: 'admin-9' }], unassigned);
        await EventProcessor.processEvent({ event_type: 'TICKET_CREATED', payload: created });
        assert.equal(pushed.length, 1);
        assert.deepEqual(pushed[0].ids, ['admin-9', 'lohit']);
        assert.equal(pushed[0].type, 'TICKET_CREATED');
    });

    it('a new ticket pushes to nobody when the rule has push switched off', async () => {
        database(ruleFor('ticket_created', { roles: ['property_admin'], channels: { email: false, whatsapp: true, push: false } }), [{ user_id: 'admin-9' }], unassigned);
        await EventProcessor.processEvent({ event_type: 'TICKET_CREATED', payload: created });
        assert.equal(pushed.length, 0);
    });

    it('the waitlist runs on its own rule', async () => {
        database(ruleFor('ticket_waitlisted'));
        await EventProcessor.processEvent({ event_type: 'TICKET_UPDATED', payload: { ...created, status: 'waitlist', old_status: 'open' } });
        assert.equal(pushed.length, 1);
        assert.equal(pushed[0].type, 'TICKET_WAITLISTED');
        assert.deepEqual(pushed[0].ids, ['lohit', 'rahul']);
    });

    it('a client approving the work runs on the ticket_validated rule', async () => {
        database(ruleFor('ticket_validated'));
        await EventProcessor.processEvent({
            event_type: 'TICKET_UPDATED',
            payload: { ...created, status: 'resolved', old_status: 'pending_validation', validation_status: 'approved', old_validation_status: null }
        });
        const validated = pushed.filter(p => p.type === 'TICKET_VALIDATED');
        assert.equal(validated.length, 1);
        assert.match(validated[0].message, /approved and marked as resolved/);
    });

    it('escalating an existing ticket to critical now fires, because old_priority is in the payload', async () => {
        database(ruleFor('critical_ticket_created'));
        await EventProcessor.processEvent({
            event_type: 'TICKET_UPDATED',
            payload: { ...created, status: 'open', old_status: 'open', priority: 'critical', old_priority: 'medium' }
        });
        assert.equal(pushed.filter(p => p.type === 'TICKET_CRITICAL').length, 1);
    });
});
