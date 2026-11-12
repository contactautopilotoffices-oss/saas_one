import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from '../petty-cash/load-ts.mjs';

const R = loadTs('backend/lib/aop/bountyRules.ts');
const ist = (s) => new Date(new Date(s + '+05:30').toISOString());

test('months are worked out in IST, where the team lives', () => {
    assert.equal(R.monthOf(ist('2026-10-31T23:30:00')), '2026-10-01');
    assert.equal(R.monthOf(new Date('2026-10-31T19:30:00Z')), '2026-11-01', '1 am IST on the 1st is November');
    assert.equal(R.prevMonth('2026-01-01'), '2025-12-01');
    assert.equal(R.prevMonth('2026-10-01', 2), '2026-08-01');
    assert.equal(R.prevMonth('2026-10-01', -1), '2026-11-01');
});

test('the expected day and the month end are real instants; day 31 in a short month is the last day', () => {
    assert.equal(R.dayInMonth('2026-10-01', 23).toISOString(), ist('2026-10-23T23:59:59').toISOString());
    assert.equal(R.dayInMonth('2026-11-01', 31).toISOString(), ist('2026-11-30T23:59:59').toISOString());
    assert.equal(R.monthEnd('2026-02-01').toISOString(), ist('2026-02-28T23:59:59').toISOString());
});

test('a cell waits quietly before its expected day, then opens; no expected day means open at once', () => {
    const t1 = R.timingFor('2026-10-01', 23, ist('2026-10-10T09:00:00'));
    assert.equal(t1.status, 'waiting');
    const t2 = R.timingFor('2026-10-01', 23, ist('2026-10-24T09:00:00'));
    assert.equal(t2.status, 'open');
    assert.equal(R.timingFor('2026-10-01', null, ist('2026-10-02T09:00:00')).status, 'open');
    assert.equal(t1.due_at.toISOString(), R.monthEnd('2026-10-01').toISOString());
});

test('Trinity every 60 days: a bill is expected only on the right months', () => {
    assert.equal(R.expectedThisMonth('2026-10-01', 2, '2026-08-01'), true, 'Aug, Oct, Dec');
    assert.equal(R.expectedThisMonth('2026-11-01', 2, '2026-08-01'), false);
    assert.equal(R.expectedThisMonth('2026-12-01', 2, '2026-08-01'), true);
    assert.equal(R.expectedThisMonth('2026-10-01', 3, '2026-04-01'), true, 'quarterly from April: Apr, Jul, Oct');
    assert.equal(R.expectedThisMonth('2026-09-01', 3, '2026-04-01'), false);
    assert.equal(R.expectedThisMonth('2026-10-01', 1, null), true, 'monthly needs no anchor');
    assert.equal(R.expectedThisMonth('2026-10-01', 2, null), true, 'cadence known but not its start: ask rather than skip');
    assert.equal(R.expectedThisMonth('2026-10-01', 0, null), false, 'not recurring');
});

test('urgency: late is red, a waiting decision is amber, far-off is grey, done is done', () => {
    const now = ist('2026-10-23T12:00:00');
    assert.equal(R.urgency({ kind: 'actual', status: 'open', due_at: ist('2026-10-20T23:59:59') }, now), 'late');
    assert.equal(R.urgency({ kind: 'decision', status: 'open', due_at: ist('2026-10-31T23:59:59') }, now), 'soon');
    assert.equal(R.urgency({ kind: 'actual', status: 'open', due_at: ist('2026-10-25T23:59:59') }, now), 'soon', 'within 3 days');
    assert.equal(R.urgency({ kind: 'actual', status: 'open', due_at: ist('2026-10-31T23:59:59') }, now), 'normal');
    assert.equal(R.urgency({ kind: 'actual', status: 'answered', due_at: ist('2026-10-01T00:00:00') }, now), 'done');
    assert.equal(R.isOverdue({ status: 'closed', due_at: ist('2026-10-01T00:00:00') }, now), false, 'closed is never overdue');
});

test('inbox groups: today, yesterday, last 7 days, earlier (IST days)', () => {
    const now = ist('2026-10-23T10:00:00');
    assert.equal(R.groupOf(ist('2026-10-23T00:30:00'), now), 'Today');
    assert.equal(R.groupOf(ist('2026-10-22T23:30:00'), now), 'Yesterday');
    assert.equal(R.groupOf(ist('2026-10-18T12:00:00'), now), 'Last 7 days');
    assert.equal(R.groupOf(ist('2026-10-01T12:00:00'), now), 'Earlier');
});

test('the comparison line shows the last two months, never a total', () => {
    assert.equal(R.compareLine([{ month: '2026-09-01', actual: 14160 }, { month: '2026-08-01', actual: 14160 }]), 'Sep ₹14,160 · Aug ₹14,160');
    assert.equal(R.compareLine([{ month: '2026-09-01', actual: null }, { month: '2026-08-01', actual: 241000 }]), 'Aug ₹2,41,000');
    assert.equal(R.compareLine([]), 'no history');
    assert.equal(R.changeLine(238400, 241000), '₹2,38,400 (-1% vs last month)');
    assert.equal(R.changeLine(100, null), '₹100');
});

test('auto-ping: only open, only after the expected date, and not more than once in 48 hours', () => {
    const now = ist('2026-10-25T09:00:00');
    assert.equal(R.shouldAutoPing({ status: 'open', expected_at: null, last_pinged_at: null }, now), true);
    assert.equal(R.shouldAutoPing({ status: 'open', expected_at: ist('2026-10-28T00:00:00'), last_pinged_at: null }, now), false, 'not yet expected');
    assert.equal(R.shouldAutoPing({ status: 'open', expected_at: null, last_pinged_at: ist('2026-10-24T09:00:00') }, now), false, 'pinged 24 h ago');
    assert.equal(R.shouldAutoPing({ status: 'open', expected_at: null, last_pinged_at: ist('2026-10-22T09:00:00') }, now), true);
    assert.equal(R.shouldAutoPing({ status: 'waiting', expected_at: null, last_pinged_at: null }, now), false);
    assert.equal(R.shouldAutoPing({ status: 'answered', expected_at: null, last_pinged_at: null }, now), false);
});

test('default owners: a figure or PO data is Purchase; an approval is an approver', () => {
    assert.equal(R.DEFAULT_OWNER.actual, 'purchase');
    assert.equal(R.DEFAULT_OWNER.approval, 'approver');
    assert.ok(R.ROLE_GROUPS.approver.includes('org_super_admin'));
    assert.ok(!R.ROLE_GROUPS.purchase.includes('property_admin'), 'property admins never own a bounty');
});
