/**
 * Module definitions for the Org Super Admin App Usage report. Shared by the report
 * route and the SPOC route (which validates module keys against this list).
 * See app/api/reports/app-usage/route.ts for how each rhythm is scored.
 */

export type Cadence = 'scheduled' | 'daily' | 'weekly' | 'monthly';

export interface Source {
    table: string;
    userCol: string;
    dateCol: string;
    dateType: 'ts' | 'date';
    /** Exact time of the entry, for "last entry". Defaults to dateCol. */
    atCol?: string;
    /** 'water' resolves the property through water_sources.source_id. */
    scope: 'property' | 'water';
}

export interface ModuleDef {
    key: string;
    label: string;
    cadence: Cadence;
    source?: Source;
}

export const MODULES: ModuleDef[] = [
    { key: 'checklists', label: 'SOP Checklists', cadence: 'scheduled' },
    { key: 'ppm', label: 'PPM', cadence: 'scheduled' },
    { key: 'tickets', label: 'Tickets', cadence: 'daily', source: { table: 'tickets', userCol: 'raised_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'electricity', label: 'Electricity', cadence: 'daily', source: { table: 'electricity_readings', userCol: 'created_by', dateCol: 'reading_date', atCol: 'created_at', dateType: 'date', scope: 'property' } },
    { key: 'diesel', label: 'Diesel', cadence: 'daily', source: { table: 'diesel_readings', userCol: 'created_by', dateCol: 'reading_date', atCol: 'created_at', dateType: 'date', scope: 'property' } },
    { key: 'water', label: 'Water', cadence: 'daily', source: { table: 'water_readings', userCol: 'created_by', dateCol: 'reading_date', atCol: 'created_at', dateType: 'date', scope: 'water' } },
    { key: 'visitors', label: 'Visitors', cadence: 'daily', source: { table: 'visitor_logs', userCol: 'created_by', dateCol: 'checkin_time', dateType: 'ts', scope: 'property' } },
    { key: 'stock', label: 'Stock', cadence: 'daily', source: { table: 'stock_movements', userCol: 'user_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'meeting_rooms', label: 'Meeting Rooms', cadence: 'weekly', source: { table: 'meeting_room_bookings', userCol: 'user_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'petty_cash', label: 'Petty Cash', cadence: 'weekly', source: { table: 'petty_cash_requests', userCol: 'requester_id', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'procurement', label: 'Procurement', cadence: 'weekly', source: { table: 'material_requests', userCol: 'requested_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'roster', label: 'Roster', cadence: 'weekly', source: { table: 'roster_audit_logs', userCol: 'changed_by', dateCol: 'created_at', dateType: 'ts', scope: 'property' } },
    { key: 'assets', label: 'Assets', cadence: 'weekly', source: { table: 'asset_events', userCol: 'created_by', dateCol: 'occurred_at', dateType: 'ts', scope: 'property' } },
    { key: 'requisitions', label: 'Requisitions', cadence: 'monthly' },
];

// userCol null = count only. HR grievances can be anonymous or confidential, so the
// report never ties an HR ticket to a person.
export const ORG_MODULES: { key: string; label: string; table: string; userCol: string | null }[] = [
    { key: 'hr', label: 'HR Grievances', table: 'hr_tickets', userCol: null },
    { key: 'crm', label: 'CRM Leads', table: 'crm_leads', userCol: 'created_by' },
    { key: 'tasks', label: 'Tasks Assigned', table: 'tm_tasks', userCol: 'assigned_by' },
];

/** Keys a SPOC can be assigned to: every property-level module. */
export const APP_USAGE_MODULE_KEYS = MODULES.map(m => m.key);
