import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

const MOCK_IDS = new Set([
    '@/backend/lib/supabase/admin',
    '@/backend/services/WhatsAppQueueService',
    '@/backend/services/EmailService',
    '@/backend/services/PettyCashNotificationService',
    '@/backend/lib/procurement/requisition-approval.mjs',
    '@/backend/services/AiSensyService',
    '@/backend/services/WhatsAppService',
]);

globalThis.__ticketAlertTestState = {
    supabaseAdmin: null,
    enqueued: [],
    emailsSent: [],
    aisensyCalls: [],
};

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (MOCK_IDS.has(specifier)) {
            return { shortCircuit: true, url: `mock-ticket-alert:///${encodeURIComponent(specifier)}` };
        }
        if (specifier.startsWith('@/')) {
            const base = resolve(root, specifier.slice(2));
            const target = extname(base) ? base : existsSync(base + '.ts') ? base + '.ts' : base + '.tsx';
            return { shortCircuit: true, url: pathToFileURL(target).href };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith('mock-ticket-alert:///')) {
            const specifier = decodeURIComponent(url.slice('mock-ticket-alert:///'.length));
            if (specifier === '@/backend/lib/supabase/admin') {
                return {
                    shortCircuit: true,
                    format: 'module',
                    source: `export const supabaseAdmin = new Proxy({}, { get: (_, prop) => Reflect.get(globalThis.__ticketAlertTestState.supabaseAdmin, prop) });`,
                };
            }
            if (specifier === '@/backend/services/WhatsAppQueueService') {
                return {
                    shortCircuit: true,
                    format: 'module',
                    source: `export const WhatsAppQueueService = { enqueue: (payload) => globalThis.__ticketAlertTestState.enqueueFn(payload) };`,
                };
            }
            if (specifier === '@/backend/services/EmailService') {
                return {
                    shortCircuit: true,
                    format: 'module',
                    source: `export const EmailService = { sendTicketCreatedEmail: (payload) => globalThis.__ticketAlertTestState.emailFn(payload), sendTicketAssignedEmail: async () => true };`,
                };
            }
            if (specifier === '@/backend/services/PettyCashNotificationService') {
                return { shortCircuit: true, format: 'module', source: `export const PettyCashNotificationService = {};` };
            }
            if (specifier === '@/backend/lib/procurement/requisition-approval.mjs') {
                return {
                    shortCircuit: true,
                    format: 'module',
                    source: `export const usesBulkApprovalSummary = () => false; export const siteVendorQuotation = {}; export const requisitionNotes = {}; export const batchWhatsAppOptions = {}; export const reapprovalWhatsAppOptions = {};`,
                };
            }
            if (specifier === '@/backend/services/AiSensyService') {
                return { shortCircuit: true, format: 'module', source: `export const AiSensyService = {};` };
            }
            if (specifier === '@/backend/services/WhatsAppService') {
                return { shortCircuit: true, format: 'module', source: `export const WhatsAppService = {};` };
            }
        }
        return nextLoad(url, context);
    },
});

const alerts = await import(pathToFileURL(resolve(root, 'backend/lib/ticketing/alertClassification.ts')).href);
const { WhatsAppEventProcessor } = await import(pathToFileURL(resolve(root, 'backend/services/WhatsAppEventProcessor.ts')).href);
const { EventProcessor } = await import(pathToFileURL(resolve(root, 'backend/services/EventProcessor.ts')).href);
const { WhatsAppQueueService } = await import(pathToFileURL(resolve(root, 'backend/services/WhatsAppQueueService.ts')).href);

function createMockSupabase(fixtures) {
    function applyFilters(rows, filters) {
        return rows.filter(row =>
            filters.every(f => {
                if (f.type === 'eq') return row[f.col] === f.val;
                if (f.type === 'in') return f.vals.includes(row[f.col]);
                if (f.type === 'not_null') return row[f.col] !== null && row[f.col] !== undefined;
                if (f.type === 'gte') return String(row[f.col] || '') >= String(f.val);
                return true;
            })
        );
    }

    function queryFor(table) {
        const filters = [];
        const builder = {
            select() { return builder; },
            eq(col, val) { filters.push({ type: 'eq', col, val }); return builder; },
            in(col, vals) { filters.push({ type: 'in', col, vals }); return builder; },
            not(col, op, val) {
                if (op === 'is' && val === null) filters.push({ type: 'not_null', col });
                return builder;
            },
            gte(col, val) { filters.push({ type: 'gte', col, val }); return builder; },
            insert(payload) {
                const items = Array.isArray(payload) ? payload : [payload];
                fixtures[table] = fixtures[table] || [];
                fixtures[table].push(...items);
                return Promise.resolve({ data: items, error: null });
            },
            update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
            maybeSingle() {
                const rows = applyFilters(fixtures[table] || [], filters);
                return Promise.resolve({ data: rows[0] || null, error: null });
            },
            single() {
                const rows = applyFilters(fixtures[table] || [], filters);
                return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } });
            },
            then(resolveFn, rejectFn) {
                const rows = applyFilters(fixtures[table] || [], filters);
                return Promise.resolve({ data: rows, error: null }).then(resolveFn, rejectFn);
            },
        };
        return builder;
    }

    return {
        from(table) {
            return queryFor(table);
        },
        auth: {
            admin: {
                getUserById: async () => ({ data: { user: null }, error: null }),
            },
        },
    };
}

function buildFixtures({ notificationMatrix, ticket, propertyMemberships, orgMemberships = [], users }) {
    return {
        organization_settings: [
            {
                organization_id: 'org-1',
                notification_matrix: notificationMatrix,
                whatsapp_service_config: {},
                whatsapp_templates: {},
            },
        ],
        tickets: [
            {
                ...ticket,
                property: { id: 'prop-1', name: 'Mafatlal Towers', organization_id: 'org-1' },
                raised_by_user: users.find(u => u.id === ticket.raised_by) || null,
                assigned_to_user: users.find(u => u.id === ticket.assigned_to) || null,
            },
        ],
        properties: [{ id: 'prop-1', name: 'Mafatlal Towers', organization_id: 'org-1' }],
        property_memberships: propertyMemberships,
        organization_memberships: orgMemberships,
        users,
        employee_profiles: [],
        system_config: [],
        whatsapp_queue: [],
    };
}

function setupTestState(fixtures) {
    const supabaseAdmin = createMockSupabase(fixtures);
    const enqueued = [];
    const emailsSent = [];
    globalThis.__ticketAlertTestState.supabaseAdmin = supabaseAdmin;
    globalThis.__ticketAlertTestState.enqueueFn = async (payload) => {
        enqueued.push(payload);
    };
    globalThis.__ticketAlertTestState.emailFn = async (payload) => {
        emailsSent.push(payload);
        return true;
    };
    return { supabaseAdmin, enqueued, emailsSent };
}

const USERS = [
    { id: 'tenant-1', full_name: 'Client Raiser', phone: '9876543210', email: 'client@example.test', role: 'tenant' },
    { id: 'staff-1', full_name: 'Staff Raiser', phone: '9876543211', email: 'staff@example.test', role: 'staff' },
    { id: 'mgr-1', full_name: 'Client Ops Manager', phone: '+91 9876543212', email: 'mgr1@example.test', role: 'property_admin' },
    { id: 'mgr-2', full_name: 'Critical Escalation Lead', phone: '9876543213', email: 'mgr2@example.test', role: 'org_super_admin' },
    { id: 'mgr-3', full_name: 'Both Alert Lead', phone: '9876543214', email: 'mgr3@example.test', role: 'property_admin' },
];

test('alertClassification identifies client-raised, internal, and critical priority rules accurately', async () => {
    assert.equal(alerts.isCriticalPriority('critical'), true);
    assert.equal(alerts.isCriticalPriority('CRITICAL'), true);
    assert.equal(alerts.isCriticalPriority('high'), false);

    assert.equal(alerts.isTicketEscalatedToCritical('critical', 'medium'), true);
    assert.equal(alerts.isTicketEscalatedToCritical('critical', 'critical'), false);
    assert.equal(alerts.isTicketEscalatedToCritical('critical', undefined), false);

    assert.equal(alerts.normalizePhoneKey('+91 98765-43212'), '9876543212');

    const supabase = createMockSupabase({
        property_memberships: [
            { property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true },
            { property_id: 'prop-1', user_id: 'staff-1', role: 'staff', is_active: true },
        ],
        organization_memberships: [
            { organization_id: 'org-1', user_id: 'super-client-1', role: 'super_tenant', is_active: true },
        ],
        users: [],
    });

    assert.equal(await alerts.isTicketRaisedByClient({ supabase, raisedBy: 'tenant-1', propertyId: 'prop-1', organizationId: 'org-1' }), true);
    assert.equal(await alerts.isTicketRaisedByClient({ supabase, raisedBy: 'super-client-1', propertyId: 'prop-1', organizationId: 'org-1' }), true);
    assert.equal(await alerts.isTicketRaisedByClient({ supabase, raisedBy: 'staff-1', propertyId: 'prop-1', organizationId: 'org-1' }), false);
    assert.equal(await alerts.isTicketRaisedByClient({ supabase, raisedBy: 'tenant-1', propertyId: 'prop-1', organizationId: 'org-1', isInternal: true }), false);
});

test('client-raised ticket sends WhatsApp only to selected Omnichannel users and deduplicates against ticket_created', async () => {
    const fixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-3'],
                    notify_assignee: false,
                    notify_requester: false,
                },
                client_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-1', 'mgr-3'],
                    notify_assignee: false,
                    notify_requester: false,
                },
                critical_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-2'],
                    notify_assignee: false,
                    notify_requester: false,
                },
            },
        },
        ticket: {
            id: 'tkt-1',
            ticket_number: 'TKT-101',
            title: 'AC leak in reception',
            priority: 'high',
            property_id: 'prop-1',
            organization_id: 'org-1',
            raised_by: 'tenant-1',
            assigned_to: null,
            internal: false,
        },
        propertyMemberships: [
            { property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true },
        ],
        users: USERS,
    });

    const { enqueued } = setupTestState(fixtures);
    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-1', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'tenant-1', priority: 'high' },
    });

    assert.deepEqual(enqueued.map(e => ({ userIds: e.userIds, eventType: e.eventType, templateName: e.templateName })), [
        { userIds: ['mgr-3'], eventType: 'TICKET_CREATED', templateName: 'ticket_created_v3' },
        { userIds: ['mgr-1'], eventType: 'CLIENT_TICKET_CREATED', templateName: 'ticket_created_v3' },
    ]);
});

test('staff-raised critical ticket skips client_ticket_created and alerts critical_ticket_created selected users', async () => {
    const fixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: {
                    channels: { email: false, whatsapp: false, push: false },
                    roles: [],
                    user_ids: [],
                },
                client_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-1'],
                    notify_assignee: false,
                    notify_requester: false,
                },
                critical_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-2'],
                    notify_assignee: false,
                    notify_requester: false,
                },
            },
        },
        ticket: {
            id: 'tkt-2',
            ticket_number: 'TKT-102',
            title: 'Main electrical panel trip',
            priority: 'critical',
            property_id: 'prop-1',
            organization_id: 'org-1',
            raised_by: 'staff-1',
            assigned_to: null,
            internal: false,
        },
        propertyMemberships: [
            { property_id: 'prop-1', user_id: 'staff-1', role: 'staff', is_active: true },
        ],
        users: USERS,
    });

    const { enqueued } = setupTestState(fixtures);
    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-2', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'staff-1', priority: 'critical' },
    });

    assert.deepEqual(enqueued.map(e => ({ userIds: e.userIds, eventType: e.eventType })), [
        { userIds: ['mgr-2'], eventType: 'CRITICAL_TICKET_CREATED' },
    ]);
});

test('client-raised critical ticket deduplicates a user selected in both client and critical rules', async () => {
    const fixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: {
                    channels: { email: false, whatsapp: false, push: false },
                    roles: [],
                    user_ids: [],
                },
                client_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-1', 'mgr-3'],
                    notify_assignee: false,
                    notify_requester: false,
                },
                critical_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-2', 'mgr-3'],
                    notify_assignee: false,
                    notify_requester: false,
                },
            },
        },
        ticket: {
            id: 'tkt-3',
            ticket_number: 'TKT-103',
            title: 'Water flooding in server lobby',
            priority: 'critical',
            property_id: 'prop-1',
            organization_id: 'org-1',
            raised_by: 'tenant-1',
            assigned_to: null,
            internal: false,
        },
        propertyMemberships: [
            { property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true },
        ],
        users: USERS,
    });

    const { enqueued } = setupTestState(fixtures);
    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-3', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'tenant-1', priority: 'critical' },
    });

    assert.deepEqual(enqueued.map(e => ({ userIds: e.userIds, eventType: e.eventType })), [
        { userIds: ['mgr-1'], eventType: 'CLIENT_TICKET_CREATED' },
        { userIds: ['mgr-3'], eventType: 'CLIENT_TICKET_CREATED' },
        { userIds: ['mgr-2'], eventType: 'CRITICAL_TICKET_CREATED' },
    ]);
});

test('ticket priority escalation to critical fires critical_ticket_created only when priority newly becomes critical', async () => {
    const fixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                critical_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-2'],
                    notify_assignee: false,
                    notify_requester: false,
                },
            },
        },
        ticket: {
            id: 'tkt-4',
            ticket_number: 'TKT-104',
            title: 'Lift trapped passenger',
            priority: 'critical',
            property_id: 'prop-1',
            organization_id: 'org-1',
            raised_by: 'staff-1',
            assigned_to: null,
        },
        propertyMemberships: [],
        users: USERS,
    });

    const { enqueued } = setupTestState(fixtures);

    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_UPDATED',
        payload: { ticket_id: 'tkt-4', property_id: 'prop-1', organization_id: 'org-1', status: 'in_progress', old_status: 'open', priority: 'critical' },
    });
    assert.equal(enqueued.length, 0);

    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_UPDATED',
        payload: { ticket_id: 'tkt-4', property_id: 'prop-1', organization_id: 'org-1', priority: 'critical', old_priority: 'medium' },
    });
    assert.deepEqual(enqueued.map(e => ({ userIds: e.userIds, eventType: e.eventType })), [
        { userIds: ['mgr-2'], eventType: 'CRITICAL_TICKET_CREATED' },
    ]);
});

test('WhatsAppQueueService maps CLIENT_TICKET_CREATED and CRITICAL_TICKET_CREATED to ticketing module toggle', async () => {
    const fixtures = {
        system_config: [
            { key: 'whatsapp_notifications_enabled', value: true },
            { key: 'whatsapp_ticketing_enabled', value: false },
        ],
        users: USERS,
        whatsapp_queue: [],
    };
    const { supabaseAdmin } = setupTestState(fixtures);

    await WhatsAppQueueService.enqueue({
        userIds: ['mgr-1'],
        message: 'Test client ticket',
        eventType: 'CLIENT_TICKET_CREATED',
        organizationId: 'org-1',
    });
    await WhatsAppQueueService.enqueue({
        userIds: ['mgr-2'],
        message: 'Test critical ticket',
        eventType: 'CRITICAL_TICKET_CREATED',
        organizationId: 'org-1',
    });

    assert.equal(fixtures.whatsapp_queue.length, 0);
});

test('property_overrides, roles, and photo media routing work for client_ticket_created and critical_ticket_created', async () => {
    const fixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: {
                    channels: { email: false, whatsapp: false, push: false },
                    roles: [],
                    user_ids: [],
                },
                client_ticket_created: {
                    channels: { email: false, whatsapp: true, push: false },
                    roles: [],
                    user_ids: ['mgr-1'],
                    notify_assignee: false,
                    notify_requester: false,
                    property_overrides: {
                        'prop-1': {
                            channels: { email: false, whatsapp: true, push: false },
                            roles: ['org_super_admin'],
                            user_ids: [],
                            notify_assignee: false,
                            notify_requester: false,
                        },
                    },
                },
            },
        },
        ticket: {
            id: 'tkt-5',
            ticket_number: 'TKT-105',
            title: 'Broken glass door',
            priority: 'high',
            property_id: 'prop-1',
            organization_id: 'org-1',
            raised_by: 'tenant-1',
            assigned_to: null,
            photo_before_url: 'https://cdn.example.test/door.jpg',
            internal: false,
        },
        propertyMemberships: [
            { property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true },
        ],
        orgMemberships: [
            { organization_id: 'org-1', user_id: 'mgr-2', role: 'org_super_admin', is_active: true },
        ],
        users: USERS,
    });

    const { enqueued } = setupTestState(fixtures);
    await WhatsAppEventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-5', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'tenant-1', priority: 'high' },
    });

    assert.deepEqual(enqueued.map(e => ({
        userIds: e.userIds,
        eventType: e.eventType,
        templateName: e.templateName,
        mediaUrl: e.mediaUrl,
    })), [
        {
            userIds: ['mgr-2'],
            eventType: 'CLIENT_TICKET_CREATED',
            templateName: 'ticket_created_v3_media',
            mediaUrl: 'https://cdn.example.test/door.jpg',
        },
    ]);
});

test('EventProcessor stays silent on email by default and emails selected users when email channel is enabled', async () => {
    const baseTicket = {
        id: 'tkt-6',
        ticket_number: 'TKT-106',
        title: 'Generator failure',
        priority: 'critical',
        property_id: 'prop-1',
        organization_id: 'org-1',
        raised_by: 'tenant-1',
        assigned_to: null,
        internal: false,
    };

    const disabledFixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: { channels: { email: false, whatsapp: true, push: false }, roles: [], user_ids: [] },
                client_ticket_created: { channels: { email: false, whatsapp: true, push: false }, roles: [], user_ids: ['mgr-1'] },
                critical_ticket_created: { channels: { email: false, whatsapp: true, push: false }, roles: [], user_ids: ['mgr-2'] },
            },
        },
        ticket: baseTicket,
        propertyMemberships: [{ property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true }],
        users: USERS,
    });

    const { emailsSent: disabledEmails } = setupTestState(disabledFixtures);
    await EventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-6', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'tenant-1', priority: 'critical' },
    });
    assert.equal(disabledEmails.length, 0);

    const enabledFixtures = buildFixtures({
        notificationMatrix: {
            tickets: {
                ticket_created: { channels: { email: false, whatsapp: true, push: false }, roles: [], user_ids: [] },
                client_ticket_created: { channels: { email: true, whatsapp: true, push: false }, roles: [], user_ids: ['mgr-1', 'mgr-3'], notify_assignee: false, notify_requester: false },
                critical_ticket_created: { channels: { email: true, whatsapp: true, push: false }, roles: [], user_ids: ['mgr-2', 'mgr-3'], notify_assignee: false, notify_requester: false },
            },
        },
        ticket: baseTicket,
        propertyMemberships: [{ property_id: 'prop-1', user_id: 'tenant-1', role: 'tenant', is_active: true }],
        users: USERS,
    });

    const { emailsSent } = setupTestState(enabledFixtures);
    await EventProcessor.processEvent({
        event_type: 'TICKET_CREATED',
        payload: { ticket_id: 'tkt-6', property_id: 'prop-1', organization_id: 'org-1', raised_by: 'tenant-1', priority: 'critical' },
    });

    assert.deepEqual(emailsSent.map(e => e.emailTo), [
        ['mgr1@example.test', 'mgr3@example.test'],
        ['mgr2@example.test'],
    ]);
});

