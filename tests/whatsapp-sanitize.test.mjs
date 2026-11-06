import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWhatsAppParam, sanitizeWhatsAppParams } from '../backend/lib/whatsapp/sanitize.ts';

test('sanitizeWhatsAppParam strips newlines and carriage returns', () => {
    const input = '7th Floor- IO port in HDFC LWCC process needs to be fixed.\nPort no-93';
    const result = sanitizeWhatsAppParam(input);
    assert.equal(result, '7th Floor- IO port in HDFC LWCC process needs to be fixed. Port no-93');
    assert.equal(result.includes('\n'), false);
    assert.equal(result.includes('\r'), false);
});

test('sanitizeWhatsAppParam collapses multiple consecutive newlines and spaces', () => {
    const input = 'Kindly fix the all damaged porter in titan process \n\n';
    const result = sanitizeWhatsAppParam(input);
    assert.equal(result, 'Kindly fix the all damaged porter in titan process');
});

test('sanitizeWhatsAppParam cleans tabs and trailing whitespace', () => {
    const input = '  @Bms Team door \t not locking properly \n rectify it   ';
    const result = sanitizeWhatsAppParam(input);
    assert.equal(result, '@Bms Team door not locking properly rectify it');
});

test('sanitizeWhatsAppParam handles null, undefined, and empty string', () => {
    assert.equal(sanitizeWhatsAppParam(null), 'N/A');
    assert.equal(sanitizeWhatsAppParam(undefined), 'N/A');
    assert.equal(sanitizeWhatsAppParam(''), 'N/A');
    assert.equal(sanitizeWhatsAppParam('   '), 'N/A');
    assert.equal(sanitizeWhatsAppParam('\n\r\t'), 'N/A');
});

test('sanitizeWhatsAppParam formats priority cleanly', () => {
    assert.equal(sanitizeWhatsAppParam('1', 'priority'), 'Low');
    assert.equal(sanitizeWhatsAppParam('low', 'priority'), 'Low');
    assert.equal(sanitizeWhatsAppParam('2', 'priority'), 'Medium');
    assert.equal(sanitizeWhatsAppParam('medium', 'priority'), 'Medium');
    assert.equal(sanitizeWhatsAppParam('3', 'priority'), 'High');
    assert.equal(sanitizeWhatsAppParam('high', 'priority'), 'High');
    assert.equal(sanitizeWhatsAppParam('4', 'priority'), 'Urgent');
    assert.equal(sanitizeWhatsAppParam('critical', 'priority'), 'Urgent');
    assert.equal(sanitizeWhatsAppParam('urgent', 'priority'), 'Urgent');
});

test('sanitizeWhatsAppParams processes array of parameters', () => {
    const params = [
        'Godwin Gabriel ',
        'TKT-1791776205553',
        'Kindly fix the all damaged porter in titan process \n\n',
        'SS Plaza',
        'Naveenachari B S'
    ];
    const sanitized = sanitizeWhatsAppParams(params);
    assert.deepEqual(sanitized, [
        'Godwin Gabriel',
        'TKT-1791776205553',
        'Kindly fix the all damaged porter in titan process',
        'SS Plaza',
        'Naveenachari B S'
    ]);
});

test('sanitizeWhatsAppParam handles missing phone numbers gracefully with Not Available', () => {
    assert.equal(sanitizeWhatsAppParam(null, 'raised_by_phone'), 'Not Available');
    assert.equal(sanitizeWhatsAppParam(undefined, 'assigned_to_phone'), 'Not Available');
    assert.equal(sanitizeWhatsAppParam('', 'requester_phone'), 'Not Available');
    assert.equal(sanitizeWhatsAppParam('N/A', 'raised_by_phone'), 'Not Available');
    assert.equal(sanitizeWhatsAppParam('n/a', 'assigned_to_phone'), 'Not Available');
    assert.equal(sanitizeWhatsAppParam('  9876543210  ', 'raised_by_phone'), '9876543210');
});
