/**
 * The Command Center cards' data URLs for one organisation (all-properties view), exactly as the cards build them.
 * UnifiedDashboard starts these during "Loading your dashboard…" so the cards find their data already on its way
 * (performance plan Phase 5A). Keep in step with the cards: a URL that drifts only costs one unused request, but then
 * that card no longer benefits.
 *
 * Left out on purpose: material-requests-summary (property-scoped and refused for some roles; the card asks itself).
 */
export function commandCenterPrefetchUrls(orgId: string): string[] {
    return [
        `/api/organizations/${orgId}/tickets-summary?period=all`,
        `/api/accounts/summary?org_id=${orgId}&period=month`,
        `/api/aop/summary?org_id=${orgId}`,
        `/api/aop/trend?org_id=${orgId}`,
        `/api/procurement/mailbox/summary?org_id=${orgId}&limit=10`,
        `/api/agents/pulse?orgId=${orgId}`,
        `/api/agents/runs?orgId=${orgId}&limit=12`,
        `/api/organizations/${orgId}/generators`,
        `/api/organizations/${orgId}/diesel-summary?period=month`,
        `/api/electricity/pace?org_id=${orgId}`,
        `/api/command-center/ticket-alerts?org_id=${orgId}`,
        `/api/command-center/kpis?org_id=${orgId}`,
        `/api/command-center/water?org_id=${orgId}`,
        `/api/organizations/${orgId}/ppm-summary`,
        `/api/electricity/tracker?org_id=${orgId}`,
        `/api/organizations/${orgId}/vms-summary?period=today`,
        `/api/organizations/${orgId}/vendor-summary?period=month`,
        `/api/org-efficiency/meter?orgId=${orgId}`,
        `/api/organizations/${orgId}/roster-coverage`,
    ];
}
