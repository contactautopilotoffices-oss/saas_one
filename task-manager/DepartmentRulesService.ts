import { randomUUID } from 'node:crypto';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { TaskNotificationService } from './TaskNotificationService';
import { Employee, NotificationRule, NotificationRuleType, NotificationCustomTemplate } from './types';

/**
 * Step 6 — a team manages ITS OWN Task Manager notifications (schedule and wording).
 *
 * Scope is the whole point: a person can only ever see or change rules that belong to their OWN department.
 * The original Tech rules (which have no department) and every other department's rules are out of reach.
 * No business limits (number of rules, hours) by design; only technical sanity (valid time, valid wording).
 * Real sends, kill switches and Pretend Mode are never reachable from here.
 */

export class RulesError extends Error {
    constructor(public readonly status: number, message: string, public readonly code?: string) {
        super(message);
        this.name = 'RulesError';
    }
}

export const ALLOWED_RULE_TYPES: ReadonlyArray<NotificationRuleType> = ['morning_digest', 'pending_reminder', 'eod_summary'];
export const TEMPLATE_VARIABLES = ['firstName', 'fullName', 'totalTasks', 'pendingTasks', 'completedTasks', 'date'] as const;

const TYPE_LABEL: Record<string, string> = {
    morning_digest: 'Morning task list',
    pending_reminder: 'Midday reminder',
    eod_summary: 'Evening summary',
};

export interface RuleInput {
    id?: string;
    name?: unknown;
    ruleType?: unknown;
    targetTimeIST?: unknown;
    daysOfWeek?: unknown;
    enabled?: unknown;
    customTemplate?: unknown;
}

/** What each message type shows. Not editable by the team: it is what makes each type behave as it should. */
export function defaultsFor(ruleType: NotificationRuleType): Pick<NotificationRule, 'taskFilters' | 'conditions'> {
    if (ruleType === 'pending_reminder') {
        return {
            taskFilters: { includeTodayFixed: true, includeTodayAssigned: true, includeYesterdayPending: true, lookbackDays: 1, onlyPending: true },
            conditions: { skipIfZeroTasks: true, requirePendingOnly: true },
        };
    }
    if (ruleType === 'eod_summary') {
        return {
            taskFilters: { includeTodayFixed: true, includeTodayAssigned: true, includeYesterdayPending: true, lookbackDays: 3, onlyPending: false },
            conditions: { skipIfZeroTasks: true, requirePendingOnly: false },
        };
    }
    return {
        taskFilters: { includeTodayFixed: true, includeTodayAssigned: true, includeYesterdayPending: true, lookbackDays: 1, onlyPending: false },
        conditions: { skipIfZeroTasks: false, requirePendingOnly: false },
    };
}

type Validated = { ok: true; value: Pick<NotificationRule, 'name' | 'ruleType' | 'targetTimeIST' | 'daysOfWeek' | 'enabled' | 'customTemplate'> } | { ok: false; error: string };

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** Technical sanity only: a valid time, valid weekdays, valid wording. No limits on how many rules or which hours. */
export function validateRuleInput(input: RuleInput): Validated {
    const ruleType = input.ruleType as NotificationRuleType;
    if (!ALLOWED_RULE_TYPES.includes(ruleType)) return { ok: false, error: 'Choose a message type: morning list, midday reminder or evening summary.' };

    const time = typeof input.targetTimeIST === 'string' ? input.targetTimeIST.trim() : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: 'Time must look like 09:30.' };

    const days = Array.isArray(input.daysOfWeek) ? input.daysOfWeek : [];
    const cleanDays = [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (cleanDays.length === 0) return { ok: false, error: 'Pick at least one day.' };

    const nameRaw = typeof input.name === 'string' ? input.name.trim() : '';
    const name = nameRaw || TYPE_LABEL[ruleType];
    if (name.length > 80) return { ok: false, error: 'The name is too long (80 characters at most).' };

    let customTemplate: NotificationCustomTemplate | undefined;
    if (input.customTemplate && typeof input.customTemplate === 'object') {
        const t = input.customTemplate as Record<string, unknown>;
        const headerGreeting = (t.headerGreeting ?? '') === '' ? '' : str(t.headerGreeting, 300);
        const customMessage = (t.customMessage ?? '') === '' ? '' : str(t.customMessage, 1000);
        const footerInstruction = (t.footerInstruction ?? '') === '' ? '' : str(t.footerInstruction, 500);
        if (headerGreeting === null) return { ok: false, error: 'The greeting is too long (300 characters at most).' };
        if (customMessage === null) return { ok: false, error: 'The message is too long (1000 characters at most).' };
        if (footerInstruction === null) return { ok: false, error: 'The closing line is too long (500 characters at most).' };

        const unknown = [headerGreeting, customMessage, footerInstruction]
            .flatMap(text => [...text.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map(m => m[1]))
            .find(v => !(TEMPLATE_VARIABLES as readonly string[]).map(x => x.toLowerCase()).includes(v.toLowerCase()));
        if (unknown) return { ok: false, error: `Unknown placeholder {{${unknown}}}. Use: ${TEMPLATE_VARIABLES.map(v => `{{${v}}}`).join(', ')}.` };

        if (headerGreeting || customMessage || footerInstruction) {
            customTemplate = {
                headerGreeting: headerGreeting || undefined,
                customMessage: customMessage || undefined,
                footerInstruction: footerInstruction || undefined,
                includeQuickReplies: t.includeQuickReplies !== false,
            };
        }
    }

    return {
        ok: true,
        value: { name, ruleType, targetTimeIST: time, daysOfWeek: cleanDays, enabled: input.enabled !== false, customTemplate },
    };
}

interface Context {
    actor: Employee;
    isSuperuser: boolean;
    departmentId: string;
    departmentName: string;
    delegated: boolean;
    canEdit: boolean;
}

/** Cooldown between two "Send now" presses on the same notification. */
export const SEND_NOW_COOLDOWN_MS = 10 * 60 * 1000;

const istToday = () => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
};

export interface SendNowResult { sent: number; skippedNoTasks: number; skippedLocked: number; pretend: boolean; blockedReason: string | null }

/**
 * Sends one saved notification right now. It goes through the SAME safety gate as the schedule (kill switches, Pretend Mode,
 * the test whitelist, locked people). It does not touch the rule's "ran today" stamp, so the scheduled send still happens.
 * A short cooldown stops a double click from messaging people twice.
 */
export async function sendRuleNow(params: { rule: NotificationRule; departmentId?: string; actorId: string }): Promise<SendNowResult> {
    const { rule } = params;
    const last = rule.lastManualSendAt ? Date.parse(rule.lastManualSendAt) : 0;
    const wait = last + SEND_NOW_COOLDOWN_MS - Date.now();
    if (wait > 0) throw new RulesError(429, `This was just sent. You can send it again in ${Math.ceil(wait / 60000)} minute${Math.ceil(wait / 60000) === 1 ? '' : 's'}.`, 'COOLDOWN');

    const result = await TaskNotificationService.sendMorningNotifications({ date: istToday(), departmentId: params.departmentId, dryRun: false, rule });
    if (!result.blockedReason) await TaskDatabaseService.updateNotificationRule(rule.id, { lastManualSendAt: new Date().toISOString() });
    await TaskDatabaseService.logAudit({
        eventType: 'notification_sent_now',
        actorId: params.actorId,
        details: { ruleId: rule.id, ruleName: rule.name, sent: result.notificationsSent, pretend: !!result.pretend, blocked: result.blockedReason || null },
    });
    return {
        sent: result.notificationsSent,
        skippedNoTasks: result.skippedNoTasks,
        skippedLocked: result.skippedLocked || 0,
        pretend: !!result.pretend,
        blockedReason: result.blockedReason || null,
    };
}

export class DepartmentRulesService {
    private static async context(actorUserId: string, departmentName?: string): Promise<Context> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new RulesError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');

        const isSuperuser = actor.role === 'superuser';
        if (!isSuperuser) {
            const access = await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id });
            if (!access.allowed) throw new RulesError(403, access.message, 'LOCKED');
        }

        let departmentId = actor.department_id;
        let name = actor.department_name || 'Your team';
        if (isSuperuser && departmentName) {
            const dept = await TaskDatabaseService.getDepartmentByName(departmentName);
            if (dept) { departmentId = dept.id; name = dept.name; }
        }
        if (!departmentId) throw new RulesError(403, 'Your profile has no department yet.', 'NO_DEPARTMENT');

        const delegated = await TaskAccessService.isNotificationsDelegated(departmentId);
        return { actor, isSuperuser, departmentId, departmentName: name, delegated, canEdit: isSuperuser || delegated };
    }

    private static async teamRules(departmentId: string): Promise<NotificationRule[]> {
        const config = await TaskDatabaseService.getTestingConfig();
        return (config.rules || []).filter(r => r.departmentId === departmentId);
    }

    static async list(actorUserId: string, departmentName?: string) {
        const ctx = await this.context(actorUserId, departmentName);
        const config = await TaskDatabaseService.getTestingConfig();
        return {
            departmentName: ctx.departmentName,
            delegated: ctx.delegated,
            canEdit: ctx.canEdit,
            rules: (config.rules || []).filter(r => r.departmentId === ctx.departmentId),
            // Honest context for the screen: is anything really being delivered right now?
            pretendMode: config.whatsappPretendMode !== false,
            sandboxOn: config.enabled === true,
            variables: [...TEMPLATE_VARIABLES],
        };
    }

    private static requireEdit(ctx: Context) {
        if (!ctx.canEdit) {
            throw new RulesError(403, 'Notification settings for your team are managed by your administrator.', 'NOT_DELEGATED');
        }
    }

    private static build(ctx: Context, input: RuleInput, existing?: NotificationRule): NotificationRule {
        const v = validateRuleInput(input);
        if (!v.ok) throw new RulesError(400, v.error, 'INVALID');
        const defaults = defaultsFor(v.value.ruleType);
        return {
            id: existing?.id || `rule_${ctx.departmentId.slice(0, 8)}_${randomUUID().slice(0, 8)}`,
            name: v.value.name,
            enabled: v.value.enabled,
            targetTimeIST: v.value.targetTimeIST,
            daysOfWeek: v.value.daysOfWeek,
            ruleType: v.value.ruleType,
            departmentId: ctx.departmentId,                       // always THEIR department, whatever the request says
            taskFilters: defaults.taskFilters,
            conditions: defaults.conditions,
            recipients: { target: 'department', notifyReportingManager: false },
            customTemplate: v.value.customTemplate,
            lastRunDate: existing?.lastRunDate ?? null,
            lastRunSummary: existing?.lastRunSummary ?? null,
        };
    }

    static async save(actorUserId: string, input: RuleInput, departmentName?: string): Promise<NotificationRule> {
        const ctx = await this.context(actorUserId, departmentName);
        this.requireEdit(ctx);

        let existing: NotificationRule | undefined;
        if (input.id) {
            existing = (await this.teamRules(ctx.departmentId)).find(r => r.id === input.id);
            // A rule from another department (or the original Tech rules) is simply "not found" here.
            if (!existing) throw new RulesError(404, 'That notification was not found for your team.', 'NOT_FOUND');
        }

        const rule = this.build(ctx, input, existing);
        await TaskDatabaseService.updateNotificationRule(rule.id, rule);
        await TaskDatabaseService.logAudit({
            eventType: 'notification_rule_saved',
            actorId: ctx.actor.id,
            details: { ruleId: rule.id, ruleName: rule.name, ruleType: rule.ruleType, time: rule.targetTimeIST, days: rule.daysOfWeek, enabled: rule.enabled, departmentId: ctx.departmentId, created: !existing },
        });
        return rule;
    }

    static async remove(actorUserId: string, ruleId: string, departmentName?: string): Promise<void> {
        const ctx = await this.context(actorUserId, departmentName);
        this.requireEdit(ctx);
        const existing = (await this.teamRules(ctx.departmentId)).find(r => r.id === ruleId);
        if (!existing) throw new RulesError(404, 'That notification was not found for your team.', 'NOT_FOUND');

        await TaskDatabaseService.deleteNotificationRule(ruleId);
        await TaskDatabaseService.logAudit({
            eventType: 'notification_rule_deleted',
            actorId: ctx.actor.id,
            details: { ruleId, ruleName: existing.name, departmentId: ctx.departmentId },
        });
    }

    /** "Send now" for a team notification. Reaches the whole team, so the caller must confirm. */
    static async sendNow(actorUserId: string, input: { ruleId?: string; confirm?: boolean }, departmentName?: string): Promise<SendNowResult> {
        const ctx = await this.context(actorUserId, departmentName);
        this.requireEdit(ctx);
        const rule = (await this.teamRules(ctx.departmentId)).find(r => r.id === input.ruleId);
        if (!rule) throw new RulesError(404, 'That notification was not found for your team.', 'NOT_FOUND');
        if (input.confirm !== true) throw new RulesError(400, 'Confirm before sending to the team.', 'CONFIRM_REQUIRED');
        return sendRuleNow({ rule, departmentId: ctx.departmentId, actorId: ctx.actor.id });
    }

    /**
     * "What would this send, and to whom?" Sends nothing and writes nothing.
     * `sample` is the message with made-up tasks; `audience` is who would really receive it today.
     */
    static async preview(actorUserId: string, input: RuleInput, departmentName?: string) {
        const ctx = await this.context(actorUserId, departmentName);
        const rule = this.build(ctx, input);

        const sampleTasks = [
            { id: 's1', title: 'Call vendor for quotation', status: 'pending', assigned_date: '', isCarriedForward: false },
            { id: 's2', title: 'Share comparative with site head', status: 'in_progress', assigned_date: '', isCarriedForward: false },
            { id: 's3', title: 'Confirm delivery date', status: 'completed', assigned_date: '', isCarriedForward: false },
        ] as never[];
        const sample = TaskNotificationService.buildFormattedDigest(rule, ctx.actor.name || 'there', sampleTasks, new Date().toISOString().slice(0, 10));

        const result = await TaskNotificationService.sendMorningNotifications({ departmentId: ctx.departmentId, dryRun: true, skipAudit: true, rule });
        const config = await TaskDatabaseService.getTestingConfig();

        return {
            sample,
            audience: result.details
                .filter(d => d.status === 'sent' || d.status === 'skipped_no_tasks' || d.status === 'skipped_locked')
                .map(d => ({ name: d.employeeName, taskCount: d.taskCount, status: d.status === 'sent' ? 'would_receive' : d.status === 'skipped_locked' ? 'not_unlocked' : 'no_tasks' })),
            pretendMode: config.whatsappPretendMode !== false,
            sandboxOn: config.enabled === true,
        };
    }
}
