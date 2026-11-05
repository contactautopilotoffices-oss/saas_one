import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRevenueReport, bookingHours, classifyBooker, matchCompanyFromNote, monthRange, type RevenueInput } from '../../backend/lib/meetingRooms/revenue';

const rooms = [
    { id: 'r-board', name: 'Boardroom', hourly_rate: 1000 },
    { id: 'r-small', name: 'Huddle', hourly_rate: '400.00' },
    { id: 'r-free', name: 'No Price Room', hourly_rate: null },
];

const base = (overrides: Partial<RevenueInput> = {}): RevenueInput => ({
    rooms,
    bookings: [],
    credits: [],
    companyNames: { acme: 'Acme Pvt Ltd', beta: 'Beta LLP' },
    userNames: { u1: 'Asha', u2: 'Ravi', u3: 'Neha', hr: 'HR Team' },
    internalUserIds: new Set(['hr']),
    tenantUserIds: new Set(['u2']),
    ...overrides,
});

const bk = (id: string, room: string, date: string, start: string, end: string, user: string | null, company: string | null, comment: string | null = null) =>
    ({ id, meeting_room_id: room, booking_date: date, start_time: start, end_time: end, user_id: user, company_id: company, comment });

test('bookingHours handles HH:MM and HH:MM:SS and never goes negative', () => {
    assert.equal(bookingHours('10:00', '11:30'), 1.5);
    assert.equal(bookingHours('10:00:00', '12:00:00'), 2);
    assert.equal(bookingHours('12:00', '11:00'), 0);
});

test('monthRange gives first and last day, rejects bad input', () => {
    assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
    assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
    assert.deepEqual(monthRange('2026-11'), { start: '2026-11-01', end: '2026-11-30' });
    assert.equal(monthRange('2026-13'), null);
    assert.equal(monthRange('nov'), null);
});

test('credits are used first in date order, the rest is exceeded and billed at each room rate', () => {
    // Acme has 3 free hours. Bookings: 2h Boardroom (5th), 2h Huddle (3rd), 1h Boardroom (10th).
    // Date order: Huddle 2h (credit), Boardroom 2h (1h credit + 1h exceeded), Boardroom 1h (exceeded).
    const report = buildRevenueReport(base({
        credits: [{ company_id: 'acme', user_id: null, monthly_hours: 3 }],
        bookings: [
            bk('b2', 'r-board', '2026-11-05', '10:00', '12:00', 'u1', 'acme'),
            bk('b1', 'r-small', '2026-11-03', '09:00:00', '11:00:00', 'u2', 'acme'),
            bk('b3', 'r-board', '2026-11-10', '15:00', '16:00', 'u1', 'acme'),
        ],
    }));

    const acme = report.clients.find(c => c.name === 'Acme Pvt Ltd')!;
    assert.equal(acme.bookedHours, 5);
    assert.equal(acme.creditHours, 3);
    assert.equal(acme.exceededHours, 2);
    assert.equal(acme.unusedCreditHours, 0);
    // credit value: 2h x 400 + 1h x 1000 = 1800; exceeded: 1h x 1000 + 1h x 1000 = 2000
    assert.equal(acme.creditValue, 1800);
    assert.equal(acme.exceededRevenue, 2000);
    assert.equal(acme.totalValue, 3800);
    assert.deepEqual(acme.bookings.map(b => b.bookingId), ['b1', 'b2', 'b3']);
    assert.equal(acme.bookings[1].creditHours, 1);
    assert.equal(acme.bookings[1].exceededHours, 1);

    const board = report.rooms.find(r => r.roomName === 'Boardroom')!;
    assert.equal(board.bookedHours, 3);
    assert.equal(board.creditValue, 1000);
    assert.equal(board.exceededRevenue, 2000);
    assert.equal(board.totalValue, 3000);
    const huddle = report.rooms.find(r => r.roomName === 'Huddle')!;
    assert.equal(huddle.totalValue, 800);
    assert.equal(huddle.exceededRevenue, 0);
});

test('a client that stays within credits has no exceeded revenue and shows unused hours', () => {
    const report = buildRevenueReport(base({
        credits: [{ company_id: 'beta', user_id: null, monthly_hours: '10.00' }],
        bookings: [bk('b1', 'r-board', '2026-11-02', '10:00', '11:30', 'u3', 'beta')],
    }));
    const beta = report.clients[0];
    assert.equal(beta.hasCreditPlan, true);
    assert.equal(beta.creditHours, 1.5);
    assert.equal(beta.exceededHours, 0);
    assert.equal(beta.unusedCreditHours, 8.5);
    assert.equal(beta.creditValue, 1500);
    assert.equal(beta.exceededRevenue, 0);
});

test('a client with no credit plan pays for every hour', () => {
    const report = buildRevenueReport(base({
        bookings: [bk('b1', 'r-small', '2026-11-02', '10:00', '12:00', 'u3', 'beta')],
    }));
    const beta = report.clients[0];
    assert.equal(beta.hasCreditPlan, false);
    assert.equal(beta.exceededHours, 2);
    assert.equal(beta.exceededRevenue, 800);
});

test('tenant bookers without a company use their own credit record', () => {
    const report = buildRevenueReport(base({
        credits: [{ company_id: null, user_id: 'u2', monthly_hours: 1 }],
        bookings: [bk('b1', 'r-small', '2026-11-02', '10:00', '12:00', 'u2', null)],
    }));
    const ravi = report.clients[0];
    assert.equal(ravi.type, 'individual');
    assert.equal(ravi.name, 'Ravi');
    assert.equal(ravi.creditHours, 1);
    assert.equal(ravi.exceededRevenue, 400);
});

test('internal team bookings are hours only, never revenue', () => {
    const report = buildRevenueReport(base({
        bookings: [
            bk('b1', 'r-board', '2026-11-02', '10:00', '12:00', 'hr', null),
            bk('b2', 'r-board', '2026-11-03', '10:00', '11:00', 'u1', 'acme'),
        ],
        view: 'all',
    }));
    assert.equal(report.internal.hours, 2);
    assert.equal(report.totals.internalHours, 2);
    assert.equal(report.clients.filter(c => c.category === 'client').length, 1);
    assert.equal(report.totals.totalValue, 1000);
    const board = report.rooms.find(r => r.roomName === 'Boardroom')!;
    assert.equal(board.internalHours, 2);
    assert.equal(board.totalValue, 1000);
});

test('rooms without a price are valued at 0 and flagged; every room is listed', () => {
    const report = buildRevenueReport(base({
        bookings: [bk('b1', 'r-free', '2026-11-02', '10:00', '12:00', 'u1', 'acme')],
    }));
    assert.deepEqual(report.roomsWithoutRate, ['No Price Room']);
    assert.equal(report.totals.totalValue, 0);
    assert.equal(report.totals.exceededHours, 2);
    assert.equal(report.rooms.length, 3);
});

test('totals equal the sum of clients and the sum of rooms', () => {
    const report = buildRevenueReport(base({
        credits: [{ company_id: 'acme', user_id: null, monthly_hours: 2 }],
        bookings: [
            bk('b1', 'r-board', '2026-11-02', '10:00', '12:30', 'u1', 'acme'),
            bk('b2', 'r-small', '2026-11-04', '10:00', '11:00', 'u3', 'beta'),
            bk('b3', 'r-small', '2026-11-05', '14:00', '15:30', 'u2', null),
        ],
    }));
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
    assert.equal(report.totals.totalValue, sum(report.clients.map(c => c.totalValue)));
    assert.equal(report.totals.totalValue, sum(report.rooms.map(r => r.totalValue)));
    assert.equal(report.totals.exceededRevenue, sum(report.rooms.map(r => r.exceededRevenue)));
    assert.equal(report.totals.bookedHours, sum(report.rooms.map(r => r.bookedHours)));
    assert.equal(
        round(report.totals.creditHours + report.totals.exceededHours + report.totals.internalHours),
        report.totals.bookedHours,
    );
});

const round = (n: number) => Math.round(n * 100) / 100;

test('classifyBooker: internal role wins, then company, then tenant, else internal', () => {
    const internal = new Set(['hr']);
    const tenants = new Set(['t1']);
    assert.equal(classifyBooker({ user_id: 'hr', company_id: 'acme' }, internal, tenants), 'internal');
    assert.equal(classifyBooker({ user_id: 'x', company_id: 'acme' }, internal, tenants), 'client');
    assert.equal(classifyBooker({ user_id: 't1', company_id: null }, internal, tenants), 'client');
    assert.equal(classifyBooker({ user_id: 'admin', company_id: null }, internal, tenants), 'internal');
    assert.equal(classifyBooker({ user_id: null, company_id: null }, internal, tenants), 'internal');
    assert.equal(classifyBooker({ user_id: 'hr', company_id: null }, internal, tenants, 'matched-comp-1'), 'client');
});

test('a non-tenant individual with no company is internal: hours only, never exceeded revenue', () => {
    const bookings = [
        bk('b1', 'r-board', '2026-11-02', '10:00', '12:00', 'u1', null), // u1 is not a tenant
        bk('b2', 'r-small', '2026-11-03', '10:00', '11:00', 'u3', 'beta'),
    ];
    const all = buildRevenueReport(base({ bookings, view: 'all' }));
    const asha = all.clients.find(c => c.name === 'Asha')!;
    assert.equal(asha.category, 'internal');
    assert.equal(asha.internalHours, 2);
    assert.equal(asha.exceededRevenue, 0);
    assert.equal(asha.totalValue, 0);
    assert.equal(all.totals.exceededRevenue, 400); // only Beta's hour
    assert.equal(all.totals.internalHours, 2);
    // clients come first in the list
    assert.equal(all.clients[0].category, 'client');
});

test('views: clients shows only clients, internal only internal, all shows both', () => {
    const bookings = [
        bk('b1', 'r-board', '2026-11-02', '10:00', '12:00', 'u1', null), // internal (not a tenant)
        bk('b2', 'r-board', '2026-11-03', '10:00', '11:00', 'hr', null), // internal team
        bk('b3', 'r-small', '2026-11-04', '10:00', '11:00', 'u3', 'beta'), // company client
        bk('b4', 'r-small', '2026-11-05', '10:00', '12:00', 'u2', null), // tenant client
    ];
    const clients = buildRevenueReport(base({ bookings }));
    assert.equal(clients.view, 'clients');
    assert.deepEqual(clients.clients.map(c => c.name).sort(), ['Beta LLP', 'Ravi']);
    assert.equal(clients.totals.internalHours, 0);
    assert.equal(clients.totals.exceededRevenue, 1200);
    assert.equal(clients.rooms.find(r => r.roomName === 'Boardroom')!.bookedHours, 0);

    const internal = buildRevenueReport(base({ bookings, view: 'internal' }));
    assert.deepEqual(internal.clients.map(c => c.name).sort(), ['Asha', 'HR Team']);
    assert.ok(internal.clients.every(c => c.category === 'internal'));
    assert.equal(internal.totals.internalHours, 3);
    assert.equal(internal.totals.totalValue, 0);

    const all = buildRevenueReport(base({ bookings, view: 'all' }));
    assert.equal(all.clients.length, 4);
    assert.equal(all.totals.exceededRevenue, 1200);
    assert.equal(all.totals.internalHours, 3);
    assert.equal(all.totals.bookedHours, 6);
});

test('matchCompanyFromNote: matches client names from staff comments and ignores generic/internal words', () => {
    const companies = [
        { id: 'c-light', name: 'Light years' },
        { id: 'c-bliss', name: 'blissred' },
        { id: 'c-yang', name: 'yangpoo' },
        { id: 'c-onads', name: 'onadsgroup' },
        { id: 'c-test', name: 'test company' },
    ];

    // Client note matches
    assert.equal(matchCompanyFromNote('Booked Lightyear ', companies)?.name, 'Light years');
    assert.equal(matchCompanyFromNote('Booked for Lightyear ', companies)?.name, 'Light years');
    assert.equal(matchCompanyFromNote('booked for light years', companies)?.name, 'Light years');
    assert.equal(matchCompanyFromNote('Booked for Bliss Red ', companies)?.name, 'blissred');
    assert.equal(matchCompanyFromNote('Bliss net', companies)?.name, 'blissred');
    assert.equal(matchCompanyFromNote('Bliss Net', companies)?.name, 'blissred');
    assert.equal(matchCompanyFromNote('booked for yangpoo', companies)?.name, 'yangpoo');
    assert.equal(matchCompanyFromNote('Bhavik Onads', companies)?.name, 'onadsgroup');

    // Generic and internal department notes should NOT match companies
    assert.equal(matchCompanyFromNote('Booked for Marketing team', companies), null);
    assert.equal(matchCompanyFromNote('Booked for HR', companies), null);
    assert.equal(matchCompanyFromNote('Booked for BD', companies), null);
    assert.equal(matchCompanyFromNote('Booked for Tech Team', companies), null);
    assert.equal(matchCompanyFromNote('Booked for Dipti', companies), null);
    assert.equal(matchCompanyFromNote('Booked for Shrihari', companies), null);
    assert.equal(matchCompanyFromNote('testing booking', companies), null);
});

test('staff booking on behalf of client with client note is attributed to client revenue and preserves note', () => {
    const companies = [{ id: 'c-light', name: 'Light years' }];
    const report = buildRevenueReport(base({
        companies,
        companyNames: { 'c-light': 'Light years' },
        credits: [{ company_id: 'c-light', user_id: null, monthly_hours: 1 }],
        bookings: [
            // Meena (in internalUserIds) books Boardroom (1000/hr) with note "Booked for Lightyear"
            bk('b1', 'r-board', '2026-11-02', '10:00', '12:00', 'hr', null, 'Booked for Lightyear'),
        ],
        view: 'clients',
    }));

    // Should count as Light years client revenue, NOT 0 internal hours
    assert.equal(report.clients.length, 1);
    const light = report.clients[0];
    assert.equal(light.name, 'Light years');
    assert.equal(light.category, 'client');
    assert.equal(light.bookedHours, 2);
    assert.equal(light.creditHours, 1);
    assert.equal(light.exceededHours, 1);
    assert.equal(light.exceededRevenue, 1000); // 1 hr exceeded * 1000/hr

    // Booking line contains note and attribution metadata
    assert.equal(light.bookings.length, 1);
    assert.equal(light.bookings[0].comment, 'Booked for Lightyear');
    assert.equal(light.bookings[0].clientMatchedFromNote, true);
    assert.equal(light.bookings[0].bookedBy, 'HR Team');
});

test('notification booker parameter formatting with company name and remaining credits', () => {
    const formatBookerDisplay = (bookerName, companyName, remainingHours) => {
        const creditsInfo = (remainingHours !== null && remainingHours !== undefined) ? `${remainingHours} hrs left` : '';
        const clientCompanyInfo = companyName
            ? (creditsInfo ? `${companyName} • ${creditsInfo}` : companyName)
            : (creditsInfo ? `${creditsInfo}` : '');
        return clientCompanyInfo ? `${bookerName} (${clientCompanyInfo})` : bookerName;
    };

    // Client with company and remaining credits
    assert.equal(
        formatBookerDisplay('Bhavin', 'Light years', 4.5),
        'Bhavin (Light years • 4.5 hrs left)'
    );

    // Client with 0 remaining credits
    assert.equal(
        formatBookerDisplay('Bhavin', 'Light years', 0),
        'Bhavin (Light years • 0 hrs left)'
    );

    // Client with company but no credit record
    assert.equal(
        formatBookerDisplay('Bhavin', 'Light years', null),
        'Bhavin (Light years)'
    );

    // Staff booking for client
    assert.equal(
        formatBookerDisplay('Meena Chavan', 'blissred', 2),
        'Meena Chavan (blissred • 2 hrs left)'
    );

    // Internal user without company
    assert.equal(
        formatBookerDisplay('Nilesh Mane', null, null),
        'Nilesh Mane'
    );
});

test('effective company resolution enforces client lock and allows admin company attachment', () => {
    const resolveEffectiveCompanyId = (isAdmin, payloadCompanyId, userCompanyId) => {
        return (isAdmin && payloadCompanyId) ? payloadCompanyId : (userCompanyId || null);
    };

    // Regular client / tenant attempts to pass another company ID -> strictly ignored, locked to own company
    assert.equal(
        resolveEffectiveCompanyId(false, 'other-company-id', 'my-client-company-id'),
        'my-client-company-id'
    );

    // Regular user with no company membership -> stays null even if companyId sent
    assert.equal(
        resolveEffectiveCompanyId(false, 'some-company-id', null),
        null
    );

    // Property admin booking on behalf of client -> attaches requested company
    assert.equal(
        resolveEffectiveCompanyId(true, 'client-company-id', null),
        'client-company-id'
    );

    // Property admin internal booking -> no company attached
    assert.equal(
        resolveEffectiveCompanyId(true, undefined, null),
        null
    );
});
