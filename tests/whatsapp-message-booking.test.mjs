import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBooking, parseBookingMessage } from '../backend/lib/whatsapp/assistant/booking-request.mjs';
const properties = [{ id: 'p1', name: 'SS Plaza' }];
const rooms = [{ id: 'r1', name: 'Conference Room 1' }, { id: 'r2', name: 'Conference Room 2' }];
function setup(extra = {}) {
    const bookings = [];
    return { bookings, deps: { now: () => new Date('2026-10-03T04:00:00Z'), findUser: async () => ({ id: 'u1' }),
        properties: async () => properties, rooms: async () => rooms,
        availableRooms: async () => rooms, bookRange: async request => { bookings.push(request); return { id: 'b1' }; }, ...extra } };
}
const input = text => ({ phone: '919876543210', text, messageId: 'w1', requestId: 'request-1' });
test('complete booking message resolves a real room and books once without duplicate assistant success message', async () => {
    const { deps, bookings } = setup();
    const result = await advanceBooking(input('Hey book Conference Room 1 for today from 2pm to 3pm'), null, deps);
    assert.equal(result.reply, null);
    assert.equal(result.session, null);
    assert.deepEqual(bookings[0], { userId: 'u1', propertyId: 'p1', roomId: 'r1', date: '2026-10-03', startTime: '14:00', endTime: '15:00', requestId: 'request-1' });
});
test('missing details are retained across replies and rooms are never silently selected', async () => {
    const { deps, bookings } = setup();
    let result = await advanceBooking(input('book meeting room'), null, deps);
    assert.equal(result.reply.key, 'booking_update');
    assert.match(result.reply.params[2], /date/);
    assert.match(result.reply.params[2], /room/);
    result = await advanceBooking(input('tomorrow 2 to 3 pm'), result.session, deps);
    assert.match(result.reply.params[2], /Conference Room 1/);
    assert.equal(result.session.date, '2026-10-04');
    result = await advanceBooking(input('Conference Room 2'), result.session, deps);
    assert.equal(bookings[0].roomId, 'r2');
    assert.equal(bookings[0].startTime, '14:00');
    assert.equal(bookings[0].requestId, 'request-1');
});
test('ambiguous meridiem invalid dates past times and reversed ranges do not book', async () => {
    for (const text of ['book Conference Room 1 today 2 to 3', 'book Conference Room 1 31-02-2027 2pm to 3pm',
        'book Conference Room 1 today 8am to 9am', 'book Conference Room 1 today 3pm to 2pm']) {
        const { deps, bookings } = setup();
        const result = await advanceBooking(input(text), null, deps);
        assert.equal(bookings.length, 0, text);
        assert.equal(result.reply.key, 'booking_update', text);
    }
});
test('multiple properties require explicit resolution even when room names match', async () => {
    const { deps, bookings } = setup({ properties: async () => [...properties, { id: 'p2', name: 'Other Plaza' }] });
    let result = await advanceBooking(input('book Conference Room 1 tomorrow 2pm to 3pm'), null, deps);
    assert.equal(bookings.length, 0);
    assert.match(result.reply.params[2], /property/);
    result = await advanceBooking(input('SS Plaza'), result.session, deps);
    assert.equal(bookings[0].propertyId, 'p1');
});
test('unknown room unavailable room revoked access and insufficient credits do not create a booking', async () => {
    for (const extra of [{ availableRooms: async () => [] }, { bookRange: async () => { throw Object.assign(new Error('credits'), { code: 'INSUFFICIENT_CREDITS' }); } }]) {
        const { deps } = setup(extra);
        const result = await advanceBooking(input('book Conference Room 1 tomorrow 2pm to 3pm'), null, deps);
        assert.equal(result.reply.key, 'booking_update');
    }
    const { deps, bookings } = setup();
    const unknown = await advanceBooking(input('book Imaginary Room tomorrow 2pm to 3pm'), null, deps);
    assert.equal(unknown.reply.key, 'booking_update');
    const revoked = await advanceBooking(input('2pm to 3pm'), { step: 'booking_request', id: 'old', property: { id: 'revoked', name: 'Revoked' } }, deps);
    assert.equal(revoked.reply.key, 'booking_update');
    assert.equal(bookings.length, 0);
});
test('parser supports explicit duration, 24-hour times and corrections without inventing missing times', () => {
    assert.deepEqual(parseBookingMessage('today from 14:00 to 15:30', new Date('2026-10-03T04:00Z')).times, { startTime: '14:00', endTime: '15:30' });
    assert.deepEqual(parseBookingMessage('tomorrow at 2pm for 1 hour', new Date('2026-10-03T04:00Z')).times, { startTime: '14:00', endTime: '15:00' });
    assert.equal(parseBookingMessage('Conference Room 1', new Date()).times, null);
});

test('calendar dates do not hide a later time range and individual missing times can be supplied', async () => {
    const { deps, bookings } = setup();
    assert.deepEqual(parseBookingMessage('book Conference Room 1 on 04-10-2026 2pm to 3pm', deps.now()).times, { startTime: '14:00', endTime: '15:00' });
    let result = await advanceBooking(input('book Conference Room 1 tomorrow from 2pm'), null, deps);
    assert.equal(result.session.startTime, '14:00');
    assert.match(result.reply.params[2], /end time/);
    result = await advanceBooking(input('3pm'), result.session, deps);
    assert.equal(bookings[0].endTime, '15:00');
});

test('alternative rooms or multiple time ranges require clarification rather than choosing one', async () => {
    for (const text of ['book Conference Room 1 or Boardroom tomorrow 2pm to 3pm',
        'book Conference Room 1 tomorrow 2pm to 3pm, actually 4pm to 5pm',
        'book Conference Room 1 today or tomorrow 2pm to 3pm']) {
        const { deps, bookings } = setup({ rooms: async () => [...rooms, { id: 'r3', name: 'Boardroom' }] });
        const result = await advanceBooking(input(text), null, deps);
        assert.equal(bookings.length, 0, text);
        assert.equal(result.reply.key, 'booking_update', text);
    }
});
test('an explicit unknown room correction clears the prior selected room', async () => {
    const { deps, bookings } = setup();
    let result = await advanceBooking(input('book Conference Room 1 from 2pm to 3pm'), null, deps);
    result = await advanceBooking(input('book Imaginary Room tomorrow'), result.session, deps);
    assert.equal(bookings.length, 0);
    assert.match(result.reply.params[2], /meeting room/);
});
test('retry after committed booking recognizes existing request before its own availability or past-time checks', async () => {
    let availabilityChecks = 0;
    const { deps, bookings } = setup({
        findBooking: async () => ({ id: 'b1', user_id: 'u1', property_id: 'p1' }),
        availableRooms: async () => { availabilityChecks++; return []; },
    });
    const result = await advanceBooking(input('book Conference Room 1 today 2pm to 3pm'), null, deps);
    assert.equal(result.reply, null);
    assert.equal(result.session, null);
    assert.equal(bookings.length, 0);
    assert.equal(availabilityChecks, 0);
});

test('explicit unknown property and negated booking requests cannot silently book the default property', async () => {
    for (const text of ['book Conference Room 1 at Unknown Plaza tomorrow 2pm to 3pm',
        'do not book Conference Room 1 tomorrow 2pm to 3pm']) {
        const { deps, bookings } = setup();
        await advanceBooking(input(text), null, deps);
        assert.equal(bookings.length, 0, text);
    }
});

test('multiple durations and independently mentioned nested room names are ambiguous', async () => {
    for (const text of ['book Conference Room 1 tomorrow at 2pm for 1 hour, actually at 4pm for 1 hour',
        'book Conference Room or Conference Room 1 tomorrow 2pm to 3pm']) {
        const { deps, bookings } = setup({ rooms: async () => [...rooms, { id: 'r3', name: 'Conference Room' }] });
        const result = await advanceBooking(input(text), null, deps);
        assert.equal(bookings.length, 0, text);
        assert.equal(result.reply.key, 'booking_update');
    }
});

test('enabled message booking is reached from the existing menu and rechecks user approval', async () => {
    const { advance } = await import('../backend/lib/whatsapp/assistant/engine.mjs');
    const { deps, bookings } = setup();
    const result = await advance(input('Book Conference Room 1 tomorrow 2pm to 3pm'), { step: 'menu' }, deps);
    assert.equal(result.reply, null);
    assert.equal(bookings.length, 1);
    const denied = await advanceBooking(input('Book Conference Room 1 tomorrow 2pm to 3pm'), null,
        { ...deps, findUser: async () => null });
    assert.equal(denied.reply.key, 'booking_update');
    assert.equal(bookings.length, 1);
});

test('mixed time formats cannot hide an alternative interval', async () => {
    const { deps, bookings } = setup();
    const result = await advanceBooking(input('book Conference Room 1 tomorrow 2pm to 3pm, actually at 4pm for 1 hour'), null, deps);
    assert.equal(bookings.length, 0);
    assert.equal(result.reply.key, 'booking_update');
});

test('one approved booking update campaign covers missing fields and booking failures', async () => {
    const { campaignOptions } = await import('../backend/lib/whatsapp/assistant/templates.mjs');
    const { deps } = setup();
    const missing = await advanceBooking(input('book meeting room'), null, deps);
    const unavailable = await advanceBooking(input('book Conference Room 1 tomorrow 2pm to 3pm'), null,
        { ...deps, availableRooms: async () => [] });
    for (const result of [missing, unavailable]) {
        assert.equal(result.reply.key, 'booking_update');
        assert.equal(campaignOptions('919876543210', result.reply).campaignName, 'fms_whatsapp_booking_update_v1');
        assert.equal(result.reply.params.length, 3);
    }
    assert.match(missing.reply.params[2], /date/);
    assert.match(unavailable.reply.params[1], /No room is available/);
});

test('multi-property named request asks only for date then books the selected property', async () => {
    const { deps, bookings } = setup({ properties: async () => [...properties, { id: 'p2', name: 'Other Plaza' }] });
    let result = await advanceBooking(input('hey book Conference Room 1 in SS Plaza at 2pm to 3pm'), null, deps);
    assert.equal(bookings.length, 0);
    assert.equal(result.session.property.id, 'p1');
    assert.equal(result.session.room.id, 'r1');
    assert.match(result.reply.params[2], /date/);
    assert.doesNotMatch(result.reply.params[2], /the property|the meeting room/);
    result = await advanceBooking(input('today'), result.session, deps);
    assert.equal(result.reply, null);
    assert.equal(bookings[0].propertyId, 'p1');
});

test('changing property clears the previous room and asks for a room at the new property', async () => {
    const { deps, bookings } = setup({ properties: async () => [...properties, { id: 'p2', name: 'Other Plaza' }],
        rooms: async property => property === 'p1' ? rooms : [{ id: 'r3', name: 'Boardroom' }],
        availableRooms: async property => property === 'p1' ? rooms : [{ id: 'r3', name: 'Boardroom' }] });
    let result = await advanceBooking(input('book Conference Room 1 in SS Plaza 2pm to 3pm'), null, deps);
    result = await advanceBooking(input('Other Plaza tomorrow'), result.session, deps);
    assert.equal(bookings.length, 0);
    assert.equal(result.session.property.id, 'p2');
    assert.equal(result.session.room, undefined);
    result = await advanceBooking(input('Boardroom'), result.session, deps);
    assert.equal(result.reply, null);
    assert.equal(bookings[0].roomId, 'r3');
});

test('numeric room selection uses the displayed identifiers when room ordering changes', async () => {
    let reverse = false;
    const { deps, bookings } = setup({ rooms: async () => reverse ? [...rooms].reverse() : rooms });
    const prompt = await advanceBooking(input('book meeting room tomorrow 2pm to 3pm'), null, deps);
    reverse = true;
    await advanceBooking(input('2'), prompt.session, deps);
    assert.equal(bookings[0].roomId, 'r2');
});

test('duplicate room names require a numbered selection', async () => {
    const duplicates = [{ id: 'r1', name: 'Conference Room 1' }, { id: 'r2', name: 'Conference Room 1' }];
    const { deps, bookings } = setup({ rooms: async () => duplicates, availableRooms: async () => duplicates });
    const prompt = await advanceBooking(input('book Conference Room 1 tomorrow 2pm to 3pm'), null, deps);
    assert.equal(bookings.length, 0);
    assert.match(prompt.reply.params[2], /meeting room/);
    await advanceBooking(input('2'), prompt.session, deps);
    assert.equal(bookings[0].roomId, 'r2');
});

test('a missing end time accepts an explicit 24-hour reply', async () => {
    const { deps, bookings } = setup();
    const prompt = await advanceBooking(input('book Conference Room 1 tomorrow from 14:00'), null, deps);
    await advanceBooking(input('15:30'), prompt.session, deps);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].endTime, '15:30');
});
