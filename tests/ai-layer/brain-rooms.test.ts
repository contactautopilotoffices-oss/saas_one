// 2026-11-18: meeting rooms end to end, from the owner's chats ("What time is it next available?", "What meeting rooms
// are available?", a property with no rooms answered three times the same way) and the full cycle: list, free times,
// book, cancel, move. No database, no model key, no network and no WhatsApp: every dependency below is a fake.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runTurn, type TurnOutput } from '../../backend/lib/aiLayer/brain/loop/turn';
import { freeWindows } from '../../backend/lib/aiLayer/brain/skills/rooms';
import { ANDHERI, FakeAudit, FakeBrainData, PAREL, ROOM_A, ROOM_B, THANE, ScriptedModel, actor, call, turnDeps, turnInput } from './brain-helpers';

const BOOKING = 'b0000000-0000-4000-8000-000000000001';
const three = () => actor({ propertyIds: [ANDHERI, PAREL, THANE], propertyNames: { [ANDHERI]: 'Work Square Andheri', [PAREL]: 'VFS Lower Parel', [THANE]: 'Thane One' } });
const withBooking = (data = new FakeBrainData()) => {
    data.bookings.push({ id: BOOKING, roomName: 'Board Room', roomId: ROOM_A, propertyId: ANDHERI, date: '2026-11-05', startTime: '15:00:00', endTime: '16:00:00', status: 'confirmed' });
    return data;
};
const next = (data: FakeBrainData, audit: FakeAudit, steps: ConstructorParameters<typeof ScriptedModel>[0], text: string, prev: TurnOutput | null, over = {}) =>
    runTurn(turnDeps(data, new ScriptedModel(steps), audit), turnInput(text, { state: prev?.state ?? null, ...over }));

describe('which rooms there are', () => {
    it('lists the rooms with seats and location', async () => {
        const data = new FakeBrainData();
        data.rooms = [{ id: ROOM_A, name: 'Board Room', propertyId: ANDHERI, capacity: 12, location: '4th floor' }, { id: ROOM_B, name: 'Huddle 2', propertyId: ANDHERI, capacity: 4, location: null }];
        const model = new ScriptedModel([call('rooms_list', { property: null }), 'Board Room (12 seats, 4th floor) and Huddle 2 (4 seats).']);
        const out = await runTurn(turnDeps(data, model), turnInput('What meeting rooms are available?'));
        assert.match(model.toolResults()[0], /R1 \| Board Room, seats 12, 4th floor\nR2 \| Huddle 2, seats 4/);
        assert.equal(out.trace.grounded, true);
    });

    it('a property with no rooms says where the person CAN book, instead of a dead end', async () => {
        const data = new FakeBrainData();
        data.rooms = [{ id: ROOM_A, name: 'Board Room', propertyId: PAREL }];
        const model = new ScriptedModel([call('rooms_list', { property: 'Andheri' }), 'x']);
        await runTurn(turnDeps(data, model), turnInput('rooms at andheri?', { actor: three() }));
        assert.match(model.toolResults()[0], /Work Square Andheri has no meeting rooms set up in the app\. Your properties that have rooms: VFS Lower Parel\./);
    });
});

describe('which property, for rooms', () => {
    it('several properties but only one with rooms: that one is used without asking', async () => {
        const data = new FakeBrainData();
        data.rooms = [{ id: ROOM_A, name: 'Board Room', propertyId: THANE }];
        const model = new ScriptedModel([call('rooms_list', { property: null }), 'Thane One has the Board Room.']);
        await runTurn(turnDeps(data, model), turnInput('which meeting rooms are there', { actor: three() }));
        assert.match(model.toolResults()[0], /Meeting rooms at Thane One/);
    });

    it('several with rooms: the question offers only those', async () => {
        const data = new FakeBrainData();
        data.rooms = [{ id: ROOM_A, name: 'Board Room', propertyId: THANE }, { id: ROOM_B, name: 'Huddle 2', propertyId: PAREL }];
        const model = new ScriptedModel([call('rooms_list', { property: null }), call('ask_user', { question: 'Which property?', options: ['VFS Lower Parel', 'Thane One'] })]);
        const out = await runTurn(turnDeps(data, model), turnInput('show meeting rooms', { actor: three() }));
        assert.match(model.toolResults()[0], /options \(the person's properties that have meeting rooms\): VFS Lower Parel \| Thane One$/);
        assert.doesNotMatch(model.toolResults()[0], /Andheri/);
        assert.equal(out.outcome, 'ask');
    });

    it('none of them has rooms: said plainly, with no question', async () => {
        const data = new FakeBrainData(); data.rooms = [];
        const model = new ScriptedModel([call('rooms_list', { property: null }), 'None of your properties has meeting rooms set up.']);
        await runTurn(turnDeps(data, model), turnInput('book a room', { actor: three() }));
        assert.match(model.toolResults()[0], /None of this person's properties has meeting rooms set up in the app\. Say so plainly/);
    });
});

describe('when rooms are free', () => {
    it('"What time is it next available?": free times per room, joined into windows', async () => {
        const data = new FakeBrainData();
        data.freeSlots.set(ROOM_A, [{ start: '14:00', end: '15:00' }, { start: '15:00', end: '16:00' }, { start: '17:00', end: '18:00' }]);
        data.taken.add(ROOM_B);
        const model = new ScriptedModel([call('rooms_free_slots', { property: null, room: null, date: '2026-11-04' }), 'The Board Room is free today from 14:00 to 16:00 and 17:00 to 18:00. Huddle 2 is fully booked.']);
        const out = await runTurn(turnDeps(data, model), turnInput('What time is it next available?'));
        assert.match(model.toolResults()[0], /R1 \| Board Room: 14:00 to 16:00, 17:00 to 18:00\nR2 \| Huddle 2: fully booked/);
        assert.equal(out.trace.grounded, true);
    });

    it('one room asked by name; a fully booked day says so', async () => {
        const data = new FakeBrainData(); data.taken.add(ROOM_A); data.taken.add(ROOM_B);
        const model = new ScriptedModel([call('rooms_free_slots', { property: null, room: 'board room', date: '2026-11-05' }), 'x']);
        await runTurn(turnDeps(data, model), turnInput('when is the board room free tomorrow'));
        assert.match(model.toolResults()[0], /Nothing is free at Work Square Andheri on Thu 5 Nov \(2026-11-05\) in Board Room/);
    });

    it('joins touching slots only', () => {
        assert.deepEqual(freeWindows([{ start: '11:00', end: '12:00' }, { start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }, { start: '13:00', end: '14:00' }]),
            [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '14:00' }]);
    });
});

describe('cancelling the person\'s own booking', () => {
    it('look up, card, Yes: cancelled through the app\'s cancel, once', async () => {
        const data = withBooking(); const audit = new FakeAudit();
        const card = await next(data, audit, [call('rooms_my_bookings', { property: null }), call('room_cancel', { booking: 'B1' })], 'cancel my board room booking tomorrow', null);
        assert.equal(card.outcome, 'propose');
        assert.match(card.reply!.text, /Cancel this booking\?\n🏢 Board Room, Work Square Andheri\n🗓️ Thu 5 Nov, 15:00 to 16:00/);
        assert.deepEqual(data.cancelled, [], 'nothing cancelled before Yes');
        const yes = await next(data, audit, [], 'yes', card);
        assert.equal(yes.outcome, 'executed');
        assert.deepEqual(data.cancelled, [BOOKING]);
        assert.match(yes.reply!.text, /✅ Cancelled your booking: Board Room, Thu 5 Nov, 15:00 to 16:00\. Any credits used for it are refunded\./);
        const again = await next(data, audit, [], 'yes', yes);
        assert.equal(data.cancelled.length, 1, 'a second yes does nothing');
        assert.notEqual(again.outcome, 'executed');
    });

    it('a booking that already started, or a made-up handle, is never offered for cancelling', async () => {
        const data = withBooking();
        data.bookings[0].date = '2026-11-04'; data.bookings[0].startTime = '11:00:00'; data.bookings[0].endTime = '13:00:00'; // 12:00 now: under way
        const model = new ScriptedModel([call('rooms_my_bookings', { property: null }), call('room_cancel', { booking: 'B1' }), call('room_cancel', { booking: 'B7' }), 'It has already started.']);
        const out = await runTurn(turnDeps(data, model), turnInput('cancel my booking'));
        const results = model.toolResults();
        assert.match(results[1], /already started or is over/);
        assert.match(results[2], /"B7" is not a booking handle from this conversation/);
        assert.equal(out.outcome, 'answer');
    });

    it('what the app\'s cancel says is passed on in plain words', async () => {
        const data = withBooking(); const audit = new FakeAudit();
        const card = await next(data, audit, [call('rooms_my_bookings', { property: null }), call('room_cancel', { booking: 'B1' })], 'cancel it', null);
        data.failCancel = 'started';
        const yes = await next(data, audit, [], 'yes', card);
        assert.equal(yes.outcome, 'not_executed');
        assert.match(yes.reply!.text, /already started or is over, so it cannot be cancelled/);
    });
});

describe('moving the person\'s own booking', () => {
    const moveTo = (start: string, end: string, room: string | null = null) => call('room_move', { booking: 'B1', room, date: '2026-11-05', start_time: start, end_time: end });

    it('books the new time first, then cancels the old one', async () => {
        const data = withBooking(); const audit = new FakeAudit();
        const card = await next(data, audit, [call('rooms_my_bookings', { property: null }), moveTo('17:00', '18:00')], 'move my board room booking tomorrow to 5 pm', null);
        assert.match(card.reply!.text, /Move this booking\?\n🔁 From: Board Room, Work Square Andheri, Thu 5 Nov 15:00 to 16:00\n➡️ To: Board Room, Work Square Andheri, Thu 5 Nov 17:00 to 18:00/);
        const yes = await next(data, audit, [], 'yes', card);
        assert.equal(yes.outcome, 'executed');
        assert.deepEqual(data.booked.map(b => `${b.roomId === ROOM_A ? 'A' : 'B'} ${b.startTime}`), ['A 17:00']);
        assert.deepEqual(data.cancelled, [BOOKING]);
        assert.match(yes.reply!.text, /✅ Moved\. Your booking is now Board Room, Work Square Andheri, Thu 5 Nov 17:00 to 18:00, and the old one is cancelled\./);
    });

    it('not enough credits for the new time: nothing changes, and the person is told how to do it', async () => {
        const data = withBooking(); const audit = new FakeAudit();
        const card = await next(data, audit, [call('rooms_my_bookings', { property: null }), moveTo('17:00', '18:00')], 'move it to 5', null);
        data.failBooking = 'INSUFFICIENT_CREDITS';
        const yes = await next(data, audit, [], 'yes', card);
        assert.equal(yes.outcome, 'not_executed');
        assert.deepEqual(data.cancelled, [], 'the old booking is kept');
        assert.match(yes.reply!.text, /Nothing was changed\. Cancel the old booking first, then book the new time\./);
    });

    it('the new booking is made but the old one cannot be cancelled: said plainly, never "moved"', async () => {
        const data = withBooking(); const audit = new FakeAudit();
        const card = await next(data, audit, [call('rooms_my_bookings', { property: null }), moveTo('17:00', '18:00', 'Huddle 2')], 'move it to huddle 2 at 5', null);
        data.failCancel = 'failed';
        const yes = await next(data, audit, [], 'yes', card);
        assert.match(yes.reply!.text, /⚠️ Your new booking is made \(Huddle 2[^)]*\), but the old one \(Board Room[^)]*\) could not be cancelled\. Please cancel it in the app/);
        assert.doesNotMatch(yes.reply!.text, /✅ Moved/);
    });

    it('a new time overlapping the old one in the same room, or the very same time, is refused before any card', async () => {
        const data = withBooking();
        const model = new ScriptedModel([call('rooms_my_bookings', { property: null }), moveTo('15:30', '16:30'), moveTo('15:00', '16:00'), 'x']);
        await runTurn(turnDeps(data, model), turnInput('push my booking by half an hour'));
        const results = model.toolResults();
        assert.match(results[1], /overlaps the booking being moved/);
        assert.match(results[2], /already booked for/);
        assert.equal(data.booked.length, 0);
    });
});
