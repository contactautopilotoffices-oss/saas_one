import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { getVoiceProvider } from '@/backend/lib/voice/provider';
import {
    chaseTouch1Message,
    chaseTouch2Message,
    chaseTouch3Message,
    reliabilityNoticeMessage,
} from '@/backend/lib/electricity/chaseMessages';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Electricity 3-touch chase engine + reliability scoring
 * (Phase 4 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 *   spawnChaseTask     — a validation run with missing_dates spawns a chase task and
 *                        sends touch 1 immediately. Assignee = active 'mst' member of
 *                        the account's property; escalates straight to the property
 *                        admin when the property has no MST (plan §9 item 7).
 *   advanceDueChases   — the hourly cron driver. For every task whose next touch is
 *                        due: first re-check completion (missing dates now logged ->
 *                        'completed', re-run-friendly), then send the next touch, or
 *                        default the task once touch 3 + grace has passed.
 *
 * Touch 1/2 ride whatsapp_queue; touch 3 goes through the voice provider and falls
 * back to a 3rd WhatsApp message while the provider is unconfigured (plan §5).
 * Each touch adds its configured cost (system_config keys `electricity_chase_touchN_cost_inr`,
 * ₹0 defaults — plan §9 item 9) to cost_incurred.
 *
 * Defaulting writes a 'default' + a 'strike' reliability event (points from
 * `reliability_default_points`, default 10 — plan §4) and WhatsApp-informs the
 * employee before stamping employee_notified_at. The 3rd active strike inside
 * 12 months raises a tickets row (category 'HR / Reliability') and fans a
 * notification out to all org_super_admin members + is_master_admin users.
 */

export type ChaseStatus = 'open' | 'touch1_sent' | 'touch2_sent' | 'touch3_called' | 'completed' | 'defaulted';

const ACTIVE_STATUSES: ChaseStatus[] = ['open', 'touch1_sent', 'touch2_sent', 'touch3_called'];

const TOUCH_GAP_HOURS = 24;   // between touches
const GRACE_HOURS = 24;       // after touch 3 before the task defaults

const WA_EVENTS = {
    touch1: 'ELECTRICITY_CHASE_T1',
    touch2: 'ELECTRICITY_CHASE_T2',
    touch3: 'ELECTRICITY_CHASE_T3',
    reliabilityNotice: 'ELECTRICITY_RELIABILITY_NOTICE',
} as const;

export interface ChaseTaskRow {
    id: string;
    organization_id: string;
    bill_id: string;
    validation_id: string | null;
    property_id: string | null;
    assignee_id: string | null;
    missing_dates: string[] | null;
    status: ChaseStatus;
    touch1_at: string | null;
    touch2_at: string | null;
    touch3_at: string | null;
    due_at: string | null;
    completed_at: string | null;
    cost_incurred: number;
}

interface ChaseContext {
    siteLabel: string;
    provider: string;
    billingMonth: string;   // 'July 2026'
    assigneeName?: string;
    assigneePhone?: string | null;
}

function hoursFromNow(hours: number): string {
    return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function readNumericConfig(key: string, fallback: number): Promise<number> {
    const { data } = await supabaseAdmin
        .from('system_config').select('value').eq('key', key).maybeSingle();
    const v = Number(data?.value);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}

async function touchCost(touch: 1 | 2 | 3): Promise<number> {
    return readNumericConfig(`electricity_chase_touch${touch}_cost_inr`, 0);
}

async function loadChaseContext(task: ChaseTaskRow): Promise<ChaseContext> {
    const { data: bill } = await supabaseAdmin
        .from('electricity_bills')
        .select('billing_month, account_id')
        .eq('id', task.bill_id)
        .maybeSingle();

    let siteLabel = 'your site';
    let provider = 'electricity';
    if (bill?.account_id) {
        const { data: account } = await supabaseAdmin
            .from('electricity_billing_accounts')
            .select('site_label, provider')
            .eq('id', bill.account_id)
            .maybeSingle();
        if (account?.site_label) siteLabel = account.site_label;
        if (account?.provider) provider = account.provider;
    }

    let billingMonth = '';
    if (bill?.billing_month) {
        const d = new Date(`${String(bill.billing_month).slice(0, 10)}T00:00:00Z`);
        billingMonth = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    let assigneeName: string | undefined;
    let assigneePhone: string | null = null;
    if (task.assignee_id) {
        const { data: user } = await supabaseAdmin
            .from('users').select('full_name, phone').eq('id', task.assignee_id).maybeSingle();
        assigneeName = (user?.full_name || '').split(' ')[0] || undefined;
        assigneePhone = user?.phone ?? null;
    }

    return { siteLabel, provider, billingMonth, assigneeName, assigneePhone };
}

// Resolve the chase target: active MST(s) of the property; escalate to the property
// admin when there is none (plan §9 item 7).
async function resolveAssignee(propertyId: string | null): Promise<string | null> {
    if (!propertyId) return null;

    const { data: msts } = await supabaseAdmin
        .from('property_memberships')
        .select('user_id')
        .eq('property_id', propertyId)
        .eq('role', 'mst')
        .eq('is_active', true)
        .limit(1);
    if (msts && msts.length > 0) return msts[0].user_id;

    const { data: admins } = await supabaseAdmin
        .from('property_memberships')
        .select('user_id')
        .eq('property_id', propertyId)
        .eq('role', 'property_admin')
        .eq('is_active', true)
        .limit(1);
    return admins && admins.length > 0 ? admins[0].user_id : null;
}

/**
 * Spawn a chase task from a validation that found missing reading dates, and fire
 * touch 1 immediately. Idempotent per bill: an already-active chase is returned
 * unchanged instead of double-chasing the same bill.
 */
export async function spawnChaseTask(validationId: string): Promise<{ ok: boolean; taskId?: string; error?: string; provisioned?: boolean }> {
    const { data: validation, error: vErr } = await supabaseAdmin
        .from('electricity_bill_validations')
        .select('id, organization_id, bill_id, missing_dates, result')
        .eq('id', validationId)
        .maybeSingle();
    if (vErr) {
        return { ok: false, error: vErr.message, ...(isMissingRelation(vErr) ? { provisioned: false } : {}) };
    }
    if (!validation) return { ok: false, error: 'validation not found' };

    const missingDates = (validation.missing_dates as string[] | null) || [];
    if (missingDates.length === 0) {
        return { ok: false, error: 'validation has no missing dates — nothing to chase' };
    }

    // Idempotency: one active chase per bill at a time.
    const { data: existing, error: exErr } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .select('id')
        .eq('bill_id', validation.bill_id)
        .in('status', ACTIVE_STATUSES)
        .limit(1)
        .maybeSingle();
    if (exErr) {
        return { ok: false, error: exErr.message, ...(isMissingRelation(exErr) ? { provisioned: false } : {}) };
    }
    if (existing) return { ok: true, taskId: existing.id };

    const { data: bill } = await supabaseAdmin
        .from('electricity_bills')
        .select('account_id')
        .eq('id', validation.bill_id)
        .maybeSingle();
    let propertyId: string | null = null;
    if (bill?.account_id) {
        const { data: account } = await supabaseAdmin
            .from('electricity_billing_accounts')
            .select('property_id')
            .eq('id', bill.account_id)
            .maybeSingle();
        propertyId = account?.property_id ?? null;
    }

    const assigneeId = await resolveAssignee(propertyId);
    const now = new Date().toISOString();

    const { data: task, error: tErr } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .insert({
            organization_id: validation.organization_id,
            bill_id: validation.bill_id,
            validation_id: validation.id,
            property_id: propertyId,
            assignee_id: assigneeId,
            missing_dates: missingDates,
            status: 'open',
            due_at: now,
        })
        .select('*')
        .single();
    if (tErr) {
        return { ok: false, error: tErr.message, ...(isMissingRelation(tErr) ? { provisioned: false } : {}) };
    }

    // Touch 1 goes out immediately; the cron picks up touches 2/3 from due_at.
    await sendTouch(task as ChaseTaskRow, 1);
    return { ok: true, taskId: task.id };
}

async function sendTouch(task: ChaseTaskRow, touch: 1 | 2 | 3): Promise<void> {
    const ctx = await loadChaseContext(task);
    const now = new Date().toISOString();
    const msgCtx = { ...ctx, missingDates: task.missing_dates || [] };

    if (touch === 3 && ctx.assigneePhone) {
        // Voice first; while the provider is unconfigured this returns 'unconfigured'
        // and we fall back to the 3rd WhatsApp message tagged call-pending (plan §5).
        const provider = getVoiceProvider();
        const result = await provider.placeCall(
            ctx.assigneePhone,
            chaseTouch3Message(msgCtx),
        );
        if (result.status === 'placed') {
            await markTouchSent(task, 3, now);
            return;
        }
    }

    const message = touch === 1
        ? chaseTouch1Message(msgCtx)
        : touch === 2
            ? chaseTouch2Message(msgCtx)
            : chaseTouch3Message(msgCtx);

    try {
        await WhatsAppQueueService.enqueue({
            userIds: task.assignee_id ? [task.assignee_id] : [],
            message,
            eventType: touch === 1 ? WA_EVENTS.touch1 : touch === 2 ? WA_EVENTS.touch2 : WA_EVENTS.touch3,
        });
    } catch (e) {
        console.error(`[electricity chase] whatsapp enqueue touch${touch}:`, e instanceof Error ? e.message : e);
    }

    await markTouchSent(task, touch, now);
}

async function markTouchSent(task: ChaseTaskRow, touch: 1 | 2 | 3, now: string): Promise<void> {
    const status: ChaseStatus = touch === 1 ? 'touch1_sent' : touch === 2 ? 'touch2_sent' : 'touch3_called';
    const cost = await touchCost(touch);
    const { error } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .update({
            status,
            [`touch${touch}_at`]: now,
            due_at: touch === 3 ? hoursFromNow(GRACE_HOURS) : hoursFromNow(TOUCH_GAP_HOURS),
            cost_incurred: Number(task.cost_incurred || 0) + cost,
            updated_at: now,
        })
        .eq('id', task.id);
    if (error) console.error(`[electricity chase] touch${touch} update:`, error.message);
}

// Completion is re-run-friendly: re-scan the readings table for the task's missing
// dates; anything now logged drops out. Nothing left -> 'completed'.
async function remainingMissingDates(task: ChaseTaskRow): Promise<string[]> {
    const missing = task.missing_dates || [];
    if (missing.length === 0) return [];
    // No property link means there is no readings stream to re-check against — keep
    // chasing rather than auto-completing.
    if (!task.property_id) return missing;

    const { data: readings } = await supabaseAdmin
        .from('electricity_readings')
        .select('reading_date')
        .eq('property_id', task.property_id)
        .in('reading_date', missing);

    const logged = new Set((readings || []).map(r => String(r.reading_date).slice(0, 10)));
    return missing.filter(d => !logged.has(String(d).slice(0, 10)));
}

async function completeTask(task: ChaseTaskRow, remaining: string[]): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .update({ status: 'completed', completed_at: now, due_at: null, missing_dates: remaining, updated_at: now })
        .eq('id', task.id);
    if (error) console.error('[electricity chase] complete update:', error.message);
}

async function defaultTask(task: ChaseTaskRow): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .update({ status: 'defaulted', due_at: null, updated_at: now })
        .eq('id', task.id);
    if (error) {
        console.error('[electricity chase] default update:', error.message);
        return;
    }
    if (!task.assignee_id) return;

    const ctx = await loadChaseContext(task);
    const points = await readNumericConfig('reliability_default_points', 10);

    // 1 default = 1 strike (plan §9 item 10). Both are events on the same source.
    const { error: evErr } = await supabaseAdmin.from('employee_reliability_events').insert([
        {
            organization_id: task.organization_id,
            user_id: task.assignee_id,
            source_type: 'electricity_chase',
            source_id: task.id,
            kind: 'default',
            points,
            note: `Electricity chase defaulted: ${ctx.siteLabel} (${ctx.billingMonth}), ${(task.missing_dates || []).length} missing reading dates unresolved after 3 touches.`,
        },
        {
            organization_id: task.organization_id,
            user_id: task.assignee_id,
            source_type: 'electricity_chase',
            source_id: task.id,
            kind: 'strike',
            points: 0,
            note: `Strike from electricity chase default (${ctx.siteLabel}, ${ctx.billingMonth}).`,
        },
    ]);
    if (evErr && !isMissingRelation(evErr)) console.error('[electricity chase] reliability events:', evErr.message);

    // The employee must be informed when penalised (plan §4) — enqueue first, then
    // stamp employee_notified_at so the flag always means "message went out".
    const { data: scoreRow } = await supabaseAdmin
        .from('employee_reliability_scores')
        .select('score, strike_count')
        .eq('user_id', task.assignee_id)
        .eq('organization_id', task.organization_id)
        .maybeSingle();

    try {
        await WhatsAppQueueService.enqueue({
            userIds: [task.assignee_id],
            message: reliabilityNoticeMessage({
                assigneeName: ctx.assigneeName,
                siteLabel: ctx.siteLabel,
                points,
                score: scoreRow?.score ?? null,
            }),
            eventType: WA_EVENTS.reliabilityNotice,
        });
        await supabaseAdmin
            .from('employee_reliability_events')
            .update({ employee_notified_at: now, notified_via: 'whatsapp' })
            .eq('source_type', 'electricity_chase')
            .eq('source_id', task.id)
            .is('employee_notified_at', null);
    } catch (e) {
        console.error('[electricity chase] reliability notice enqueue:', e instanceof Error ? e.message : e);
    }

    // 3rd active strike within the rolling 12-month window -> ticket + fan-out.
    const strikes = scoreRow?.strike_count ?? 0;
    if (strikes >= 3) {
        await raiseStrikeTicket(task, ctx, strikes);
    }
}

async function raiseStrikeTicket(task: ChaseTaskRow, ctx: ChaseContext, strikes: number): Promise<void> {
    // Recipients: all org_super_admin members + every master admin (plan §4).
    const { data: orgAdmins } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', task.organization_id)
        .eq('role', 'org_super_admin')
        .eq('is_active', true);
    const { data: masterAdmins } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_master_admin', true);

    const recipientIds = [...new Set([
        ...(orgAdmins || []).map(r => r.user_id),
        ...(masterAdmins || []).map(r => r.id),
    ])];

    // raised_by is NOT NULL on tickets; attribute the system-raised ticket to an org
    // super admin when one exists, else to the employee the ticket is about.
    const raisedBy = recipientIds[0] || task.assignee_id;
    if (!raisedBy) return;

    const title = `Reliability: 3rd strike for ${ctx.assigneeName || 'employee'} (electricity readings)`;
    const description =
        `${ctx.assigneeName || 'The assignee'} has ${strikes} active strikes within 12 months. ` +
        `Latest: electricity meter readings for ${ctx.siteLabel} (${ctx.billingMonth}) were not logged ` +
        `despite 3 chase touches (chase task ${task.id}). Review the reliability profile and decide on action.`;

    const { error: tErr } = await supabaseAdmin.from('tickets').insert({
        organization_id: task.organization_id,
        property_id: task.property_id,
        raised_by: raisedBy,
        title,
        description,
        category: 'HR / Reliability',
        priority: 'high',
        status: 'open',
    });
    if (tErr) {
        console.error('[electricity chase] strike ticket insert:', tErr.message);
        return;
    }

    const { error: nErr } = await supabaseAdmin.from('notifications').insert(
        recipientIds.map(userId => ({
            user_id: userId,
            organization_id: task.organization_id,
            property_id: task.property_id,
            notification_type: 'ELECTRICITY_RELIABILITY_STRIKE_3',
            title,
            message: description,
        })),
    );
    if (nErr) console.error('[electricity chase] strike notifications:', nErr.message);
}

export interface ChaseAdvanceSummary {
    scanned: number;
    completed: number;
    touch1: number;
    touch2: number;
    touch3: number;
    defaulted: number;
    errors: string[];
}

/**
 * Hourly driver (app/api/cron/electricity-chase). For every active task past its
 * due_at: completion re-check first, then the next touch, or default after touch 3
 * + grace.
 */
export async function advanceDueChases(): Promise<ChaseAdvanceSummary> {
    const summary: ChaseAdvanceSummary = { scanned: 0, completed: 0, touch1: 0, touch2: 0, touch3: 0, defaulted: 0, errors: [] };

    const now = new Date().toISOString();
    const { data: tasks, error } = await supabaseAdmin
        .from('electricity_chase_tasks')
        .select('*')
        .in('status', ACTIVE_STATUSES)
        .lte('due_at', now)
        .range(0, 999);

    if (error) {
        if (isMissingRelation(error)) {
            // Migration not applied yet — degrade to a healthy no-op.
            return summary;
        }
        summary.errors.push(error.message);
        return summary;
    }

    for (const raw of tasks || []) {
        const task = raw as ChaseTaskRow;
        summary.scanned += 1;
        try {
            const remaining = await remainingMissingDates(task);
            if (remaining.length === 0) {
                await completeTask(task, remaining);
                summary.completed += 1;
                continue;
            }

            if (task.status === 'open') {
                await sendTouch(task, 1);
                summary.touch1 += 1;
            } else if (task.status === 'touch1_sent') {
                await sendTouch(task, 2);
                summary.touch2 += 1;
            } else if (task.status === 'touch2_sent') {
                await sendTouch(task, 3);
                summary.touch3 += 1;
            } else {
                // touch3_called past its due_at = grace elapsed.
                await defaultTask(task);
                summary.defaulted += 1;
            }
        } catch (e) {
            summary.errors.push(`${task.id}: ${e instanceof Error ? e.message : e}`);
        }
    }

    return summary;
}
