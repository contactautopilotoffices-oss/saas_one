import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Read tools for the main FMS areas: properties, people, PPM, electricity, procurement, finance,
 * invoices, AOP, tasks, vendors, visitors, AMC, documents, CRM reports, command centre.
 *
 * Every tool is a thin, typed front for routes already in the MCP catalogue, and goes through the
 * same guarded call as fetch_endpoint (catalogue check, membership fence, the route's own sign-in
 * and role checks). Related screens are grouped into one tool with a `view`, so the assistant has
 * a short, well-described list to choose from (doctrine L8 [BAA p.107]).
 * tests/mcp/mcp.test.ts checks that every path used here is in the catalogue.
 */

type Call = (tool: string, path: string, query: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const uuid = () => z.string().uuid();
const org = () => uuid().describe('Organisation id from whoami.');
const prop = () => uuid().describe('Property id from whoami.');
const ymd = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const ym = () => z.string().regex(/^\d{4}-\d{2}$/).describe('YYYY-MM');
const page = () => z.number().int().min(1).max(10000).optional();
const pageSize = () => z.number().int().min(1).max(200).optional();
const text = (max = 200) => z.string().max(max);

/** Every route a domain tool can call, for the catalogue test. {id} stands for a path id. */
export const DOMAIN_TOOL_PATHS = [
    '/api/properties', '/api/users/list', '/api/tickets/{id}/comments',
    '/api/ppm/schedules', '/api/ppm/reports',
    '/api/electricity/tracker', '/api/electricity/bills', '/api/electricity/pace', '/api/electricity/disputes', '/api/electricity/payment-runs',
    '/api/procurement/requisitions',
    '/api/accounts/pos', '/api/accounts/tracker', '/api/accounts/payments', '/api/accounts/summary', '/api/accounts/po/{id}',
    '/api/invoices/queue', '/api/invoices/po-status', '/api/invoices/summary',
    '/api/aop/summary', '/api/aop/warnings', '/api/aop/bounties',
    '/api/task-manager/tasks',
    '/api/properties/{id}/vendors', '/api/properties/{id}/vendor-summary', '/api/properties/{id}/vms-summary',
    '/api/amc/contracts', '/api/document-bank',
    '/api/crm/stats', '/api/crm/reports',
    '/api/command-center/kpis', '/api/command-center/portfolio', '/api/command-center/ticket-alerts', '/api/command-center/water',
    '/api/roster', '/api/meetings', '/api/meetings/{id}',
    '/api/org-efficiency/goals', '/api/org-efficiency/tasks', '/api/org-efficiency/meter', '/api/org-efficiency/agents', '/api/org-efficiency/measurements',
] as const;

export function registerDomainTools(server: McpServer, call: Call): void {
    server.registerTool('list_properties', {
        title: 'List properties',
        description:
            'Lists the properties (buildings, sites) of an organisation the user can see, with their ids, names and addresses. ' +
            'Use it to find a property id or answer "which sites do we have". whoami already lists the user\'s own properties; use this for full property details. ' +
            'Example: {"organization_id": "<id>"}.',
        inputSchema: { organization_id: org() },
        annotations: READ_ONLY,
    }, async ({ organization_id }) => call('list_properties', '/api/properties', { organizationId: organization_id }));

    server.registerTool('list_users', {
        title: 'List people',
        description:
            'Lists the people (staff, admins, tenants) in an organisation or one property, with roles. ' +
            'Use for "who is the property admin at X", "list MST staff at Y". Do not use for CRM leads (use list_crm_leads). ' +
            'Example: {"organization_id": "<id>", "property_id": "<id>"}.',
        inputSchema: { organization_id: org(), property_id: prop().optional() },
        annotations: READ_ONLY,
    }, async ({ organization_id, property_id }) => call('list_users', '/api/users/list', { orgId: organization_id, propertyId: property_id }));

    server.registerTool('ticket_comments', {
        title: 'Ticket comments',
        description:
            'Returns the comments and updates on one service ticket. Use after list_tickets when the user asks what happened on a ticket. ' +
            'Example: {"ticket_id": "<ticket id from list_tickets>"}.',
        inputSchema: { ticket_id: uuid().describe('Ticket id (the id field, not the ticket number).') },
        annotations: READ_ONLY,
    }, async ({ ticket_id }) => call('ticket_comments', `/api/tickets/${ticket_id}/comments`, {}));

    server.registerTool('ppm', {
        title: 'Preventive maintenance (PPM)',
        description:
            'Planned preventive maintenance. view "schedules": the PPM tasks planned for a month (needs month and year). ' +
            'view "report": compliance (done, pending, overdue) between two dates. ' +
            'Use for "which PPMs are overdue at X", "PPM compliance last month". ' +
            'Example: {"view": "schedules", "organization_id": "<id>", "property_id": "<id>", "month": 11, "year": 2026}.',
        inputSchema: {
            view: z.enum(['schedules', 'report']),
            organization_id: org(),
            property_id: prop().optional(),
            month: z.number().int().min(1).max(12).optional().describe('For schedules.'),
            year: z.number().int().min(2020).max(2100).optional().describe('For schedules.'),
            from_date: ymd().optional().describe('For report.'),
            to_date: ymd().optional().describe('For report.'),
        },
        annotations: READ_ONLY,
    }, async ({ view, ...a }) => view === 'schedules'
        ? call('ppm', '/api/ppm/schedules', { organization_id: a.organization_id, property_id: a.property_id, month: a.month, year: a.year })
        : call('ppm', '/api/ppm/reports', { organization_id: a.organization_id, property_id: a.property_id, from_date: a.from_date, to_date: a.to_date }));

    server.registerTool('electricity', {
        title: 'Electricity bills and consumption',
        description:
            'Electricity. view "tracker": every account\'s bill status for a month (the Excel replacement). view "bills": bills about to cost money (due, late fees). ' +
            'view "pace": this month\'s consumption against last month. view "disputes": disputed bills. view "payment_runs": payment runs. ' +
            'Use for "which electricity bills are due this week", "is Andheri using more power this month". ' +
            'Example: {"view": "tracker", "organization_id": "<id>", "month": "2026-11"}.',
        inputSchema: {
            view: z.enum(['tracker', 'bills', 'pace', 'disputes', 'payment_runs']),
            organization_id: org(),
            property_id: prop().optional().describe('For pace.'),
            month: ym().optional().describe('For tracker and payment_runs.'),
            status: text(40).optional().describe('For tracker.'),
            urgency: text(40).optional().describe('For tracker.'),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, property_id, month, status, urgency }) => {
        const org_id = organization_id;
        if (view === 'tracker') return call('electricity', '/api/electricity/tracker', { org_id, month, status, urgency });
        if (view === 'bills') return call('electricity', '/api/electricity/bills', { org_id });
        if (view === 'pace') return call('electricity', '/api/electricity/pace', { org_id, property_id });
        if (view === 'disputes') return call('electricity', '/api/electricity/disputes', { organization_id: org_id });
        return call('electricity', '/api/electricity/payment-runs', { org_id, month: month ? `${month}-01` : undefined });
    });

    server.registerTool('list_requisitions', {
        title: 'Monthly purchase requisitions',
        description:
            'Lists the monthly purchase requisitions (consumables, housekeeping, pantry) for the user\'s organisations and properties, with status and items. ' +
            'Use for "has Andheri submitted its November requisition", "pending requisitions". Do not use for purchase orders (use finance). ' +
            'Example: {"organization_id": "<id>", "month": 11, "year": 2026, "status": "submitted"}.',
        inputSchema: {
            organization_id: org().optional(),
            property_id: prop().optional(),
            month: z.number().int().min(1).max(12).optional(),
            year: z.number().int().min(2020).max(2100).optional(),
            status: text(40).optional(),
        },
        annotations: READ_ONLY,
    }, async (a) => call('list_requisitions', '/api/procurement/requisitions', {
        organization_id: a.organization_id, property_id: a.property_id, requisition_month: a.month, requisition_year: a.year, status: a.status,
    }));

    server.registerTool('finance', {
        title: 'Purchase orders and payments',
        description:
            'Finance (Accounts and the Payment Tracker). view "purchase_orders": POs (tab "to_align" for POs with money pending, or "all"). ' +
            'view "payment_tracker": the shared payment sheet, one row per PO. view "payments": payments by status. view "summary": the finance overview. ' +
            'Use for "which POs for vendor X are unpaid", "payments made this week". For one PO in full use po_details. ' +
            'Example: {"view": "purchase_orders", "organization_id": "<id>", "tab": "to_align", "vendor": "OMA"}.',
        inputSchema: {
            view: z.enum(['purchase_orders', 'payment_tracker', 'payments', 'summary']),
            organization_id: org(),
            tab: z.enum(['to_align', 'all']).optional().describe('For purchase_orders.'),
            search: text().optional(),
            vendor: text().optional(),
            site: text().optional(),
            status: text(40).optional(),
            date_from: ymd().optional(),
            date_to: ymd().optional(),
            period: text(20).optional().describe('For summary, e.g. "month".'),
            page: page(),
            page_size: pageSize(),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, ...a }) => {
        const org_id = organization_id;
        if (view === 'purchase_orders') return call('finance', '/api/accounts/pos', { org_id, tab: a.tab, search: a.search, vendor: a.vendor, site: a.site, date_from: a.date_from, date_to: a.date_to, page: a.page, page_size: a.page_size });
        if (view === 'payment_tracker') return call('finance', '/api/accounts/tracker', { org_id, status: a.status, search: a.search, vendor: a.vendor, site: a.site, date_from: a.date_from, date_to: a.date_to, page: a.page, page_size: a.page_size });
        if (view === 'payments') return call('finance', '/api/accounts/payments', { org_id, status: a.status, search: a.search, date_from: a.date_from, date_to: a.date_to, page: a.page, page_size: a.page_size });
        return call('finance', '/api/accounts/summary', { org_id, period: a.period, from: a.date_from, to: a.date_to });
    });

    server.registerTool('po_details', {
        title: 'One purchase order in full',
        description:
            'Everything about one purchase order: vendor, lines, amounts, payments and status. Use after finance or po_approval_queue. ' +
            'Example: {"organization_id": "<id>", "po_id": "<PO id>"}.',
        inputSchema: { organization_id: org(), po_id: uuid().describe('PO id (the id field, not the PO number).') },
        annotations: READ_ONLY,
    }, async ({ organization_id, po_id }) => call('po_details', `/api/accounts/po/${po_id}`, { org_id: organization_id }));

    server.registerTool('invoices', {
        title: 'Vendor invoices',
        description:
            'Invoice Control. view "queue": invoices to review (queue "review", "ready", "accepted" or "all"). ' +
            'view "po_status": POs with their invoice activity. view "summary": the headline tiles. ' +
            'Use for "which invoices are waiting for review", "has vendor X sent its invoice". ' +
            'Example: {"view": "queue", "organization_id": "<id>", "queue": "review"}.',
        inputSchema: {
            view: z.enum(['queue', 'po_status', 'summary']),
            organization_id: org(),
            queue: z.enum(['review', 'ready', 'accepted', 'all']).optional().describe('For view queue.'),
            filter: text(40).optional().describe('For po_status.'),
            search: text().optional(),
            page: page(),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, queue, filter, search, page: p }) => {
        const org_id = organization_id;
        if (view === 'queue') return call('invoices', '/api/invoices/queue', { org_id, view: queue, search, page: p });
        if (view === 'po_status') return call('invoices', '/api/invoices/po-status', { org_id, filter, search, page: p });
        return call('invoices', '/api/invoices/summary', { org_id });
    });

    server.registerTool('aop', {
        title: 'Budget vs actual (AOP)',
        description:
            'The annual operating plan. view "summary": are we on budget this month and where are we overspending. ' +
            'view "warnings": rows the importer could not match. view "bounties": the month\'s savings bounties. ' +
            'Example: {"view": "summary", "organization_id": "<id>", "month": "2026-11"}.',
        inputSchema: { view: z.enum(['summary', 'warnings', 'bounties']), organization_id: org(), month: ym().optional() },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, month }) => {
        const org_id = organization_id;
        // summary takes YYYY-MM; bounties takes the first of the month (YYYY-MM-01).
        if (view === 'summary') return call('aop', '/api/aop/summary', { org_id, month });
        if (view === 'warnings') return call('aop', '/api/aop/warnings', { org_id });
        return call('aop', '/api/aop/bounties', { org_id, month: month ? `${month}-01` : undefined });
    });

    server.registerTool('my_tasks', {
        title: 'Task Manager tasks',
        description:
            'Tasks from the Task Manager, as the signed-in person sees them (their own, and their team\'s if they manage one). ' +
            'Use for "what tasks are pending for me", "overdue tasks in my department". Do not use for service tickets (use list_tickets). ' +
            'Example: {"status": "pending"}.',
        inputSchema: {
            status: text(40).optional(),
            department_id: uuid().optional(),
            employee_id: uuid().optional(),
        },
        annotations: READ_ONLY,
    }, async ({ status, department_id, employee_id }) => call('my_tasks', '/api/task-manager/tasks', { status, departmentId: department_id, employeeId: employee_id }));

    server.registerTool('property_vendors', {
        title: 'Property vendors and revenue',
        description:
            'Vendors (cafeteria, shops) at one property. view "list": vendors with recent daily revenue. view "revenue": the revenue summary for a period. ' +
            'Do not use for purchase-order suppliers (use finance). ' +
            'Example: {"view": "revenue", "property_id": "<id>", "period": "month"}.',
        inputSchema: { view: z.enum(['list', 'revenue']), property_id: prop(), period: text(20).optional().describe('For revenue, e.g. "month".') },
        annotations: READ_ONLY,
    }, async ({ view, property_id, period }) => view === 'list'
        ? call('property_vendors', `/api/properties/${property_id}/vendors`, {})
        : call('property_vendors', `/api/properties/${property_id}/vendor-summary`, { period }));

    server.registerTool('visitor_summary', {
        title: 'Visitor summary',
        description:
            'Visitor (VMS) numbers for one property: visitors checked in, by period. Use for "how many visitors came to X this week". ' +
            'Example: {"property_id": "<id>", "period": "week"}.',
        inputSchema: { property_id: prop(), period: text(20).optional().describe('e.g. "today", "week", "month".') },
        annotations: READ_ONLY,
    }, async ({ property_id, period }) => call('visitor_summary', `/api/properties/${property_id}/vms-summary`, { period }));

    server.registerTool('amc_contracts', {
        title: 'AMC contracts',
        description:
            'Annual maintenance contracts (lifts, DG sets, HVAC and so on) with vendors and expiry dates. Use for "which AMCs expire this quarter". ' +
            'Example: {"organization_id": "<id>", "property_id": "<id>"}.',
        inputSchema: { organization_id: org(), property_id: prop().optional() },
        annotations: READ_ONLY,
    }, async ({ organization_id, property_id }) => call('amc_contracts', '/api/amc/contracts', { organization_id, property_id }));

    server.registerTool('document_bank', {
        title: 'Document bank',
        description:
            'Searches the document bank (manuals, certificates, warranties, compliance documents) by text, category, equipment or status. ' +
            'Returns document details, not the files. Example: {"organization_id": "<id>", "search": "fire NOC"}.',
        inputSchema: {
            organization_id: org(),
            property_id: prop().optional(),
            search: text().optional(),
            category: text(60).optional(),
            equipment: text(60).optional(),
            status: text(40).optional(),
        },
        annotations: READ_ONLY,
    }, async ({ search, ...a }) => call('document_bank', '/api/document-bank', { ...a, q: search }));

    server.registerTool('crm_reports', {
        title: 'CRM numbers and reports',
        description:
            'Sales (CRM) numbers. view "stats": headline numbers (type "rep" for the user\'s own, "admin" for the team). ' +
            'view "report": a report by report_type monthly, quarterly, user, property, source, status or revenue between two dates. ' +
            'Use for "how many leads did we win this month", "conversion by source". For individual leads use list_crm_leads. ' +
            'Example: {"view": "report", "organization_id": "<id>", "report_type": "source", "from": "2026-10-01", "to": "2026-10-31"}.',
        inputSchema: {
            view: z.enum(['stats', 'report']),
            organization_id: org(),
            type: z.enum(['rep', 'admin']).optional().describe('For stats.'),
            report_type: z.enum(['monthly', 'quarterly', 'user', 'property', 'source', 'status', 'revenue']).optional().describe('For report.'),
            period: text(20).optional().describe('For stats.'),
            from: ymd().optional(),
            to: ymd().optional(),
            property_id: prop().optional(),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, type, report_type, period, from, to, property_id }) => view === 'stats'
        ? call('crm_reports', '/api/crm/stats', { org_id: organization_id, type, period, property_id })
        : call('crm_reports', '/api/crm/reports', { org_id: organization_id, type: report_type, from, to, property_id }));

    server.registerTool('roster', {
        title: 'Staff roster',
        description:
            'The staff roster of one property for a month: who is on the roster, their roles and shifts. ' +
            'Use for "who is on duty at Andheri this month", "how many MSTs are rostered". For attendance numbers use command_center or find_endpoints. ' +
            'Example: {"property_id": "<id>", "month": "2026-11"}.',
        inputSchema: { property_id: prop(), month: ym() },
        annotations: READ_ONLY,
    }, async ({ property_id, month }) => call('roster', '/api/roster', { propertyId: property_id, month }));

    server.registerTool('meetings', {
        title: 'PO review meetings',
        description:
            'PO review meetings (for approvers, the purchase team and accounts). view "list": meetings of the organisation with their agendas. ' +
            'view "detail": one meeting with its agenda, decisions and transcript lines (needs meeting_id). ' +
            'Use for "what was decided in yesterday\'s PO review". Do not use for meeting-room bookings (use my_bookings). ' +
            'Example: {"view": "list", "organization_id": "<id>"}.',
        inputSchema: {
            view: z.enum(['list', 'detail']),
            organization_id: org(),
            meeting_id: uuid().optional().describe('For detail.'),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, meeting_id }) => {
        if (view === 'list') return call('meetings', '/api/meetings', { org_id: organization_id });
        if (!meeting_id) return { content: [{ type: 'text', text: 'meeting_id is required for view "detail". Use view "list" to find it.' }], isError: true };
        return call('meetings', `/api/meetings/${meeting_id}`, { org_id: organization_id });
    });

    server.registerTool('org_efficiency', {
        title: 'Organisation efficiency (goals and tasks)',
        description:
            'The Organisation Efficiency Meter. view "goals": goals with progress (filter by level, cadence, department, status). ' +
            'view "tasks": tasks against those goals (filter by dates, goal, status). view "meter": the overall meter for active goals. ' +
            'view "agents": the efficiency agents and their recent council log. view "measurements": measurements over time for one goal (needs goal_id). ' +
            'Internal staff only. Example: {"view": "goals", "organization_id": "<id>", "status": "active"}.',
        inputSchema: {
            view: z.enum(['goals', 'tasks', 'meter', 'agents', 'measurements']),
            organization_id: org(),
            goal_id: uuid().optional().describe('For measurements, or to filter tasks.'),
            level: text(40).optional(),
            cadence: text(40).optional(),
            department: text(80).optional(),
            status: text(40).optional(),
            from: ymd().optional().describe('For tasks.'),
            to: ymd().optional().describe('For tasks.'),
        },
        annotations: READ_ONLY,
    }, async ({ view, organization_id, goal_id, level, cadence, department, status, from, to }) => {
        const orgId = organization_id;
        if (view === 'goals') return call('org_efficiency', '/api/org-efficiency/goals', { orgId, level, cadence, department, status });
        if (view === 'tasks') return call('org_efficiency', '/api/org-efficiency/tasks', { orgId, from, to, goalId: goal_id, status });
        if (view === 'meter') return call('org_efficiency', '/api/org-efficiency/meter', { orgId, cadence, department });
        if (view === 'agents') return call('org_efficiency', '/api/org-efficiency/agents', { orgId });
        if (!goal_id) return { content: [{ type: 'text', text: 'goal_id is required for view "measurements". Use view "goals" to find it.' }], isError: true };
        return call('org_efficiency', '/api/org-efficiency/measurements', { goalId: goal_id });
    });

    server.registerTool('command_center', {
        title: 'Command Center overview',
        description:
            'The Command Center\'s organisation-wide picture. view "kpis": the at-a-glance figures. view "portfolio": per-building health. ' +
            'view "ticket_alerts": per-building ticket alerts. view "water": water intelligence. ' +
            'Use for "how are all our buildings doing today". Example: {"view": "portfolio", "organization_id": "<id>"}.',
        inputSchema: { view: z.enum(['kpis', 'portfolio', 'ticket_alerts', 'water']), organization_id: org() },
        annotations: READ_ONLY,
    }, async ({ view, organization_id }) => {
        const path = { kpis: '/api/command-center/kpis', portfolio: '/api/command-center/portfolio', ticket_alerts: '/api/command-center/ticket-alerts', water: '/api/command-center/water' }[view];
        return call('command_center', path, { org_id: organization_id });
    });
}
