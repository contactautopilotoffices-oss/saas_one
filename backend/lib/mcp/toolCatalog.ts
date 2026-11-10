/**
 * The FMS MCP tools, listed for the "which tools may this person use" screen.
 *
 * One entry per tool registered in tools.ts and domainTools.ts; tests/mcp/mcp.test.ts checks the
 * two lists match, so a new tool cannot be forgotten here (it would be invisible on the screen and,
 * for a person on a "selected tools" list, unreachable).
 *
 * `whoami` is always on: the assistant's instructions say to start with it, and it only describes the
 * connected user. `confirm_action` is switched on automatically whenever any create or update tool
 * is selected, because those tools only preview; without confirm_action they cannot do anything.
 */

export type McpToolKind = 'core' | 'read' | 'create' | 'update' | 'confirm';

export type McpToolGroup =
    | 'Core'
    | 'Tickets and HR'
    | 'Sites and people'
    | 'Maintenance and utilities'
    | 'Purchasing and money'
    | 'Sales (CRM)'
    | 'Work and meetings'
    | 'Create records'
    | 'Change records';

export type McpToolEntry = { name: string; title: string; group: McpToolGroup; kind: McpToolKind };

export const ALWAYS_ON_TOOLS = ['whoami'] as const;
export const CONFIRM_TOOL = 'confirm_action';

export const MCP_TOOL_CATALOG: readonly McpToolEntry[] = [
    // core
    { name: 'whoami', title: 'Who am I in the FMS', group: 'Core', kind: 'core' },
    { name: 'find_endpoints', title: 'Find FMS data sources', group: 'Core', kind: 'read' },
    { name: 'fetch_endpoint', title: 'Read from any catalogued FMS route', group: 'Core', kind: 'read' },

    // tickets and HR
    { name: 'list_tickets', title: 'List tickets', group: 'Tickets and HR', kind: 'read' },
    { name: 'ticket_comments', title: 'Ticket comments', group: 'Tickets and HR', kind: 'read' },
    { name: 'list_hr_tickets', title: 'List HR tickets (grievances, HR queries)', group: 'Tickets and HR', kind: 'read' },
    { name: 'hr_ticket_details', title: 'One HR ticket', group: 'Tickets and HR', kind: 'read' },
    { name: 'hr_categories', title: 'HR ticket categories', group: 'Tickets and HR', kind: 'read' },

    // sites and people
    { name: 'list_properties', title: 'List properties', group: 'Sites and people', kind: 'read' },
    { name: 'property_details', title: 'One property', group: 'Sites and people', kind: 'read' },
    { name: 'list_users', title: 'List people', group: 'Sites and people', kind: 'read' },
    { name: 'property_vendors', title: 'Property vendors', group: 'Sites and people', kind: 'read' },
    { name: 'visitor_summary', title: 'Visitor summary', group: 'Sites and people', kind: 'read' },
    { name: 'roster', title: 'Roster', group: 'Sites and people', kind: 'read' },
    { name: 'org_summary', title: 'Organisation summaries', group: 'Sites and people', kind: 'read' },
    { name: 'org_efficiency', title: 'Organisation efficiency', group: 'Sites and people', kind: 'read' },
    { name: 'command_center', title: 'Command centre', group: 'Sites and people', kind: 'read' },
    { name: 'wiki', title: 'Organisation wiki', group: 'Sites and people', kind: 'read' },

    // maintenance and utilities
    { name: 'list_assets', title: 'List assets', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'ppm', title: 'PPM schedules and reports', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'amc_contracts', title: 'AMC contracts', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'document_bank', title: 'Document bank', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'electricity', title: 'Electricity tracker and bills', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'utilities', title: 'Diesel, electricity and water readings', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'stock', title: 'Stock items and movements', group: 'Maintenance and utilities', kind: 'read' },
    { name: 'sop_checklists', title: 'SOP checklists', group: 'Maintenance and utilities', kind: 'read' },

    // purchasing and money
    { name: 'list_requisitions', title: 'List requisitions', group: 'Purchasing and money', kind: 'read' },
    { name: 'finance', title: 'Purchase orders, payments, tracker', group: 'Purchasing and money', kind: 'read' },
    { name: 'po_details', title: 'One purchase order', group: 'Purchasing and money', kind: 'read' },
    { name: 'po_approval_queue', title: 'POs waiting for my approval', group: 'Purchasing and money', kind: 'read' },
    { name: 'invoices', title: 'Invoices', group: 'Purchasing and money', kind: 'read' },
    { name: 'aop', title: 'AOP (annual operating plan)', group: 'Purchasing and money', kind: 'read' },
    { name: 'petty_cash', title: 'Petty cash', group: 'Purchasing and money', kind: 'read' },
    { name: 'supplier_rates', title: 'Supplier rates', group: 'Purchasing and money', kind: 'read' },

    // sales
    { name: 'list_crm_leads', title: 'List CRM leads', group: 'Sales (CRM)', kind: 'read' },
    { name: 'crm_reports', title: 'CRM reports and stats', group: 'Sales (CRM)', kind: 'read' },

    // work and meetings
    { name: 'my_tasks', title: 'My tasks', group: 'Work and meetings', kind: 'read' },
    { name: 'my_pending_actions', title: 'My pending actions', group: 'Work and meetings', kind: 'read' },
    { name: 'meetings', title: 'Meeting notes', group: 'Work and meetings', kind: 'read' },
    { name: 'find_meeting_rooms', title: 'Find meeting rooms', group: 'Work and meetings', kind: 'read' },
    { name: 'my_bookings', title: 'My meeting room bookings', group: 'Work and meetings', kind: 'read' },

    // create (preview, then confirm)
    { name: 'create_ticket', title: 'Raise a ticket', group: 'Create records', kind: 'create' },
    { name: 'raise_hr_ticket', title: 'Raise an HR ticket', group: 'Create records', kind: 'create' },
    { name: 'add_ticket_comment', title: 'Comment on a ticket', group: 'Create records', kind: 'create' },
    { name: 'create_crm_lead', title: 'Create a CRM lead', group: 'Create records', kind: 'create' },
    { name: 'add_crm_note', title: 'Add a note to a lead', group: 'Create records', kind: 'create' },
    { name: 'log_crm_activity', title: 'Log a lead activity', group: 'Create records', kind: 'create' },
    { name: 'assign_task', title: 'Assign a task', group: 'Create records', kind: 'create' },
    { name: 'record_diesel_reading', title: 'Record a diesel reading', group: 'Create records', kind: 'create' },
    { name: 'record_electricity_reading', title: 'Record an electricity reading', group: 'Create records', kind: 'create' },
    { name: 'record_water_reading', title: 'Record a water reading', group: 'Create records', kind: 'create' },
    { name: 'record_stock_movement', title: 'Add or issue stock', group: 'Create records', kind: 'create' },
    { name: 'draft_petty_cash_request', title: 'Draft a petty cash request', group: 'Create records', kind: 'create' },
    { name: 'book_meeting_room', title: 'Book a meeting room', group: 'Create records', kind: 'create' },
    { name: 'cancel_booking', title: 'Cancel a meeting room booking', group: 'Create records', kind: 'create' },

    // update (preview, then confirm)
    { name: 'update_ticket', title: 'Close or move a service ticket on', group: 'Change records', kind: 'update' },
    { name: 'reassign_ticket', title: 'Reassign a ticket', group: 'Change records', kind: 'update' },
    { name: 'update_hr_ticket', title: 'Update an HR ticket', group: 'Change records', kind: 'update' },
    { name: 'update_crm_lead', title: 'Update a CRM lead', group: 'Change records', kind: 'update' },
    { name: 'update_task_status', title: "Change a task's status", group: 'Change records', kind: 'update' },

    // confirm
    { name: CONFIRM_TOOL, title: 'Confirm a previewed action', group: 'Change records', kind: 'confirm' },
];

export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOL_CATALOG.map(t => t.name);
const BY_NAME = new Map(MCP_TOOL_CATALOG.map(t => [t.name, t]));

export function isActionTool(name: string): boolean {
    const kind = BY_NAME.get(name)?.kind;
    return kind === 'create' || kind === 'update';
}

/**
 * The tools a person actually gets from a saved selection: the selection itself (unknown names
 * dropped), plus whoami, plus confirm_action when any create or update tool is in the list.
 */
export function effectiveTools(selected: readonly string[]): Set<string> {
    const out = new Set<string>(ALWAYS_ON_TOOLS);
    for (const name of selected) if (BY_NAME.has(name) && name !== CONFIRM_TOOL) out.add(name);
    if ([...out].some(isActionTool)) out.add(CONFIRM_TOOL);
    return out;
}
