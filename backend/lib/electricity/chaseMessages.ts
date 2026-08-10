/**
 * WhatsApp message templates for the electricity 3-touch chase engine
 * (Phase 4 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * WasenderAPI sends plain text — no Meta template approval needed (plan §5), so these
 * are simple string builders. Tone escalates per touch: 1 polite, 2 pushy, 3 final
 * (the voice-call fallback message until a voice provider is chosen).
 */

export interface ChaseMessageContext {
    siteLabel: string;        // e.g. '3i - Crescent Solitaire'
    provider: string;         // e.g. 'Adani Electricity Mumbai Limited'
    billingMonth: string;     // e.g. 'July 2026'
    missingDates: string[];   // 'YYYY-MM-DD' dates with no meter reading logged
    assigneeName?: string;    // first name if known
}

function greeting(ctx: ChaseMessageContext): string {
    return ctx.assigneeName ? `Hi ${ctx.assigneeName},` : 'Hi,';
}

function dateList(ctx: ChaseMessageContext): string {
    const dates = ctx.missingDates.slice(0, 10).join(', ');
    return ctx.missingDates.length > 10 ? `${dates} (+${ctx.missingDates.length - 10} more)` : dates;
}

function billLine(ctx: ChaseMessageContext): string {
    return `the ${ctx.provider} electricity bill for ${ctx.siteLabel} (${ctx.billingMonth})`;
}

// Touch 1 — polite first nudge.
export function chaseTouch1Message(ctx: ChaseMessageContext): string {
    return `${greeting(ctx)} meter readings are missing for ${billLine(ctx)}. ` +
        `Dates missing: ${dateList(ctx)}. Please log them in the app today so the bill can be validated. Thanks!`;
}

// Touch 2 — firmer, names the consequence.
export function chaseTouch2Message(ctx: ChaseMessageContext): string {
    return `${greeting(ctx)} this is a reminder — meter readings for ${billLine(ctx)} are still missing ` +
        `(${dateList(ctx)}). The bill cannot be validated until these are logged. ` +
        `Please update them within 24 hours to avoid escalation.`;
}

// Touch 3 — final notice. Ships as a WhatsApp message tagged "call pending" until a
// voice provider is configured (plan §5).
export function chaseTouch3Message(ctx: ChaseMessageContext): string {
    return `${greeting(ctx)} FINAL NOTICE: readings for ${billLine(ctx)} are still missing (${dateList(ctx)}). ` +
        `A follow-up call is pending. If these are not logged within 24 hours, this will be recorded as a ` +
        `default on your reliability profile and escalated to management.`;
}

// Reliability penalty notice — satisfies the "employee must be informed" requirement
// (plan §4); employee_notified_at is set once this is enqueued.
export function reliabilityNoticeMessage(input: {
    assigneeName?: string;
    siteLabel: string;
    points: number;
    score: number | null;
}): string {
    const who = input.assigneeName ? `Hi ${input.assigneeName},` : 'Hi,';
    const scoreLine = input.score != null ? ` Your current reliability score is ${input.score}/100.` : '';
    return `${who} the missing electricity meter readings for ${input.siteLabel} were not resolved despite ` +
        `3 reminders. This has been noted on your reliability profile (−${input.points} points).${scoreLine} ` +
        `Please reach out to your manager if you need help staying on top of readings.`;
}
