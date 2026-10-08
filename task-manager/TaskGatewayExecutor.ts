import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskCommandHandler, CommandExecutionResult } from './TaskCommandHandler';
import { PermissionService } from './PermissionService';
import { SuperuserInsights, SUPERUSER_GUIDE, PickOption } from './SuperuserInsights';
import { GatewayDecision, InsightDecision, matchByName, matchTaskByHint } from './TaskGateway';

const CONFIRM_TTL_MINUTES = 5;

/**
 * Step 4 — carries out what the natural-language front door decided.
 *
 * Safety rules:
 *  - Asking ("what do I have today?") runs the normal `tasks` command straight away.
 *  - ANY change (done / assign) is first described back to the person and only happens after they reply YES.
 *  - The change itself is performed by the existing commands (`done N`, `done all`, `assign …`),
 *    so every existing permission, lock and audit rule still applies. Nothing here writes tasks directly.
 */
export class TaskGatewayExecutor {
    private static today(date?: string): string {
        return date || new Date().toISOString().slice(0, 10);
    }

    private static async askToConfirm(params: {
        phone: string;
        shouldSend: boolean;
        commands: string[];
        taskIds?: string[];
        summary: string;
    }): Promise<CommandExecutionResult> {
        await TaskDatabaseService.setConversationContext({
            phone: params.phone,
            system: 'TASK_MANAGER',
            contextType: 'NL_CONFIRM',
            contextData: { commands: params.commands, taskIds: params.taskIds || [], summary: params.summary },
            ttlMinutes: CONFIRM_TTL_MINUTES,
        });

        const reply = [
            `🤔 Just to confirm: ${params.summary}.`,
            ``,
            `Reply *YES* to go ahead or *NO* to cancel.`
        ].join('\n');
        if (params.shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
        return { success: true, command: 'confirm_pending', replyText: reply };
    }

    static async handle(params: {
        phone: string;
        decision: GatewayDecision;
        date?: string;
        sendReply?: boolean;
    }): Promise<CommandExecutionResult> {
        const shouldSend = params.sendReply ?? true;
        const date = this.today(params.date);
        const run = (text: string) => TaskCommandHandler.handleCommand({ phone: params.phone, text, date, sendReply: shouldSend });
        const decision = params.decision;

        // Asking is always safe
        if (decision.kind === 'task_query') return run('tasks');

        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee) return run('tasks'); // the normal handler gives the "not registered" reply

        if (decision.kind === 'task_assign') {
            return this.assign(params.phone, employee, decision.targetName, decision.title, shouldSend);
        }

        if (decision.kind === 'task_complete_all' || decision.kind === 'task_complete') {
            const tasks = await TaskDatabaseService.getDailyAssignments({ employeeId: employee.id, date });
            if (tasks.length === 0) return run('tasks');

            let numbers: number[];
            if (decision.kind === 'task_complete_all') {
                numbers = tasks.map((_, i) => i + 1);
            } else {
                numbers = decision.numbers.filter(n => n >= 1 && n <= tasks.length);
                if (numbers.length === 0 && decision.hint) {
                    const n = matchTaskByHint(decision.hint, tasks.map(t => t.title));
                    if (n) numbers = [n];
                }
            }

            if (numbers.length === 0) {
                const list = tasks.map((t, i) => `${i + 1}. ${t.title} [${t.status === 'completed' ? 'Completed ✅' : 'Pending ⏳'}]`).join('\n');
                const reply = [
                    `I couldn't tell which task you mean.`,
                    ``,
                    list,
                    ``,
                    `Reply "done <number>" for the one you finished.`
                ].join('\n');
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return { success: false, command: 'unknown', employee, replyText: reply };
            }

            const pending = numbers.filter(n => tasks[n - 1].status !== 'completed');
            if (pending.length === 0) return run(`done ${numbers[0]}`); // the normal handler says "already completed"

            if (decision.kind === 'task_complete_all') {
                return this.askToConfirm({
                    phone: params.phone,
                    shouldSend,
                    commands: ['done all'],
                    taskIds: tasks.filter(t => t.status !== 'completed').map(t => t.id),
                    summary: `mark all ${pending.length} of your pending task${pending.length === 1 ? '' : 's'} as done`,
                });
            }

            return this.askToConfirm({
                phone: params.phone,
                shouldSend,
                commands: pending.map(n => `done ${n}`),
                taskIds: pending.map(n => tasks[n - 1].id),
                summary: `mark ${pending.map(n => `#${n} "${tasks[n - 1].title}"`).join(', ')} as done`,
            });
        }

        // 'facility' / 'unclear' are not handled here
        return run('tasks');
    }

    private static async say(phone: string, shouldSend: boolean, text: string) {
        if (shouldSend) await TaskMessagingService.sendMessage(phone, text);
    }

    /**
     * "give <name> a task …": the name is looked up among the people this person may really assign to.
     * No match → say so. Several matches (two Rajeshes) → ask which. One match → ask to confirm, using the exact person.
     */
    private static async assign(phone: string, employee: { id: string; name: string; department_name?: string | null }, targetName: string, title: string, shouldSend: boolean): Promise<CommandExecutionResult> {
        const isSelf = targetName === 'me';
        const everyone = await TaskDatabaseService.getAllEmployees();
        const allowed = await PermissionService.visibleAndAssignable(employee as never, everyone);

        const matches = isSelf ? allowed.filter(e => e.id === employee.id) : matchByName(targetName, allowed);

        if (matches.length === 0) {
            const reply = `I couldn't find "${targetName}" among the people you can assign tasks to. Check the spelling, or use their full name.`;
            await this.say(phone, shouldSend, reply);
            return { success: false, command: 'assign_task', replyText: reply };
        }

        if (matches.length > 1) {
            const options: PickOption[] = matches.slice(0, 8).map(m => ({ type: 'person', id: m.id, label: `${m.name}${m.department_name ? ` (${m.department_name})` : ''}` }));
            await TaskDatabaseService.setConversationContext({
                phone, system: 'TASK_MANAGER', contextType: 'NL_PICK',
                contextData: { purpose: 'assign', options, title }, ttlMinutes: CONFIRM_TTL_MINUTES,
            });
            const prompt = `Which one do you mean?\n\n${options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}\n\nReply with the number.`;
            await this.say(phone, shouldSend, prompt);
            return { success: true, command: 'pick_pending', replyText: prompt };
        }

        const who = matches[0];
        return this.askToConfirm({
            phone,
            shouldSend,
            commands: [`assign ${who.id} ${title}`], // by exact id, so the right person is chosen even when names repeat
            summary: `give ${isSelf ? 'yourself' : who.name} the task "${title}"`,
        });
    }

    /** Superuser read-only question ("how is Procurement doing?"). */
    static async handleInsight(params: { phone: string; decision: InsightDecision; date?: string; sendReply?: boolean; question?: string }): Promise<CommandExecutionResult> {
        const shouldSend = params.sendReply ?? true;
        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee || employee.role !== 'superuser') {
            const reply = `Company-wide questions are only available to superusers.`;
            await this.say(params.phone, shouldSend, reply);
            return { success: false, command: 'unknown', replyText: reply };
        }

        const result = await SuperuserInsights.run({ actor: employee, decision: params.decision, date: params.date, question: params.question });
        if (result.kind === 'reply') {
            await this.say(params.phone, shouldSend, result.text);
            return { success: true, command: 'insight', employee, replyText: result.text };
        }

        await TaskDatabaseService.setConversationContext({
            phone: params.phone, system: 'TASK_MANAGER', contextType: 'NL_PICK',
            contextData: { purpose: 'insight', options: result.options, decision: params.decision, question: params.question || '' }, ttlMinutes: CONFIRM_TTL_MINUTES,
        });
        await this.say(params.phone, shouldSend, result.prompt);
        return { success: true, command: 'pick_pending', employee, replyText: result.prompt };
    }

    /** The number the person sent after "Which one do you mean?". */
    static async handlePick(params: { phone: string; pick: number; date?: string; sendReply?: boolean }): Promise<CommandExecutionResult> {
        const shouldSend = params.sendReply ?? true;
        const ctx = await TaskDatabaseService.getConversationContext(params.phone, 'TASK_MANAGER');
        const options: PickOption[] = Array.isArray(ctx?.context_data?.options) ? ctx!.context_data.options : [];
        const chosen = options[params.pick - 1];
        if (!ctx || ctx.context_type !== 'NL_PICK' || !chosen) {
            const reply = `That choice has expired. Please ask again.`;
            await this.say(params.phone, shouldSend, reply);
            return { success: false, command: 'unknown', replyText: reply };
        }

        await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');

        if (ctx.context_data.purpose === 'assign') {
            return this.askToConfirm({
                phone: params.phone,
                shouldSend,
                commands: [`assign ${chosen.id} ${ctx.context_data.title}`],
                summary: `give ${chosen.label.replace(/ \(.*\)$/, '')} the task "${ctx.context_data.title}"`,
            });
        }

        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee || employee.role !== 'superuser') {
            const reply = `Company-wide questions are only available to superusers.`;
            await this.say(params.phone, shouldSend, reply);
            return { success: false, command: 'unknown', replyText: reply };
        }
        const result = await SuperuserInsights.run({
            actor: employee, decision: ctx.context_data.decision, date: params.date, question: ctx.context_data.question,
            picked: { type: chosen.type, id: chosen.id },
        });
        const text = result.kind === 'reply' ? result.text : result.prompt;
        await this.say(params.phone, shouldSend, text);
        return { success: true, command: 'insight', employee, replyText: text };
    }

    /** What a superuser can do, sent when they ask for "help". */
    static async sendSuperuserGuide(phone: string, sendReply = true): Promise<CommandExecutionResult> {
        await this.say(phone, sendReply, SUPERUSER_GUIDE);
        return { success: true, command: 'insight', replyText: SUPERUSER_GUIDE };
    }

    /** Handles the YES / NO that follows a confirmation question. */
    static async confirm(params: {
        phone: string;
        answer: 'yes' | 'no';
        date?: string;
        sendReply?: boolean;
    }): Promise<CommandExecutionResult> {
        const shouldSend = params.sendReply ?? true;
        const date = this.today(params.date);
        const say = async (reply: string) => {
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
        };

        const ctx = await TaskDatabaseService.getConversationContext(params.phone, 'TASK_MANAGER');
        if (!ctx || ctx.context_type !== 'NL_CONFIRM') {
            const reply = `There's nothing waiting for confirmation. Reply "tasks" to see your tasks.`;
            await say(reply);
            return { success: false, command: 'unknown', replyText: reply };
        }

        const commands: string[] = Array.isArray(ctx.context_data?.commands) ? ctx.context_data.commands : [];
        const taskIds: string[] = Array.isArray(ctx.context_data?.taskIds) ? ctx.context_data.taskIds : [];

        // Clear first so a repeated "yes" can never run the same change twice
        await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');

        if (params.answer === 'no') {
            const reply = `Okay, nothing was changed.`;
            await say(reply);
            await TaskDatabaseService.logAudit({
                eventType: 'nl_gateway_declined',
                details: { commands, channel: 'whatsapp' },
            });
            return { success: true, command: 'confirm_cancelled', replyText: reply };
        }

        // If the list changed while waiting, do not guess: ask them to look again
        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        const doneNumbers = commands.map(c => /^done\s+(\d+)$/i.exec(c)?.[1]).filter(Boolean).map(Number);
        if (employee && doneNumbers.length > 0 && taskIds.length === doneNumbers.length) {
            const tasks = await TaskDatabaseService.getDailyAssignments({ employeeId: employee.id, date });
            const stale = doneNumbers.some((n, i) => tasks[n - 1]?.id !== taskIds[i]);
            if (stale) {
                const reply = `Your task list has changed since I asked. Reply "tasks" to see it, then tell me again.`;
                await say(reply);
                return { success: false, command: 'unknown', replyText: reply };
            }
        }

        await TaskDatabaseService.logAudit({
            eventType: 'nl_gateway_confirmed',
            actorId: employee?.id || null,
            details: { commands, channel: 'whatsapp' },
        });

        let last: CommandExecutionResult | null = null;
        let allOk = true;
        for (const command of commands) {
            last = await TaskCommandHandler.handleCommand({ phone: params.phone, text: command, date, sendReply: shouldSend });
            allOk = allOk && last.success;
        }
        return last ? { ...last, success: allOk } : { success: false, command: 'unknown', replyText: '' };
    }
}
