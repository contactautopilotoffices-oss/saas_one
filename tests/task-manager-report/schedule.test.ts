import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    coveragePeriod,
    DEFAULT_SCHEDULE,
    followingRun,
    nextRunAfter,
    validateSchedule,
    type ReportSchedule,
} from '../../backend/lib/reports/taskManagerUsage/schedule';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const weekly: ReportSchedule = { ...DEFAULT_SCHEDULE, enabled: true };

describe('next run', () => {
    it('finds the next Monday 09:00 IST (03:30 UTC)', () => {
        // 2026-11-04 is a Wednesday.
        assert.equal(iso(nextRunAfter(weekly, at('2026-11-04T06:00:00Z'))), '2026-11-09T03:30:00.000Z');
    });

    it('uses today when the time has not passed yet in IST', () => {
        const wednesday = { ...weekly, dayOfWeek: 3, timeIst: '18:00' };
        assert.equal(iso(nextRunAfter(wednesday, at('2026-11-04T06:00:00Z'))), '2026-11-04T12:30:00.000Z');
    });

    it('moves on a week when the time has just passed', () => {
        assert.equal(iso(nextRunAfter(weekly, at('2026-11-09T03:30:00Z'))), '2026-11-16T03:30:00.000Z');
    });

    it('reads the day in IST, not UTC', () => {
        // 20:00 UTC on Sunday is already Monday 01:30 in IST, so the 09:00 run is that same Monday.
        assert.equal(iso(nextRunAfter(weekly, at('2026-11-08T20:00:00Z'))), '2026-11-09T03:30:00.000Z');
    });

    it('rolls a monthly run into the next month, and over a new year', () => {
        const monthly = { ...weekly, frequency: 'monthly' as const, dayOfMonth: 5 };
        assert.equal(iso(nextRunAfter(monthly, at('2026-11-04T06:00:00Z'))), '2026-11-05T03:30:00.000Z');
        assert.equal(iso(nextRunAfter(monthly, at('2026-11-06T06:00:00Z'))), '2026-12-05T03:30:00.000Z');
        assert.equal(iso(nextRunAfter(monthly, at('2026-12-20T06:00:00Z'))), '2027-01-05T03:30:00.000Z');
    });
});

describe('following run', () => {
    it('keeps a fortnightly schedule on alternate weeks', () => {
        const fortnightly = { ...weekly, frequency: 'fortnightly' as const };
        const ran = at('2026-11-09T03:30:00Z');
        assert.equal(iso(followingRun(fortnightly, ran, ran + 60_000)), '2026-11-23T03:30:00.000Z');
    });

    it('never replays runs missed while the cron was down', () => {
        const ran = at('2026-11-09T03:30:00Z');
        const threeWeeksLate = at('2026-11-30T10:00:00Z');
        assert.equal(iso(followingRun(weekly, ran, threeWeeksLate)), '2026-12-07T03:30:00.000Z');
    });
});

describe('coverage', () => {
    it('ends the day before the run', () => {
        assert.deepEqual(coveragePeriod({ coverageDays: 7 }, at('2026-11-09T03:30:00Z')), { from: '2026-11-02', to: '2026-11-08' });
    });

    it('supports longer ranges', () => {
        assert.deepEqual(coveragePeriod({ coverageDays: 30 }, at('2026-11-09T03:30:00Z')), { from: '2026-10-10', to: '2026-11-08' });
    });

    it('uses the IST day for a run shortly after midnight IST', () => {
        const justAfterMidnight = { ...weekly, timeIst: '00:15' };
        const run = nextRunAfter(justAfterMidnight, at('2026-11-07T12:00:00Z'));
        assert.deepEqual(coveragePeriod({ coverageDays: 7 }, run), { from: '2026-11-02', to: '2026-11-08' });
    });
});

describe('validation', () => {
    it('accepts a good schedule', () => {
        assert.equal(validateSchedule(weekly).ok, true);
    });

    it('refuses bad values', () => {
        const bad: Partial<ReportSchedule>[] = [
            { timeIst: '09:10' }, { timeIst: '25:00' }, { dayOfWeek: 7 }, { dayOfMonth: 29 }, { coverageDays: 0 }, { coverageDays: 367 },
        ];
        for (const change of bad) assert.equal(validateSchedule({ ...weekly, ...change }).ok, false, JSON.stringify(change));
        assert.equal(validateSchedule({ ...weekly, frequency: 'daily' }).ok, false);
        assert.equal(validateSchedule(null).ok, false);
    });
});
