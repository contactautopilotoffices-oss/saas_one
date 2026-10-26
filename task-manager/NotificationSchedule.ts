/**
 * Step 6 — decides whether a notification rule is due right now. PURE (no I/O) so it can be tested offline.
 * Extracted from the cron route; the rules are exactly the ones the cron already applied, except for the late cutoff
 * (see `lateLimitMinutes`), which no longer stops a rule that is itself scheduled in the evening.
 */

export type ScheduleStatus =
    | 'disabled'
    | 'not_scheduled_today'
    | 'already_executed_today'
    | 'waiting'
    | 'outside_operational_window'
    | 'due';

export interface ScheduleRule {
    enabled?: boolean;
    daysOfWeek?: number[];
    lastRunDate?: string | null;
    targetTimeIST?: string;
}

export interface ScheduleNow {
    dayOfWeek: number; // 0 = Sunday ... 6 = Saturday (IST)
    minutes: number;   // minutes since midnight (IST)
    todayIST: string;  // YYYY-MM-DD
}

export function targetMinutesOf(rule: ScheduleRule): number {
    const [h, m] = (rule.targetTimeIST || '09:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/**
 * A rule is skipped once it is stale (the cron missed it for a long time).
 * Before: a fixed 20:30 IST cutoff for everything. That would silently kill any rule set for the evening,
 * so the cutoff is now whichever is later: 20:30, or two hours after the rule's own time.
 * Rules at or before 18:30 behave exactly as before.
 */
export function lateLimitMinutes(rule: ScheduleRule): number {
    return Math.max(20 * 60 + 30, targetMinutesOf(rule) + 120);
}

export function evaluateRuleSchedule(rule: ScheduleRule, now: ScheduleNow, force = false): ScheduleStatus {
    if (rule.enabled === false) return 'disabled';
    if (!force && rule.daysOfWeek && !rule.daysOfWeek.includes(now.dayOfWeek)) return 'not_scheduled_today';
    if (!force && rule.lastRunDate === now.todayIST) return 'already_executed_today';
    if (!force && now.minutes < targetMinutesOf(rule)) return 'waiting';
    if (!force && now.minutes > lateLimitMinutes(rule)) return 'outside_operational_window';
    return 'due';
}
