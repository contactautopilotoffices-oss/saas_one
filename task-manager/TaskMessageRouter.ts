import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskCommandHandler, CommandExecutionResult } from './TaskCommandHandler';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskAccessService } from './TaskAccessService';
import { TaskGatewayExecutor } from './TaskGatewayExecutor';
import { classifyNaturalLanguage, classifyInsight, parseConfirmAnswer, parsePick, GatewayDecision, InsightDecision } from './TaskGateway';
import { SuperuserAIInterpreter } from './SuperuserAIInterpreter';
import { ContextSystem, Employee } from './types';

export type RoutedSystem = 'TASK_MANAGER' | 'FACILITY' | 'AMBIGUOUS';

export interface RouteClassification {
    system: RoutedSystem;
    reason: string;
    isExplicitSwitch: boolean;
    confidence: number;
    disambiguationRequired?: boolean;
    nl?: GatewayDecision;        // Step 4: what the natural-language front door understood
    nlAnswer?: 'yes' | 'no';     // Step 4: the answer to a pending "confirm?" question
    insight?: InsightDecision;   // superuser: a read-only company question
    pick?: number;               // superuser / assign: the number chosen after "Which one do you mean?"
}

export interface RouterExecutionResult {
    handledByTaskManager: boolean;
    system: RoutedSystem;
    classification: RouteClassification;
    taskResult?: CommandExecutionResult;
    replySent?: string;
}

export class TaskMessageRouter {
    /**
     * Step 4: is the natural-language front door usable for this sender?
     * Requires the switch to be ON, a registered employee, and an unlocked Task Manager (Step 3).
     * Returns false for everyone otherwise, so the old behaviour is untouched.
     */
    private static async naturalLanguageEmployee(phone: string): Promise<Employee | null> {
        const config = await TaskDatabaseService.getTestingConfig();
        if (config?.nlGatewayEnabled !== true) return null;
        const employee = await TaskDatabaseService.getEmployeeByPhone(phone);
        if (!employee) return null;
        const access = await TaskAccessService.check({ userId: employee.id, departmentId: employee.department_id });
        return access.allowed ? employee : null;
    }

    /**
     * Determines whether an incoming message belongs to TASK_MANAGER, FACILITY, or requires disambiguation.
     */
    static async classifyMessage(phone: string, text: string): Promise<RouteClassification> {
        const clean = text.trim();
        const lower = clean.toLowerCase();

        // 0. Step 4: a YES / NO to a pending "confirm?" question
        const pendingChoiceContext = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
        if (pendingChoiceContext?.context_type === 'NL_CONFIRM') {
            const answer = parseConfirmAnswer(clean);
            if (answer && await this.naturalLanguageEmployee(phone)) {
                return {
                    system: 'TASK_MANAGER',
                    reason: answer === 'yes' ? 'nl_confirm_yes' : 'nl_confirm_no',
                    isExplicitSwitch: false,
                    confidence: 1.0,
                    nlAnswer: answer
                };
            }
        }

        if (pendingChoiceContext?.context_type === 'NL_PICK') {
            const options = Array.isArray(pendingChoiceContext.context_data?.options) ? pendingChoiceContext.context_data.options : [];
            const pick = parsePick(clean, options.length);
            if (pick && await this.naturalLanguageEmployee(phone)) {
                return { system: 'TASK_MANAGER', reason: 'nl_pick', isExplicitSwitch: false, confidence: 1.0, pick };
            }
        }

        // 1. Check if user is currently responding to a 1 / 2 disambiguation prompt
        if (pendingChoiceContext?.context_data?.state === 'AWAITING_SYSTEM_CHOICE') {
            if (/^(?:1|tasks?)$/i.test(lower)) {
                return {
                    system: 'TASK_MANAGER',
                    reason: 'user_selected_task_manager_option_1',
                    isExplicitSwitch: true,
                    confidence: 1.0
                };
            }
            if (/^(?:2|facility|fms)$/i.test(lower)) {
                return {
                    system: 'FACILITY',
                    reason: 'user_selected_facility_option_2',
                    isExplicitSwitch: true,
                    confidence: 1.0
                };
            }
        }

        // 2. Explicit System Switch Commands
        if (/^(tasks|task|view\s*tasks|task\s*manager|my\s*tasks)$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'explicit_task_switch',
                isExplicitSwitch: true,
                confidence: 1.0
            };
        }

        if (/^(facility|fms|helpdesk|facility\s*bot)$/i.test(lower)) {
            return {
                system: 'FACILITY',
                reason: 'explicit_facility_switch',
                isExplicitSwitch: true,
                confidence: 1.0
            };
        }

        if (/^cancel$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'cancel_command',
                isExplicitSwitch: true,
                confidence: 1.0
            };
        }

        // 3. Deterministic Task Manager Commands
        if (/^(?:done|complete|finish)\s+\d+$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'done_number_pattern',
                isExplicitSwitch: false,
                confidence: 0.99
            };
        }

        if (/^(?:done\s*all|complete\s*all|finished\s*all|all\s*done)$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'done_all_pattern',
                isExplicitSwitch: false,
                confidence: 0.99
            };
        }

        if (/^(?:status|today'?s?\s*tasks)$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'task_status_pattern',
                isExplicitSwitch: false,
                confidence: 0.95
            };
        }

        if (/^assign(?:\s+.*)?$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'assign_task_pattern',
                isExplicitSwitch: false,
                confidence: 0.99
            };
        }

        if (/^(?:team|team\s*status|view\s*team\s*tasks|dept|department)$/i.test(lower)) {
            return {
                system: 'TASK_MANAGER',
                reason: 'team_status_pattern',
                isExplicitSwitch: false,
                confidence: 0.99
            };
        }

        // 4. Deterministic Facility Bot Keywords
        if (/(?:book\s*(?:a\s*)?(?:meeting\s*)?room|meeting\s*room|conference\s*room|raise\s*(?:a\s*)?ticket|fms\s*ticket|ac\s*not\s*working|leakage|cleaning\s*request)/i.test(lower)) {
            return {
                system: 'FACILITY',
                reason: 'facility_intent_pattern',
                isExplicitSwitch: false,
                confidence: 0.95
            };
        }

        // 4c. Step 4: natural-language front door (only when switched ON and the person is unlocked)
        const nlEmployee = await this.naturalLanguageEmployee(phone);
        const nlAllowed = !!nlEmployee;
        if (nlEmployee) {
            const isSuperuser = nlEmployee.role === 'superuser';

            // Superusers: company-wide questions are read first (they are specific question shapes)
            if (isSuperuser) {
                if (['help', 'commands', 'what can i ask', 'what can i do', 'what can you do'].includes(lower.replace(/[?!.]+$/, ''))) {
                    return { system: 'TASK_MANAGER', reason: 'nl_superuser_help', isExplicitSwitch: false, confidence: 1.0 };
                }
                const insight = classifyInsight(clean);
                if (insight) {
                    return { system: 'TASK_MANAGER', reason: 'nl_insight', isExplicitSwitch: false, confidence: 0.9, insight };
                }
            }

            const decision = classifyNaturalLanguage(clean);
            if (decision.kind === 'facility') {
                return {
                    system: 'FACILITY',
                    reason: 'nl_facility',
                    isExplicitSwitch: false,
                    confidence: 0.85,
                    nl: decision
                };
            }
            if (decision.kind !== 'unclear') {
                return {
                    system: 'TASK_MANAGER',
                    reason: `nl_${decision.kind}`,
                    isExplicitSwitch: false,
                    confidence: 0.85,
                    nl: decision
                };
            }

            // Unclear to the rules: a superuser's message may be read by the AI (it only reads; changes still ask "confirm?")
            if (isSuperuser) {
                const departments = (await TaskDatabaseService.getDepartments()).map(d => d.name);
                const ai = await SuperuserAIInterpreter.interpret(clean, { departments });
                if (ai && ai.kind === 'task_assign') {
                    return { system: 'TASK_MANAGER', reason: 'nl_task_assign', isExplicitSwitch: false, confidence: 0.8, nl: ai };
                }
                if (ai) {
                    return { system: 'TASK_MANAGER', reason: 'nl_insight', isExplicitSwitch: false, confidence: 0.8, insight: ai };
                }
            }
        }

        // 5. Active Context in Database
        const taskContext = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
        const facilityContext = await TaskDatabaseService.getConversationContext(phone, 'FACILITY');

        // Step 4: an unclear message during an old Task Manager session no longer gets stuck in it:
        // the person is asked what they want (tasks or facility) instead of receiving a task-help reply.
        if (nlAllowed && taskContext && !facilityContext
            && taskContext.context_data?.state !== 'AWAITING_SYSTEM_CHOICE'
            && taskContext.context_type !== 'NL_CONFIRM') {
            return {
                system: 'AMBIGUOUS',
                reason: 'nl_unclear_in_task_session',
                isExplicitSwitch: false,
                confidence: 0.6,
                disambiguationRequired: true
            };
        }

        if (taskContext && !facilityContext && taskContext.context_data?.state !== 'AWAITING_SYSTEM_CHOICE') {
            return {
                system: 'TASK_MANAGER',
                reason: 'active_task_context',
                isExplicitSwitch: false,
                confidence: 0.8
            };
        }

        if (facilityContext && !taskContext) {
            return {
                system: 'FACILITY',
                reason: 'active_facility_context',
                isExplicitSwitch: false,
                confidence: 0.8
            };
        }

        // 6. Ambiguous Greeting / Help Message for Employees
        const employee = await TaskDatabaseService.getEmployeeByPhone(phone);
        if (employee && /^(help|options|menu|hi|hello|hey|good\s*morning)$/i.test(lower)) {
            // Step 3: only offer the Task Manager option to people who are unlocked; others just continue to Facility.
            const access = await TaskAccessService.check({ userId: employee.id, departmentId: employee.department_id });
            if (access.allowed) {
                return {
                    system: 'AMBIGUOUS',
                    reason: 'ambiguous_employee_greeting_or_help',
                    isExplicitSwitch: false,
                    confidence: 0.6,
                    disambiguationRequired: true
                };
            }
        }

        // 7. Fallback to Facility
        return {
            system: 'FACILITY',
            reason: 'default_facility_fallback',
            isExplicitSwitch: false,
            confidence: 0.5
        };
    }

    /**
     * Entry point for inbound WhatsApp webhook routing:
     * Dispatches task commands, handles explicit switches, or presents disambiguation menu.
     */
    static async routeInboundMessage(params: {
        phone: string;
        text: string;
        messageId?: string;
        date?: string;
        sendReply?: boolean;
    }): Promise<RouterExecutionResult> {
        const shouldSend = params.sendReply ?? true;
        const classification = await this.classifyMessage(params.phone, params.text);
        const lower = params.text.trim().toLowerCase();

        // Audit log
        await TaskDatabaseService.logAudit({
            eventType: 'whatsapp_received',
            details: {
                phoneMasked: params.phone.replace(/(\d{4})\d+(\d{2})/, '$1****$2'),
                system: classification.system,
                reason: classification.reason,
                messageId: params.messageId || null
            }
        });

        // Check test whitelist if active (Testing phase safeguard)
        const testingConfig = await TaskDatabaseService.getTestingConfig();
        // Step 4: when the natural-language gateway is ON, the Task Manager lock (Step 3) decides who may chat,
        // so the old sandbox whitelist no longer blocks inbound messages.
        if (testingConfig?.enabled && testingConfig?.nlGatewayEnabled !== true) {
            const senderLast10 = params.phone.replace(/\D/g, '').slice(-10);
            const isManager = testingConfig.manager?.phone && testingConfig.manager.phone.replace(/\D/g, '').slice(-10) === senderLast10;
            const isTestEmp = (testingConfig.employees || []).some(e => e.phone?.replace(/\D/g, '').slice(-10) === senderLast10);
            if (!isManager && !isTestEmp) {
                return {
                    handledByTaskManager: false,
                    system: 'FACILITY',
                    classification: {
                        system: 'FACILITY',
                        reason: 'not_in_test_whitelist',
                        isExplicitSwitch: false,
                        confidence: 1.0
                    }
                };
            }
        }

        // ── Case A: Ambiguous Prompt (Phase 16 Specification) ─────────────────
        if (classification.system === 'AMBIGUOUS') {
            await TaskDatabaseService.setConversationContext({
                phone: params.phone,
                system: 'TASK_MANAGER',
                contextType: 'DISAMBIGUATION',
                contextData: { state: 'AWAITING_SYSTEM_CHOICE' },
                ttlMinutes: 10
            });

            const prompt = [
                `What would you like to do? 🤔`,
                ``,
                `1. Manage tasks (View/complete today's tasks)`,
                `2. Facility services (Book meeting room, raise maintenance ticket)`,
                ``,
                `Reply "1" for Tasks, or "2" for Facility services.`
            ].join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, prompt);

            return {
                handledByTaskManager: true,
                system: 'AMBIGUOUS',
                classification,
                replySent: prompt
            };
        }

        // ── Case B: Explicit Switch to FACILITY ────────────────────────────────
        if (classification.reason === 'explicit_facility_switch' || classification.reason === 'user_selected_facility_option_2') {
            await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');
            await TaskDatabaseService.setConversationContext({
                phone: params.phone,
                system: 'FACILITY',
                contextType: 'ACTIVE_SESSION',
                ttlMinutes: 30
            });

            const reply = `🏢 Switched to Facility Bot.\n\nYou can book meeting rooms, raise maintenance tickets, or check status.\nReply "tasks" anytime to return to your tasks.`;
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);

            return {
                handledByTaskManager: true,
                system: 'FACILITY',
                classification,
                replySent: reply
            };
        }

        // ── Case C: Handled by TASK_MANAGER ──────────────────────────────────
        if (classification.system === 'TASK_MANAGER') {
            // Superuser guide, "Which one?" answers and company questions
            if (classification.reason === 'nl_superuser_help') {
                const taskResult = await TaskGatewayExecutor.sendSuperuserGuide(params.phone, shouldSend);
                return { handledByTaskManager: true, system: 'TASK_MANAGER', classification, taskResult };
            }
            if (classification.pick) {
                const taskResult = await TaskGatewayExecutor.handlePick({ phone: params.phone, pick: classification.pick, date: params.date, sendReply: shouldSend });
                return { handledByTaskManager: true, system: 'TASK_MANAGER', classification, taskResult };
            }
            if (classification.insight) {
                const taskResult = await TaskGatewayExecutor.handleInsight({ phone: params.phone, decision: classification.insight, date: params.date, sendReply: shouldSend, question: params.text });
                return { handledByTaskManager: true, system: 'TASK_MANAGER', classification, taskResult };
            }

            // Step 4: YES / NO to a pending confirmation
            if (classification.nlAnswer) {
                const taskResult = await TaskGatewayExecutor.confirm({
                    phone: params.phone,
                    answer: classification.nlAnswer,
                    date: params.date,
                    sendReply: shouldSend
                });
                return { handledByTaskManager: true, system: 'TASK_MANAGER', classification, taskResult };
            }

            // Step 4: a natural-language task message (asks, or asks "confirm?" before any change)
            if (classification.nl) {
                const taskResult = await TaskGatewayExecutor.handle({
                    phone: params.phone,
                    decision: classification.nl,
                    date: params.date,
                    sendReply: shouldSend
                });
                return { handledByTaskManager: true, system: 'TASK_MANAGER', classification, taskResult };
            }

            // If user just chose option 1 from menu, normalize text to 'tasks'
            const textToExecute = classification.reason === 'user_selected_task_manager_option_1' ? 'tasks' : params.text;

            const taskResult = await TaskCommandHandler.handleCommand({
                phone: params.phone,
                text: textToExecute,
                date: params.date,
                sendReply: shouldSend
            });

            return {
                handledByTaskManager: true,
                system: 'TASK_MANAGER',
                classification,
                taskResult
            };
        }

        // ── Case D: Passthrough to FACILITY Bot ────────────────────────────────
        // Step 4: a room / ticket request ends any old Task Manager session so it cannot hijack the next replies.
        if (classification.reason === 'nl_facility') {
            await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');
        }

        return {
            handledByTaskManager: false,
            system: 'FACILITY',
            classification
        };
    }
}
