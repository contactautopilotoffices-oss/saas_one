import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSeatCount,
    seatBucket,
    seatRequirementText,
    isMissingColumnError,
} from '../backend/lib/crm/seatRequirement.ts';

test('parseSeatCount reads the leading number out of a free-text requirement', () => {
    assert.equal(parseSeatCount('70 workstations and 4 cabins'), 70);
    assert.equal(parseSeatCount('50'), 50);
    assert.equal(parseSeatCount('around 120 seats, 6 cabins'), 120);
    assert.equal(parseSeatCount('a few cabins'), null);
    assert.equal(parseSeatCount(''), null);
    assert.equal(parseSeatCount(null), null);
    assert.equal(parseSeatCount(undefined), null);
});

test('seatBucket matches the seats_range filter options', () => {
    assert.equal(seatBucket(10), '<25');
    assert.equal(seatBucket(50), '25–50');
    assert.equal(seatBucket(100), '50–100');
    assert.equal(seatBucket(101), '100+');
    assert.equal(seatBucket(null), null);
});

test('seatRequirementText prefers the typed text over the number', () => {
    assert.equal(
        seatRequirementText({ seats_detail: '70 workstations and 4 cabins', seats: 70 }),
        '70 workstations and 4 cabins'
    );
    assert.equal(seatRequirementText({ seats_detail: null, seats: 70 }), '70');
    assert.equal(seatRequirementText({ seats_detail: '   ', seats: 70 }), '70');
    assert.equal(seatRequirementText({ seats_detail: null, seats: null }), null);
});

test('isMissingColumnError only fires for a column the table does not have yet', () => {
    assert.equal(isMissingColumnError({ code: '42703' }, 'seats_detail'), true);
    assert.equal(
        isMissingColumnError(
            { message: "Could not find the 'seats_detail' column of 'crm_leads' in the schema cache" },
            'seats_detail'
        ),
        true
    );
    assert.equal(isMissingColumnError({ code: '23505', message: 'duplicate key' }, 'seats_detail'), false);
    assert.equal(isMissingColumnError(null, 'seats_detail'), false);
});
