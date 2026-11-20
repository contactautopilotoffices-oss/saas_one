/**
 * Sample data for the org super admin mobile dashboard.
 *
 * Shown only when live org data is not available (not signed in as an org-wide role), or
 * for modules the app has data for but no data hook wires up yet. Every block that reads
 * from here carries a "Sample" badge.
 */

export const ORG_SAMPLE = {
    orgName: 'Autopilot Offices',
    user: { name: 'Priya Mehta', roleLabel: 'Org super admin' },
    raised: { today: 64, month: 1012, all: 48230 },
    sites: [
        { id: 'site-hp', name: 'Harbour Point', code: 'HP', total: 980, resolved: 959, active: 21, urgent: 4, trend: [14, 15, 17, 16, 18, 19, 18, 20, 19, 21, 22, 20, 21, 21] },
        { id: 'site-sb', name: 'SS Plaza Tower B', code: 'SSB', total: 720, resolved: 711, active: 9, urgent: 3, trend: [6, 7, 6, 8, 7, 9, 8, 8, 9, 10, 9, 8, 9, 9] },
        { id: 'site-mh', name: 'Metro Hub', code: 'MH', total: 870, resolved: 855, active: 15, urgent: 1, trend: [18, 17, 16, 17, 15, 16, 14, 15, 16, 15, 14, 15, 16, 15] },
        { id: 'site-sa', name: 'SS Plaza Tower A', code: 'SSA', total: 1247, resolved: 1235, active: 12, urgent: 0, trend: [11, 12, 10, 13, 12, 11, 12, 13, 12, 11, 12, 12, 13, 12] },
        { id: 'site-lo', name: 'Lakeside One', code: 'LO', total: 640, resolved: 634, active: 6, urgent: 0, trend: [8, 7, 7, 6, 7, 6, 5, 6, 6, 7, 6, 5, 6, 6] },
    ],
    tickets: { breached: 7, urgent: 8, active: 63 },
    budget: {
        pct: 92, spent: 4_62_00_000, total: 5_02_00_000,
        overSites: [{ name: 'Harbour Point', over: 2_40_000 }, { name: 'SS Plaza Tower B', over: 90_000 }],
    },
    po: { count: 14, value: 38_60_000, critical: 3 },
    mr: { needsDecision: 6, needsQuote: 4, oldestDays: 9 },
    petty: { count: 5, value: 46_000, oldestDays: 2 },
    escalations: { count: 4, top: 'AC not cooling in Conference Room 3, Level 2' },
    oldestOpen: { days: 11, title: 'Lift B making grinding noise', site: 'Metro Hub' },
    roster: { coveragePct: 92, present: 131, scheduled: 142, late: 6, absent: 5, shortTomorrow: 3, worst: { name: 'Harbour Point', absent: 3 } },
    grievances: { open: 3, oldestDays: 6 },
    ppm: { pct: 91, target: 95, overdue: 7, dueToday: 5, worstSystem: { name: 'Fire pumps', count: 3 } },
    rounds: { missed: 4, sites: 2, worst: 'Fire safety round, SS Plaza Tower A, Floor 6' },
    amc: [
        { id: 'amc-1', asset: 'Lifts', site: 'Metro Hub', days: 12 },
        { id: 'amc-2', asset: 'DG sets', site: 'Harbour Point', days: 21 },
        { id: 'amc-3', asset: 'Fire system', site: 'Lakeside One', days: 27 },
    ],
    elec: {
        deltaPct: 6, units: 1_84_200, verdict: 'Running 6% above the same days last month',
        topSite: { name: 'Harbour Point', deltaPct: 14 },
        last14: [11.8, 12.4, 12.1, 9.2, 8.6, 12.9, 13.1, 12.7, 12.6, 12.9, 9.4, 8.8, 13.2, 6.1],
    },
    bills: { count: 2, atRisk: 31_000 },
    diesel: { litres: 1240, cost: 1_11_600, lowTank: { site: 'Harbour Point', dg: 'DG-2', pct: 22 } },
    water: { tankers: 2, sites: 1 },
    visitors: { today: 186, inside: 74 },
    vendor: { revenue: 14_20_000, leader: 'SS Plaza Tower A' },
    rooms: { pct: 64 },
};

/** Fourteen day labels ending today (6 Oct), for the electricity trend. */
export const ORG_DAYS_14 = ['23 Sep', '24 Sep', '25 Sep', '26 Sep', '27 Sep', '28 Sep', '29 Sep', '30 Sep', '1 Oct', '2 Oct', '3 Oct', '4 Oct', '5 Oct', '6 Oct'];
