// URL values are the authority for Organization dashboard navigation.
export const ORG_DASHBOARD_TABS = [
    'overview', 'tasks', 'task_testing', 'properties', 'requests', 'reports', 'visitors', 'settings', 'profile',
    'revenue', 'users', 'diesel_logger', 'diesel', 'electricity_logger', 'electricity',
    'stock_reports', 'checklist', 'super_tenants', 'escalation', 'rooms', 'ppm',
    'vendors', 'procurement', 'roster', 'water_logger', 'water', 'guest_experience',
    'ai_tickets', 'org_progress', 'org_efficiency', 'agent_console', 'document_bank',
    'grievance', 'assets',
] as const;
export type OrgDashboardTab = typeof ORG_DASHBOARD_TABS[number];
export function resolveOrgDashboardTab(value: string | null, isOpsSuperAdmin = false): OrgDashboardTab {
    if (!ORG_DASHBOARD_TABS.includes(value as OrgDashboardTab)) return 'overview';
    if (isOpsSuperAdmin && ['org_progress', 'org_efficiency', 'agent_console'].includes(value!)) return 'overview';
    return value as OrgDashboardTab;
}

/** Called by user actions only. Never restore tabs or copy framework history state. */
export function pushDashboardNavigation(href: string, history = window.history, location = window.location) {
    if (href === `${location.pathname}${location.search}${location.hash}`) return;
    history.pushState(null, '', href);
}
