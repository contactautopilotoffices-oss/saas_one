/**
 * Server-side rules added to the app's routes: reading checks and signed Plivo answer links.
 * No network, no database. Run: npx tsx --test tests/security/rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

test('readings: negatives refused everywhere; future dates and closing below opening only for one reading', async () => {
    const { checkReadings, istToday } = await import('../../backend/lib/utilities/readingRules');
    const now = Date.parse('2026-11-07T20:00:00Z'); // 01:30 on 8 Nov in India
    assert.equal(istToday(now), '2026-11-08', 'India time decides "today"');

    // A logging card: one reading.
    assert.equal(checkReadings('diesel', [{ reading_date: '2026-11-08', opening_hours: 100, closing_hours: 104, opening_kwh: 900, closing_kwh: 950 }], now), null);
    assert.match(checkReadings('diesel', [{ reading_date: '2026-11-09', closing_hours: 104 }], now)!, /future/);
    assert.match(checkReadings('diesel', [{ opening_hours: 100, closing_hours: 99 }], now)!, /cannot be less than the opening/);
    assert.equal(checkReadings('diesel', [{ opening_kwh: 900, closing_kwh: 0 }], now), null, 'a cleared field (0) is not refused, as today');
    assert.match(checkReadings('electricity', [{ opening_reading: 500, closing_reading: 400 }], now)!, /meter reading/);
    assert.match(checkReadings('water', [{ quantity: -1 }], now)!, /negative/);
    assert.match(checkReadings('diesel', [{ diesel_added_litres: 'abc' }], now)!, /must be a number/);

    // The month spreadsheet: many rows, days still to come included, keeps working.
    const month = [{ reading_date: '2026-11-07', opening_hours: 100, closing_hours: 104 }, { reading_date: '2026-11-30', opening_hours: 104 }];
    assert.equal(checkReadings('diesel', month, now), null);
    // ...but a negative number in a batch is still refused.
    assert.match(checkReadings('diesel', [...month, { opening_hours: -5 }], now)!, /negative/);
    // A CSV import row with a blank closing (sent as 0) keeps working.
    assert.equal(checkReadings('electricity', [{ opening_reading: 500, closing_reading: 0 }, { opening_reading: 10, closing_reading: 20 }], now), null);
});

test('Plivo answer links: only a link this server signed is spoken', async () => {
    const { signAnswer, verifyAnswer } = await import('../../backend/lib/voice/answerSignature');
    const sig = signAnswer('Your PPM is due today', 'Polly.Aditi', '1.0')!;
    assert.ok(sig);
    assert.equal(verifyAnswer('Your PPM is due today', 'Polly.Aditi', '1.0', sig), true);
    assert.equal(verifyAnswer('Send money to this account', 'Polly.Aditi', '1.0', sig), false, 'other text, same signature');
    assert.equal(verifyAnswer('Your PPM is due today', 'Polly.Aditi', '1.0', null), false, 'unsigned link');
    assert.equal(verifyAnswer('Your PPM is due today', 'Polly.Aditi', '1.0', 'x'), false);
});
