import { randomUUID } from 'node:crypto';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskNotificationService } from './TaskNotificationService';
import { TaskDailyGeneratorService } from './TaskDailyGeneratorService';
import { SendNowResult, TEMPLATE_VARIABLES, RuleInput, RulesError, defaultsFor, sendRuleNow, validateRuleInput } from './DepartmentRulesService';
import { Employee, NotificationRule } from './types';

/**
 * A superuser's OWN Task Manager notifications (schedule and wording), sent only to them.
 *
 * Scope is the whole point: a personal rule carries `ownerUserId` and no department, so the department screens never
 * list or change it, and the sender (TaskNotificationService) only ever reaches its owner. Real sends still go through
 * the same safety gate as everything else: kill switches, Pretend Mode and the test whitelist. Nothing here sends.
 */
export class PersonalRulesService {
    private static async actor(actorUserId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new RulesError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        if (actor.role !== 'superuser') throw new RulesError(403, 'Personal notifications are only for superusers.', 'NOT_SUPERUSER');
        return actor;
    }

    private static async mine(actorId: string): Promise<NotificationRule[]> {
        const config = await TaskDatabaseService.getTestingConfig();
        return (config.rules || []).filter(r => r.ownerUserId === actorId);
    }

    static async list(actorUserId: string) {
        const actor = await this.actor(actorUserId);
        const config = await TaskDatabaseService.getTestingConfig();
        return {
            departmentName: 'You',
            delegated: false,
            canEdit: true,
            rules: await this.mine(actor.id),
            pretendMode: config.whatsappPretendMode !== false,
            sandboxOn: config.enabled === true,
            variables: [...TEMPLATE_VARIABLES],
        };
    }

    private static build(actor: Employee, input: RuleInput, existing?: NotificationRule): NotificationRule {
        const v = validateRuleInput(input);
        if (!v.ok) throw new RulesError(400, v.error, 'INVALID');
        const defaults = defaultsFor(v.value.ruleType);
        return {
            id: existing?.id || `rule_me_${actor.id.slice(0, 8)}_${randomUUID().slice(0, 8)}`,
            name: v.value.name,
            enabled: v.value.enabled,
            targetTimeIST: v.value.targetTimeIST,
            daysOfWeek: v.value.daysOfWeek,
            ruleType: v.value.ruleType,
            departmentId: null,                                    // never a department rule
            ownerUserId: actor.id,                                 // always THEIR rule, whatever the request says
            taskFilters: defaults.taskFilters,
            conditions: defaults.conditions,
            recipients: { target: 'specific_employees', employeeIds: [actor.id], notifyReportingManager: false },
            customTemplate: v.value.customTemplate,
            lastRunDate: existing?.lastRunDate ?? null,
            lastRunSummary: existing?.lastRunSummary ?? null,
        };
    }

    static async save(actorUserId: string, input: RuleInput): Promise<NotificationRule> {
        const actor = await this.actor(actorUserId);
        let existing: NotificationRule | undefined;
        if (input.id) {
            existing = (await this.mine(actor.id)).find(r => r.id === input.id);
            // Someone else's rule, or a department rule, is simply "not found" here.
            if (!existing) throw new RulesError(404, 'That notification was not found.', 'NOT_FOUND');
        }
        const rule = this.build(actor, input, existing);
        await TaskDatabaseService.updateNotificationRule(rule.id, rule);
        await TaskDatabaseService.logAudit({
            eventType: 'notification_rule_saved',
            actorId: actor.id,
            details: { ruleId: rule.id, ruleName: rule.name, ruleType: rule.ruleType, time: rule.targetTimeIST, days: rule.daysOfWeek, enabled: rule.enabled, personal: true, created: !existing },
        });
        return rule;
    }

    static async remove(actorUserId: string, ruleId: string): Promise<void> {
        const actor = await this.actor(actorUserId);
        const existing = (await this.mine(actor.id)).find(r => r.id === ruleId);
        if (!existing) throw new RulesError(404, 'That notification was not found.', 'NOT_FOUND');
        await TaskDatabaseService.deleteNotificationRule(ruleId);
        await TaskDatabaseService.logAudit({
            eventType: 'notification_rule_deleted',
            actorId: actor.id,
            details: { ruleId, ruleName: existing.name, personal: true },
        });
    }

    /** "Send me this now". Reaches only the owner, so no confirmation is needed. */
    static async sendNow(actorUserId: string, ruleId: string): Promise<SendNowResult> {
        const actor = await this.actor(actorUserId);
        const rule = (await this.mine(actor.id)).find(r => r.id === ruleId);
        if (!rule) throw new RulesError(404, 'That notification was not found.', 'NOT_FOUND');
        // Make sure today's locked tasks are on the list before it is built
        await TaskDailyGeneratorService.generatePersonalFixedTasks({ employeeId: actor.id });
        return sendRuleNow({ rule, departmentId: actor.department_id || undefined, actorId: actor.id });
    }

    /** "What would this send, and to whom?" Sends nothing and writes nothing. */
    static async preview(actorUserId: string, input: RuleInput) {
        const actor = await this.actor(actorUserId);
        const rule = this.build(actor, input);

        const sampleTasks = [
            { id: 's1', title: 'Approve Q3 vendor payment batch', status: 'pending', assigned_date: '', isCarriedForward: false },
            { id: 's2', title: 'Review site audit findings', status: 'in_progress', assigned_date: '', isCarriedForward: false },
            { id: 's3', title: 'Sign revised leave policy', status: 'completed', assigned_date: '', isCarriedForward: false },
        ] as never[];
        const sample = TaskNotificationService.buildFormattedDigest(rule, actor.name || 'there', sampleTasks, new Date().toISOString().slice(0, 10));

        const result = await TaskNotificationService.sendMorningNotifications({ departmentId: actor.department_id || undefined, dryRun: true, skipAudit: true, rule });
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
