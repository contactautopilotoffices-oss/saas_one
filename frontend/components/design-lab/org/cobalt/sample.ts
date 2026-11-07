import type { Approval } from '../useOrgModel';

/**
 * Sample detail behind Cobalt's extra screens: the items inside each approval queue, the
 * notification feed, and per site extras. The app has this data but no hook wires it up for
 * the org view yet, so every block that reads from here shows a Sample badge.
 *
 * The queue sizes and totals match ORG_SAMPLE (14 purchase orders worth 38.6L with 3 critical,
 * 6 material requests, 5 petty cash requests worth 46,000, 4 escalations), so Home and the
 * Approvals screen agree.
 */

export type QueueId = Approval['id'];

export interface ApprovalItem {
    id: string;
    queue: QueueId;
    ref: string;
    title: string;
    site: string;
    /** Vendor for a purchase order, or who asked for petty cash. */
    party: string;
    by: string;
    amount: number | null;
    /** Days it has waited on you. */
    waited: number;
    critical: boolean;
    /** Material requests: the quotes received, lowest first. */
    quotes?: { vendor: string; amount: number }[];
    /** Escalations: hours past SLA, and where in the building. */
    pastSlaHours?: number;
    location?: string;
}

const po = (n: number, title: string, party: string, site: string, amount: number, waited: number, by: string, critical = false): ApprovalItem =>
    ({ id: `po-${n}`, queue: 'po', ref: `PO-${n}`, title, party, site, amount, waited, by, critical });

const mr = (n: number, title: string, site: string, waited: number, by: string, quotes: [string, number][]): ApprovalItem =>
    ({ id: `mr-${n}`, queue: 'mr', ref: `MR-${n}`, title, party: quotes[0][0], site, amount: quotes[0][1], waited, by, critical: false, quotes: quotes.map(([vendor, amount]) => ({ vendor, amount })) });

const pc = (n: number, title: string, site: string, amount: number, waited: number, by: string): ApprovalItem =>
    ({ id: `pc-${n}`, queue: 'petty', ref: `PC-${n}`, title, party: by, site, amount, waited, by, critical: false });

const esc = (n: number, title: string, site: string, location: string, pastSlaHours: number, waited: number, by: string): ApprovalItem =>
    ({ id: `esc-${n}`, queue: 'escalation', ref: `TKT-${n}`, title, party: by, site, amount: null, waited, by, critical: true, pastSlaHours, location });

export const APPROVAL_ITEMS: ApprovalItem[] = [
    po(2231, 'Chiller compressor overhaul', 'Blue Star Services', 'Harbour Point', 9_80_000, 3, 'Arjun Rao', true),
    po(2236, 'Lift B gearbox parts', 'Otis Elevator', 'Metro Hub', 6_40_000, 2, 'Vikram Singh', true),
    po(2240, 'Fire pump controller', 'Kirloskar Pumps', 'SS Plaza Tower A', 4_20_000, 1, 'Sana Iqbal', true),
    po(2232, 'LED panel retrofit, Floor 3', 'Brightline Electricals', 'SS Plaza Tower B', 4_40_000, 2, 'Neha Kulkarni'),
    po(2234, 'CCTV cameras, 8 units', 'SecureView Systems', 'Metro Hub', 2_96_000, 3, 'Vikram Singh'),
    po(2228, 'Housekeeping supplies, October', 'CleanPro Supplies', 'Harbour Point', 2_50_000, 4, 'Arjun Rao'),
    po(2238, 'Carpet replacement, Level 5', 'FloorCraft Interiors', 'Lakeside One', 1_94_000, 1, 'Rahul Menon'),
    po(2229, 'DG-2 servicing', 'Cummins Sales', 'Harbour Point', 1_85_000, 5, 'Arjun Rao'),
    po(2239, 'UPS batteries', 'PowerSafe Systems', 'Metro Hub', 1_48_000, 0, 'Vikram Singh'),
    po(2237, 'Water treatment chemicals', 'AquaTreat', 'SS Plaza Tower B', 72_000, 2, 'Neha Kulkarni'),
    po(2233, 'Pantry supplies, October', 'FreshCart', 'Lakeside One', 68_000, 1, 'Rahul Menon'),
    po(2242, 'Stationery and IT consumables', 'OfficeHub', 'SS Plaza Tower A', 67_000, 0, 'Sana Iqbal'),
    po(2235, 'Pest control, quarterly', 'Shield Pest Care', 'SS Plaza Tower A', 54_000, 6, 'Sana Iqbal'),
    po(2241, 'Landscaping, October', 'GreenEdge', 'Harbour Point', 46_000, 0, 'Arjun Rao'),

    mr(118, 'AC filters, 40 units', 'Harbour Point', 9, 'Arjun Rao', [['CoolAir Traders', 38_400], ['Polar HVAC', 41_200], ['Breeze Supply', 44_000]]),
    mr(121, 'Plumbing fittings, pump room', 'SS Plaza Tower A', 6, 'Sana Iqbal', [['FlowFix', 22_600], ['Pipeline Stores', 25_100]]),
    mr(123, 'Door closers, 12 units', 'Metro Hub', 4, 'Vikram Singh', [['Hardware Hub', 18_000], ['Dorma Point', 19_800], ['Lockwell', 21_300]]),
    mr(124, 'Paint for lobby touch up', 'Lakeside One', 3, 'Rahul Menon', [['ColourCraft', 31_500], ['Asian Paint Depot', 33_900]]),
    mr(126, 'Cable trays', 'SS Plaza Tower B', 2, 'Neha Kulkarni', [['Volt Supplies', 44_800], ['Wireway', 46_100], ['Electro Mart', 49_500]]),
    mr(127, 'Signage boards', 'Harbour Point', 1, 'Arjun Rao', [['SignPro', 12_900], ['Print Point', 14_200]]),

    pc(315, 'Town hall event setup', 'SS Plaza Tower B', 19_000, 0, 'Neha Kulkarni'),
    pc(312, 'Emergency plumber visit', 'SS Plaza Tower A', 12_500, 2, 'Sana Iqbal'),
    pc(313, 'Pantry milk and tea', 'Metro Hub', 6_800, 1, 'Vikram Singh'),
    pc(311, 'Courier charges', 'Harbour Point', 4_200, 2, 'Arjun Rao'),
    pc(314, 'Taxi for night shift', 'Lakeside One', 3_500, 1, 'Rahul Menon'),

    esc(148, 'AC not cooling in Conference Room 3', 'SS Plaza Tower A', 'Level 2', 3, 0, 'Rohan Shah'),
    esc(131, 'Basement exhaust fan not running', 'Metro Hub', 'Basement parking', 26, 1, 'Facility team'),
    esc(151, 'Water leak near 2nd floor washroom', 'Harbour Point', 'Level 2, washroom', 2, 0, 'Meera Pillai'),
    esc(144, 'Parking boom barrier stuck open', 'Lakeside One', 'Basement entry', 5, 1, 'Security desk'),
];

/** Per site extras: who runs it, staff on shift and PPM. Present adds up to 131 of 142. */
export const SITE_EXTRAS: Record<string, { manager: string; present: number; scheduled: number; ppm: number }> = {
    'Harbour Point': { manager: 'Arjun Rao', present: 34, scheduled: 38, ppm: 86 },
    'SS Plaza Tower B': { manager: 'Neha Kulkarni', present: 22, scheduled: 24, ppm: 90 },
    'Metro Hub': { manager: 'Vikram Singh', present: 30, scheduled: 32, ppm: 89 },
    'SS Plaza Tower A': { manager: 'Sana Iqbal', present: 28, scheduled: 29, ppm: 94 },
    'Lakeside One': { manager: 'Rahul Menon', present: 17, scheduled: 19, ppm: 97 },
};

/** Overdue PPM by system. Adds up to the 7 overdue in ORG_SAMPLE. */
export const PPM_OVERDUE = [
    { name: 'Fire pumps', count: 3 }, { name: 'HVAC', count: 2 }, { name: 'Lifts', count: 1 }, { name: 'DG sets', count: 1 },
];

export type NoticeKind = 'sla' | 'round' | 'approval' | 'diesel' | 'amc' | 'budget' | 'report';

export interface Notice {
    id: string;
    kind: NoticeKind;
    title: string;
    body: string;
    /** Minutes before the sample "now" (9:41 AM). */
    ago: number;
    unread: boolean;
    /** Where tapping it goes. */
    to: { name: 'approval'; id: string } | { name: 'ticket'; id: string } | { name: 'site'; site: string } | { name: 'compliance' } | { name: 'money' } | { name: 'none' };
}

export const NOTICES: Notice[] = [
    { id: 'n1', kind: 'sla', title: 'Past SLA: water leak, Level 2', body: 'Harbour Point. Meera Pillai raised it 2 hours ago.', ago: 9, unread: true, to: { name: 'ticket', id: 'tkt-151' } },
    { id: 'n2', kind: 'approval', title: 'PO-2240 sent to you', body: 'Fire pump controller, 4.2L, SS Plaza Tower A.', ago: 31, unread: true, to: { name: 'approval', id: 'po-2240' } },
    { id: 'n3', kind: 'round', title: 'Fire safety round is late', body: 'SS Plaza Tower A, Floor 6. Due at 9:15 AM.', ago: 26, unread: true, to: { name: 'compliance' } },
    { id: 'n4', kind: 'diesel', title: 'Diesel low at Harbour Point', body: 'DG-2 is at 22%. Order a refill.', ago: 81, unread: false, to: { name: 'money' } },
    { id: 'n5', kind: 'report', title: 'Morning report is ready', body: 'All 5 sites, 6 October.', ago: 99, unread: false, to: { name: 'none' } },
    { id: 'n6', kind: 'amc', title: 'Lift AMC ends in 12 days', body: 'Metro Hub. Renew before 18 October.', ago: 15 * 60 + 1, unread: false, to: { name: 'compliance' } },
    { id: 'n7', kind: 'approval', title: 'PC-311 raised', body: 'Courier charges, 4,200, Harbour Point.', ago: 17 * 60 + 26, unread: false, to: { name: 'approval', id: 'pc-311' } },
    { id: 'n8', kind: 'budget', title: 'Harbour Point is over budget', body: '2.4L over this month so far.', ago: 22 * 60 + 41, unread: false, to: { name: 'site', site: 'Harbour Point' } },
];

export const RECENT_SEARCHES = ['Harbour Point', 'PO-2231', 'Diesel'];
