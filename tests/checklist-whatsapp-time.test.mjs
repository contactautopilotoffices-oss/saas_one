import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWhatsAppTime } from '../backend/services/WhatsAppEventProcessor.ts';

test('formatWhatsAppTime formats UTC timestamps into Indian Standard Time (IST)', () => {
    // 07:30 UTC corresponds to 13:00 IST (01:00 PM)
    const utcDateStr = '2026-10-27T07:30:00.000Z';
    const formatted = formatWhatsAppTime(utcDateStr);
    
    // Check that hour is 01, minute is 00, and period is PM
    assert.match(formatted, /01:00\s*(pm|PM)/i, `Expected ~01:00 PM but got ${formatted}`);
});

test('formatWhatsAppTime handles midnight shift crossover correctly', () => {
    // 19:15 UTC corresponds to 00:45 IST next day (12:45 AM)
    const utcDateStr = '2026-10-27T19:15:00.000Z';
    const formatted = formatWhatsAppTime(utcDateStr);
    
    assert.match(formatted, /12:45\s*(am|AM)/i, `Expected ~12:45 AM but got ${formatted}`);
});

test('formatWhatsAppTime returns empty string for empty input', () => {
    assert.equal(formatWhatsAppTime(null), '');
    assert.equal(formatWhatsAppTime(undefined), '');
});
