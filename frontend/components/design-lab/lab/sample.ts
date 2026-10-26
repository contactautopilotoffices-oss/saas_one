import type {
    ChatMessage, LabTicket, PlanEvent, RoundSlot, Technician, WeekDay,
} from './types';

/**
 * Sample data from the Design Lab brief (section 8).
 *
 * Used ONLY where the app has the data but no hook wires it up yet. Every widget that reads
 * from here renders a "Sample" badge, so nobody mistakes it for live numbers.
 */

/** Tuesday 6 October, 9:41 AM. All sample times are relative to this moment. */
export const SAMPLE_NOW = new Date(2026, 9, 6, 9, 41, 0);

function at(h: number, m: number, dayOffset = 0): Date {
    return new Date(2026, 9, 6 + dayOffset, h, m, 0);
}

export const SAMPLE_PROPERTY = { id: 'sample-ss-plaza-a', name: 'SS Plaza Tower A' };
export const SAMPLE_USER = { name: 'Priya Mehta', role: 'property_admin' };

function t(p: Partial<LabTicket> & Pick<LabTicket, 'id' | 'number' | 'title' | 'status' | 'priority' | 'raisedAt'>): LabTicket {
    return {
        category: null,
        location: null,
        raisedBy: null,
        company: null,
        assignee: null,
        slaDue: null,
        slaHours: null,
        resolvedAt: null,
        escalationLevel: 0,
        escalations: [],
        photoBefore: null,
        hasMaterialRequest: false,
        description: null,
        source: 'sample',
        ...p,
    };
}

/** 12 active (Open 5, Assigned 3, In progress 4), 2 waitlist, 4 recently closed. */
export const SAMPLE_TICKETS: LabTicket[] = [
    t({
        id: 's-148', number: 'TKT-PROP-00148', title: 'AC not cooling in Conference Room 3',
        status: 'open', priority: 'critical', category: 'HVAC', location: 'Floor 4, Conference Room 3',
        raisedAt: at(6, 6), raisedBy: 'Rohan Shah', company: 'Northwind Labs',
        slaDue: at(10, 6), slaHours: 4, escalationLevel: 1,
        escalations: [{ at: at(8, 6), to: 'Facility manager' }],
        description: 'The AC in Conference Room 3 is running but blowing warm air since early morning. The room reads 27°C and we have a client meeting at 11 AM.',
    }),
    t({
        id: 's-152', number: 'TKT-PROP-00152', title: 'Main water line leaking in basement pump room',
        status: 'in_progress', priority: 'critical', category: 'Plumbing', location: 'Basement, Pump room',
        raisedAt: at(8, 20), raisedBy: 'Suresh N.', company: 'Facility team', assignee: 'Manju A.',
        slaDue: at(12, 20), slaHours: 4,
        description: 'Steady leak at the flange joint on the main line. Valve partly closed to reduce pressure.',
    }),
    t({
        id: 's-151', number: 'TKT-PROP-00151', title: 'Water leakage near 2nd floor washroom',
        status: 'in_progress', priority: 'high', category: 'Plumbing', location: 'Floor 2, Gents washroom',
        raisedAt: at(4, 51), raisedBy: 'Neha Kapoor', company: 'Bluefin Tech', assignee: 'Ravi Kumar',
        slaDue: at(10, 51), slaHours: 6, hasMaterialRequest: true,
        description: 'Water pooling outside the washroom door. Looks like it is coming from under the basin counter.',
    }),
    t({
        id: 's-145', number: 'TKT-PROP-00145', title: 'Chiller 2 tripping on high pressure',
        status: 'in_progress', priority: 'high', category: 'HVAC', location: 'Terrace, Chiller plant',
        raisedAt: at(7, 15), raisedBy: 'Ravi Kumar', company: 'Facility team', assignee: 'Blue Star AMC',
        slaDue: at(13, 15), slaHours: 6, hasMaterialRequest: true,
    }),
    t({
        id: 's-147', number: 'TKT-PROP-00147', title: 'Flush tank leaking in Floor 1 washroom',
        status: 'in_progress', priority: 'medium', category: 'Plumbing', location: 'Floor 1, Gents washroom',
        raisedAt: at(6, 30), raisedBy: 'Kiran S.', company: 'Front desk', assignee: 'Manju A.',
        slaDue: at(14, 30), slaHours: 8,
    }),
    t({
        id: 's-153', number: 'TKT-PROP-00153', title: 'Lift B making grinding noise',
        status: 'assigned', priority: 'medium', category: 'Lift', location: 'Lift lobby B',
        raisedAt: at(7, 1), raisedBy: 'Suresh N.', company: 'Facility team', assignee: 'Lift vendor',
        slaDue: at(15, 1), slaHours: 8,
    }),
    t({
        id: 's-150', number: 'TKT-PROP-00150', title: 'Washbasin drain blocked',
        status: 'assigned', priority: 'medium', category: 'Plumbing', location: 'Floor 3, Ladies washroom',
        raisedAt: at(7, 40), raisedBy: 'Pooja Nair', company: 'Crescent Media', assignee: 'Manju A.',
        slaDue: at(15, 40), slaHours: 8,
    }),
    t({
        id: 's-146', number: 'TKT-PROP-00146', title: 'Parking ramp light not working',
        status: 'assigned', priority: 'low', category: 'Electrical', location: 'Basement, Parking ramp',
        raisedAt: at(21, 10, -1), raisedBy: 'Suresh N.', company: 'Facility team', assignee: 'Imran P.',
        slaDue: at(21, 10), slaHours: 24,
    }),
    t({
        id: 's-154', number: 'TKT-PROP-00154', title: 'Washroom tap leaking on Floor 5',
        status: 'open', priority: 'medium', category: 'Plumbing', location: 'Floor 5, Gents washroom',
        raisedAt: at(8, 12), raisedBy: 'Ananya Das', company: 'Northwind Labs',
        slaDue: at(16, 12), slaHours: 8,
    }),
    t({
        id: 's-155', number: 'TKT-PROP-00155', title: 'Lights flickering in Bay 6',
        status: 'open', priority: 'medium', category: 'Electrical', location: 'Floor 6, Bay 6',
        raisedAt: at(8, 47), raisedBy: 'Arjun Pillai', company: 'Crescent Media',
        slaDue: at(16, 47), slaHours: 8,
    }),
    t({
        id: 's-156', number: 'TKT-PROP-00156', title: 'Pantry coffee machine not dispensing',
        status: 'open', priority: 'low', category: 'Housekeeping', location: 'Floor 3, Pantry',
        raisedAt: at(9, 5), raisedBy: 'Meera Joshi', company: 'Bluefin Tech',
        slaDue: at(9, 5, 1), slaHours: 24,
    }),
    t({
        id: 's-157', number: 'TKT-PROP-00157', title: 'Carpet stain near reception',
        status: 'open', priority: 'low', category: 'Housekeeping', location: 'Ground floor, Reception',
        raisedAt: at(9, 22), raisedBy: 'Kiran S.', company: 'Front desk',
        slaDue: at(9, 22, 1), slaHours: 24,
    }),
    t({
        id: 's-139', number: 'TKT-PROP-00139', title: 'Repaint corridor wall on Floor 5',
        status: 'waitlist', priority: 'low', category: 'Civil', location: 'Floor 5, Corridor',
        raisedAt: at(11, 30, -3), raisedBy: 'Priya Mehta', company: 'Facility team',
    }),
    t({
        id: 's-141', number: 'TKT-PROP-00141', title: 'Replace lobby planter lights',
        status: 'waitlist', priority: 'low', category: 'Electrical', location: 'Ground floor, Lobby',
        raisedAt: at(16, 5, -2), raisedBy: 'Kiran S.', company: 'Front desk',
    }),
    t({
        id: 's-144', number: 'TKT-PROP-00144', title: 'Tissue dispenser empty on Floor 2',
        status: 'closed', priority: 'low', category: 'Housekeeping', location: 'Floor 2, Ladies washroom',
        raisedAt: at(8, 55), raisedBy: 'Neha Kapoor', company: 'Bluefin Tech', assignee: 'Kavya D.',
        slaDue: at(8, 55, 1), slaHours: 24, resolvedAt: at(9, 20),
    }),
    t({
        id: 's-143', number: 'TKT-PROP-00143', title: 'AC remote missing in Cabin 4B',
        status: 'closed', priority: 'low', category: 'HVAC', location: 'Floor 4, Cabin 4B',
        raisedAt: at(8, 10), raisedBy: 'Rohan Shah', company: 'Northwind Labs', assignee: 'Ravi Kumar',
        slaDue: at(8, 10, 1), slaHours: 24, resolvedAt: at(8, 52),
    }),
    t({
        id: 's-142', number: 'TKT-PROP-00142', title: 'Door closer loose at Floor 3 entry',
        status: 'resolved', priority: 'medium', category: 'Civil', location: 'Floor 3, Main entry',
        raisedAt: at(7, 20), raisedBy: 'Pooja Nair', company: 'Crescent Media', assignee: 'Amar S.',
        slaDue: at(15, 20), slaHours: 8, resolvedAt: at(8, 41),
    }),
    t({
        id: 's-140', number: 'TKT-PROP-00140', title: 'Water dispenser not cold in Floor 6 pantry',
        status: 'closed', priority: 'medium', category: 'HVAC', location: 'Floor 6, Pantry',
        raisedAt: at(6, 40), raisedBy: 'Arjun Pillai', company: 'Crescent Media', assignee: 'Ravi Kumar',
        slaDue: at(14, 40), slaHours: 8, resolvedAt: at(8, 15),
    }),
];

/** Period counts shown on the Today / Month / All switch. */
export const SAMPLE_PERIOD_COUNTS = { today: 18, month: 239, all: 12408 };

export const SAMPLE_KPIS = {
    raisedToday: 18,
    closedToday: 11,
    criticalDelta: 1,
    slaMetPct: 94,
    slaMetOnTime: 45,
    slaMetTotal: 48,
    avgFixMinutes: 204,
    avgAssignMinutes: 18,
    trend30Total: 1247,
    trend30DeltaPct: -3,
};

/** Wed to Tue. Tuesday is today and still in progress. */
export const SAMPLE_WEEK: WeekDay[] = [
    { label: 'Wed', date: '30 Sep', raised: 44, closed: 42, today: false },
    { label: 'Thu', date: '1 Oct', raised: 47, closed: 45, today: false },
    { label: 'Fri', date: '2 Oct', raised: 43, closed: 44, today: false },
    { label: 'Sat', date: '3 Oct', raised: 27, closed: 28, today: false },
    { label: 'Sun', date: '4 Oct', raised: 22, closed: 23, today: false },
    { label: 'Mon', date: '5 Oct', raised: 52, closed: 49, today: false },
    { label: 'Tue', date: '6 Oct', raised: 18, closed: 11, today: true },
];

/** 7 Sep to 6 Oct, 30 values, total 1,247, peak Mon 28 Sep at 61. */
const TREND_VALUES = [
    50, 52, 50, 47, 44, 26, 21,
    52, 53, 49, 46, 43, 28, 22,
    55, 55, 52, 48, 42, 25, 20,
    61, 53, 44, 47, 43, 27, 22, 52, 18,
];
export const SAMPLE_TREND_30 = TREND_VALUES.map((value, i) => {
    const d = new Date(2026, 8, 7 + i);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return { label: `${day} ${date}`, short: date, value, today: i === TREND_VALUES.length - 1 };
});

export const SAMPLE_CATEGORIES = [
    { name: 'HVAC', value: 405 },
    { name: 'Electrical', value: 262 },
    { name: 'Plumbing', value: 238 },
    { name: 'Housekeeping', value: 222 },
    { name: 'Lift', value: 120 },
];

export const SAMPLE_TEAM: Technician[] = [
    { id: 'tech-ravi', name: 'Ravi Kumar', initials: 'RK', skill: 'HVAC', shift: 'on_a_ticket', since: '8:02 AM', openTickets: 1 },
    { id: 'tech-amar', name: 'Amar S.', initials: 'AS', skill: 'Electrical', shift: 'free', since: '8:10 AM', openTickets: 0 },
    { id: 'tech-manju', name: 'Manju A.', initials: 'MA', skill: 'Plumbing', shift: 'on_a_ticket', since: '7:55 AM', openTickets: 3 },
    { id: 'tech-suresh', name: 'Suresh N.', initials: 'SN', skill: 'Security', shift: 'free', since: '6:00 AM', openTickets: 0 },
    { id: 'tech-imran', name: 'Imran P.', initials: 'IP', skill: 'MST', shift: 'off_shift', since: null, openTickets: 1 },
    { id: 'tech-kavya', name: 'Kavya D.', initials: 'KD', skill: 'Housekeeping', shift: 'off_shift', since: null, openTickets: 0 },
];
export const SAMPLE_ON_SHIFT = { on: 4, total: 6 };

/** Daily readings only. Never hourly. */
export const SAMPLE_ENERGY = {
    electricity: {
        todayKwh: 1284,
        yesterdayKwh: 3320,
        last14: [
            { label: '23 Sep', value: 3410 }, { label: '24 Sep', value: 3380 }, { label: '25 Sep', value: 3290 },
            { label: '26 Sep', value: 2240 }, { label: '27 Sep', value: 1980 }, { label: '28 Sep', value: 3460 },
            { label: '29 Sep', value: 3350 }, { label: '30 Sep', value: 3300 }, { label: '1 Oct', value: 3420 },
            { label: '2 Oct', value: 3270 }, { label: '3 Oct', value: 2190 }, { label: '4 Oct', value: 2010 },
            { label: '5 Oct', value: 3320 }, { label: '6 Oct', value: 1284 },
        ],
    },
    diesel: {
        usedTodayL: 42,
        generators: [
            { id: 'dg-1', name: 'DG-1', capacityL: 990, levelPct: 68 },
            { id: 'dg-2', name: 'DG-2', capacityL: 750, levelPct: 41 },
        ],
        last7: [
            { label: 'Wed', value: 58 }, { label: 'Thu', value: 36 }, { label: 'Fri', value: 64 },
            { label: 'Sat', value: 12 }, { label: 'Sun', value: 8 }, { label: 'Mon', value: 71 }, { label: 'Tue', value: 42 },
        ],
    },
    water: {
        jarsToday: 36,
        tankersToday: 2,
        last7: [
            { label: 'Wed', value: 62 }, { label: 'Thu', value: 58 }, { label: 'Fri', value: 60 },
            { label: 'Sat', value: 24 }, { label: 'Sun', value: 18 }, { label: 'Mon', value: 64 }, { label: 'Tue', value: 36 },
        ],
    },
};

const ROUND_NAMES = [
    ['Security patrol', 'Basement'], ['Washroom check', 'Floor 2'], ['DG room check', 'Basement'],
    ['Lift lobby check', 'Ground floor'], ['Pantry hygiene', 'Floor 3'], ['HVAC plant check', 'Terrace'],
    ['Parking patrol', 'Basement'], ['Washroom check', 'Floor 4'],
];

function clock(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 52 rounds: 19 due so far (every 30 min from 12:15 AM to 9:15 AM), 33 later today. */
export const SAMPLE_ROUNDS: RoundSlot[] = (() => {
    const rounds: RoundSlot[] = [];
    for (let i = 0; i < 19; i++) {
        const minutes = 15 + i * 30;
        const late = i === 18;
        const [name, floor] = late ? ['Fire safety round', 'Floor 6'] : ROUND_NAMES[i % ROUND_NAMES.length];
        rounds.push({ id: `r-${i}`, name, floor, minutes, time: clock(minutes), state: late ? 'late' : 'done' });
    }
    for (let i = 0; i < 33; i++) {
        const minutes = 600 + i * 25;
        const [name, floor] = ROUND_NAMES[(i + 3) % ROUND_NAMES.length];
        rounds.push({ id: `r-${19 + i}`, name, floor, minutes, time: clock(minutes), state: 'upcoming' });
    }
    return rounds;
})();
export const SAMPLE_ROUND_STATS = { dueSoFar: 19, doneSoFar: 18, later: 33, late: 1, lateName: 'Fire safety round', lateFloor: 'Floor 6', lateDue: '9:15 AM' };

export const SAMPLE_PLAN: PlanEvent[] = [
    { id: 'p-1', time: '8:45 AM', minutes: 525, type: 'ROUND', title: 'Washroom check', meta: 'Floor 2 · Kavya D.', state: 'done', action: 'View' },
    { id: 'p-2', time: '9:15 AM', minutes: 555, type: 'ROUND', title: 'Fire safety round', meta: 'Floor 6 · Suresh N.', state: 'late', action: 'Open' },
    { id: 'p-3', time: '10:00 AM', minutes: 600, type: 'ROUND', title: 'Security patrol', meta: 'Basement · Suresh N.', state: 'upcoming', action: 'Start' },
    { id: 'p-4', time: '11:30 AM', minutes: 690, type: 'PPM', title: 'Fire pump weekly test', meta: 'Pump room · Amar S.', state: 'upcoming', action: 'View' },
    { id: 'p-5', time: '12:30 PM', minutes: 750, type: 'ROUND', title: 'Pantry hygiene', meta: 'Floor 3 · Kavya D.', state: 'upcoming', action: 'Start' },
    { id: 'p-6', time: '2:00 PM', minutes: 840, type: 'PPM', title: 'Lift B inspection', meta: 'Lift lobby B · Lift vendor', state: 'upcoming', action: 'View' },
    { id: 'p-7', time: '4:00 PM', minutes: 960, type: 'ROUND', title: 'HVAC plant check', meta: 'Terrace · Ravi Kumar', state: 'upcoming', action: 'Start' },
];

export const SAMPLE_VISITORS = {
    onSite: 18,
    checkedInToday: 27,
    /** Visitors on site through the morning. Check-ins carry a timestamp, so hourly is real here. */
    onSiteByHour: [
        { label: '7 AM', value: 0 }, { label: '8 AM', value: 5 }, { label: '9 AM', value: 13 }, { label: '9:41 AM', value: 18 },
    ],
    recent: [
        { id: 'v-1', name: 'Anita Rao', host: 'Northwind Labs', time: '9:32 AM', purpose: 'Meeting' },
        { id: 'v-2', name: 'Karan Mehta', host: 'Bluefin Tech', time: '9:18 AM', purpose: 'Interview' },
        { id: 'v-3', name: 'Blue Dart courier', host: 'Reception', time: '9:05 AM', purpose: 'Delivery' },
    ],
};

export const SAMPLE_PPM = {
    thisWeek: 3,
    items: [
        { id: 'ppm-1', title: 'Fire pump weekly test', when: 'Today, 11:30 AM', day: 'Tue' },
        { id: 'ppm-2', title: 'Lift B inspection', when: 'Today, 2:00 PM', day: 'Tue' },
        { id: 'ppm-3', title: 'Chiller filter cleaning', when: 'Thu, 10:00 AM', day: 'Thu' },
    ],
    week: [
        { label: 'Mon', count: 0, done: 0 }, { label: 'Tue', count: 2, done: 0 }, { label: 'Wed', count: 0, done: 0 },
        { label: 'Thu', count: 1, done: 0 }, { label: 'Fri', count: 0, done: 0 }, { label: 'Sat', count: 0, done: 0 }, { label: 'Sun', count: 0, done: 0 },
    ],
};

export const SAMPLE_CAFETERIA = { todayInr: 18400, yesterdayInr: 21250 };

export const SAMPLE_STOCK = {
    lowCount: 4,
    items: [
        { id: 'st-1', name: 'LED tube 20W', qty: 6, min: 20 },
        { id: 'st-2', name: 'Hand wash 5L', qty: 2, min: 6 },
        { id: 'st-3', name: 'Tissue roll', qty: 40, min: 120 },
        { id: 'st-4', name: 'AA batteries', qty: 8, min: 24 },
    ],
};

export const SAMPLE_MATERIAL_REQUESTS = [
    { id: 'mr-42', number: 'MR-0042', title: 'Ball valve 1 inch, 2 pcs', ticket: 'TKT-PROP-00151', stage: 'Approved' as const },
    { id: 'mr-41', number: 'MR-0041', title: 'Compressor capacitor 45 µF', ticket: 'TKT-PROP-00145', stage: 'Quoted' as const },
];
export const MATERIAL_STAGES = ['Requested', 'Quoted', 'Approved', 'Ordered', 'Delivered'] as const;

/** Busiest hours for new tickets. Mon to Sun by 6 AM to 10 PM. */
export const SAMPLE_HEATMAP = (() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayWeight = [1, 0.92, 0.88, 0.9, 0.84, 0.48, 0.36];
    const hours = Array.from({ length: 17 }, (_, i) => 6 + i);
    const hourShape = (h: number) =>
        Math.exp(-((h - 11) ** 2) / 6) * 0.85 + Math.exp(-((h - 15) ** 2) / 5) + (h >= 19 ? 0.05 : 0.1);
    const rows = days.map((day, d) => ({
        day,
        cells: hours.map(h => Math.round(hourShape(h) * dayWeight[d] * 9)),
    }));
    rows[0].cells[15 - 6] = 11; // Mon 3 PM is the busiest slot
    return { hours, rows, busiest: 'Mon 3 PM' };
})();

export const SAMPLE_CHAT: ChatMessage[] = [
    { id: 'c-1', author: 'Rohan Shah', role: 'Tenant, Northwind Labs', at: '6:08 AM', text: 'Room is at 27°C already. We have a client meeting here at 11.', mine: false },
    { id: 'c-2', author: 'Priya Mehta', role: 'Property admin', at: '9:12 AM', text: '@Ravi Kumar can you check the AHU on Floor 4 first? I will move the meeting room booking if needed.', mine: true },
    { id: 'c-3', author: 'Rohan Shah', role: 'Tenant, Northwind Labs', at: '9:20 AM', text: 'Thanks. Please keep me posted.', mine: false },
];

export const SAMPLE_BUILDING_TODAY = {
    kwhToday: 1284,
    dg1Pct: 68,
    waterJars: 36,
    visitorsOnSite: 18,
    cafeteriaInr: 18400,
    lowStock: 4,
};
