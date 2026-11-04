import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRevenueReport, bookingHours, monthRange, type RevenueInput } from '../../backend/lib/meetingRooms/revenue';

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
    ...overrides,
});

const bk = (id: string, room: string, date: string, start: string, end: string, user: string | null, company: string | null) =>
    ({ id, meeting_room_id: room, booking_date: date, start_time: start, end_time: end, user_id: user, company_id: company });

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

test('individual bookers without a company use their own credit record', () => {
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
    }));
    assert.equal(report.internal.hours, 2);
    assert.equal(report.totals.internalHours, 2);
    assert.equal(report.clients.length, 1);
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
    assert.equal(report.totals.creditHours + report.totals.exceededHours, report.totals.bookedHours);
});
