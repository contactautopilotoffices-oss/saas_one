import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskCommandHandler, CommandExecutionResult } from './TaskCommandHandler';
import { TaskMessagingService } from './TaskMessagingService';
import { ContextSystem } from './types';

export type RoutedSystem = 'TASK_MANAGER' | 'FACILITY' | 'AMBIGUOUS';

export interface RouteClassification {
    system: RoutedSystem;
    reason: string;
    isExplicitSwitch: boolean;
    confidence: number;
    disambiguationRequired?: boolean;
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
     * Determines whether an incoming message belongs to TASK_MANAGER, FACILITY, or requires disambiguation.
     */
    static async classifyMessage(phone: string, text: string): Promise<RouteClassification> {
        const clean = text.trim();
        const lower = clean.toLowerCase();

        // 1. Check if user is currently responding to a 1 / 2 disambiguation prompt
        const pendingChoiceContext = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
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

        // 5. Active Context in Database
        const taskContext = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
        const facilityContext = await TaskDatabaseService.getConversationContext(phone, 'FACILITY');

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
            return {
                system: 'AMBIGUOUS',
                reason: 'ambiguous_employee_greeting_or_help',
                isExplicitSwitch: false,
                confidence: 0.6,
                disambiguationRequired: true
            };
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
        return {
            handledByTaskManager: false,
            system: 'FACILITY',
            classification
        };
    }
}
