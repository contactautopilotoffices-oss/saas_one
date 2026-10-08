import { AiSensyService } from '@/backend/services/AiSensyService';
import { TaskDatabaseService } from './TaskDatabaseService';
import type { WhatsAppKillSwitches } from './types';
import { providerIds } from '@/backend/lib/whatsapp/interpreter/delivery.mjs';
import { recordOutgoingContext } from '@/backend/lib/whatsapp/interpreter/context';
import { randomUUID } from 'node:crypto';

const PROJECT_API_BASE = 'https://apis.aisensy.com/project-apis/v1/project';

/** 'send' = deliver to WhatsApp, 'pretend' = save to history only, 'blocked' = stopped by a kill switch / safety failure */
export type SendMode = 'send' | 'pretend' | 'blocked';

export interface SendControls {
    killSwitches: WhatsAppKillSwitches;
    pretendMode: boolean;
}

export interface GateOptions {
    departmentId?: string;
    ruleType?: string;
    messageType?: string;
    bypassKillSwitch?: boolean; // Bypasses kill switches only. NEVER bypasses Pretend Mode.
}

export class TaskMessagingService {
    private static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    private static maskPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        return digits.length > 4 ? `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}` : '••••';
    }

    /**
     * Pure decision function (no I/O) so the safety rules can be unit-tested offline.
     * Order: kill switches first (global → department → message type), then Pretend Mode.
     */
    static decideSendMode(controls: SendControls, options?: GateOptions): { mode: SendMode; reason?: string } {
        const killSwitches = controls.killSwitches;

        if (!options?.bypassKillSwitch) {
            // 1. Global Emergency Kill Switch
            if (killSwitches.globalHalt) {
                const reason = killSwitches.haltReason
                    ? `Global Kill Switch ACTIVE: ${killSwitches.haltReason}`
                    : 'Global Kill Switch ACTIVE: All automated WhatsApp messaging is halted company-wide.';
                return { mode: 'blocked', reason };
            }

            // 2. Department-Level Kill Switch
            if (options?.departmentId && killSwitches.departmentHalt?.[options.departmentId]) {
                return {
                    mode: 'blocked',
                    reason: `Department Kill Switch ACTIVE: WhatsApp messaging is currently paused for this department.`
                };
            }

            // 3. Message-Type Kill Switch
            const rawType = options?.messageType || options?.ruleType;
            if (rawType && killSwitches.messageTypeHalt) {
                const isHalted = (killSwitches.messageTypeHalt as Record<string, boolean | undefined>)[rawType];
                if (isHalted) {
                    return {
                        mode: 'blocked',
                        reason: `Message Category Kill Switch ACTIVE: Notifications of type '${rawType}' are currently paused.`
                    };
                }
            }
        }

        // 4. Pretend Mode: nothing is delivered, the message is only saved to history
        if (controls.pretendMode) {
            return { mode: 'pretend', reason: 'Pretend Mode is ON: message was saved to history and NOT sent.' };
        }

        return { mode: 'send' };
    }

    /**
     * Central WhatsApp gate. FAILS CLOSED: if the safety settings cannot be read, nothing is sent.
     */
    static async resolveSendMode(options?: GateOptions): Promise<{ mode: SendMode; reason?: string }> {
        let controls: SendControls;
        try {
            controls = await TaskDatabaseService.getSendControls();
        } catch (err: any) {
            console.error('[TaskMessagingService] Could not read WhatsApp safety settings; withholding message:', err?.message);
            return { mode: 'blocked', reason: 'Safety settings could not be read; sending is withheld as a precaution.' };
        }
        return this.decideSendMode(controls, options);
    }

    /**
     * Back-compat wrapper. `allowed` is true for both 'send' and 'pretend' (nothing reaches WhatsApp in pretend);
     * use resolveSendMode() when you need to know which one it is.
     */
    static async isMessagingAllowed(options?: GateOptions): Promise<{ allowed: boolean; reason?: string }> {
        const gate = await this.resolveSendMode(options);
        return gate.mode === 'blocked' ? { allowed: false, reason: gate.reason } : { allowed: true };
    }

    /** Saves a "would have been sent" record so the admin can read exactly what the user would have received. */
    private static async logPretend(params: {
        phone: string;
        preview: string;
        options?: GateOptions;
    }): Promise<void> {
        const type = params.options?.ruleType || params.options?.messageType || 'bot_reply';
        await TaskDatabaseService.logAudit({
            eventType: 'whatsapp_sent',
            details: {
                type,
                ruleName: type === 'bot_reply' ? 'Bot reply' : type,
                employeeName: 'WhatsApp recipient',
                phone: this.maskPhone(params.phone),
                departmentId: params.options?.departmentId || null,
                dryRun: true,
                status: 'simulated',
                pretend: true,
                preview: params.preview,
            },
        });
    }

    private static async logBlocked(phone: string, reason: string | undefined, options?: GateOptions): Promise<void> {
        await TaskDatabaseService.logAudit({
            event_type: 'whatsapp_blocked_by_kill_switch',
            actor_id: null,
            target_employee_id: null,
            task_id: null,
            details: {
                phone: this.maskPhone(phone),
                reason,
                departmentId: options?.departmentId,
                ruleType: options?.ruleType,
                messageType: options?.messageType || options?.ruleType,
                blockedAt: new Date().toISOString(),
            },
        }).catch(err => {
            console.warn('[TaskMessagingService] Failed to record blocked-message audit log:', err?.message);
        });
    }

    /**
     * Raw network call to the AiSensy Project (Direct) API. Private on purpose:
     * every caller must pass through the gate in sendMessage / sendFreeformReply.
     */
    private static async postFreeform(phone: string, text: string): Promise<boolean> {
        const destination = this.formatPhone(phone);
        const projectId = process.env.AISENSY_PROJECT_ID;
        const password = process.env.AISENSY_PROJECT_API_KEY;

        if (!projectId || !password) {
            console.warn('[TaskMessagingService] AISENSY_PROJECT_ID or AISENSY_PROJECT_API_KEY not configured. Falling back to template send.');
            return false;
        }

        try {
            const res = await fetch(`${PROJECT_API_BASE}/${encodeURIComponent(projectId)}/messages`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-AiSensy-Project-API-Pwd': password,
                },
                body: JSON.stringify({
                    to: destination,
                    type: 'text',
                    recipient_type: 'individual',
                    text: { body: text },
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.error(`[TaskMessagingService] Freeform send failed with status ${res.status}:`, body);
                return false;
            }

            if (process.env.WHATSAPP_LLM_INTERPRETER_ENABLED === 'true') {
                const body = await res.json().catch(() => null);
                await recordOutgoingContext(destination, providerIds(body), { workflow:'task', conversationId:randomUUID() })
                    .catch(() => console.warn('[TaskMessagingService] Reply context could not be saved'));
            }
            return true;
        } catch (error) {
            console.error('[TaskMessagingService] Freeform send network error:', error);
            return false;
        }
    }

    /** Raw template call. Private on purpose: callers must pass through the gate. */
    private static async postTemplate(params: {
        phone: string;
        campaignName?: string;
        templateParams: string[];
    }): Promise<boolean> {
        const campaignName = params.campaignName || this.getCampaignForRuleType();
        const res = await AiSensyService.sendTemplate({
            phone: params.phone,
            campaignName,
            templateParams: params.templateParams,
        });
        if (res.success && res.messageIds?.length) await recordOutgoingContext(this.formatPhone(params.phone),res.messageIds,{workflow:'task',conversationId:randomUUID()})
            .catch(() => console.warn('[TaskMessagingService] Template reply context could not be saved'));
        return res.success;
    }

    /**
     * Sends a direct free-form WhatsApp message inside the 24-hour service window.
     * Gated: honours kill switches and Pretend Mode.
     */
    static async sendFreeformReply(phone: string, text: string): Promise<boolean> {
        const gate = await this.resolveSendMode();
        if (gate.mode === 'blocked') {
            await this.logBlocked(phone, gate.reason);
            return false;
        }
        if (gate.mode === 'pretend') {
            await this.logPretend({ phone, preview: text });
            return true;
        }
        return this.postFreeform(phone, text);
    }

    /**
     * Resolves the Meta-approved campaign name corresponding to the notification rule type.
     * Supports environment variable overrides and falls back to the newly approved dedicated templates.
     */
    static getCampaignForRuleType(ruleType?: string): string {
        switch (ruleType) {
            case 'morning_digest':
                return process.env.AISENSY_TASK_MORNING_CAMPAIGN || 'task_morning_kickoff_v1';
            case 'pending_reminder':
                return process.env.AISENSY_TASK_MIDDAY_CAMPAIGN || 'task_midday_reminder_v1';
            case 'eod_summary':
                return process.env.AISENSY_TASK_EOD_CAMPAIGN || 'task_eod_summary_v1';
            case 'overdue_alert':
                return process.env.AISENSY_TASK_MIDDAY_CAMPAIGN || 'task_midday_reminder_v1';
            default:
                return process.env.AISENSY_TASK_MORNING_CAMPAIGN || process.env.AISENSY_TASK_CAMPAIGN_NAME || 'task_morning_kickoff_v1';
        }
    }

    /**
     * Sends an outbound notification via pre-approved template.
     * Gated: honours kill switches and Pretend Mode.
     */
    static async sendTemplateNotification(params: {
        phone: string;
        campaignName?: string;
        templateParams: string[];
    }): Promise<boolean> {
        const gate = await this.resolveSendMode();
        if (gate.mode === 'blocked') {
            await this.logBlocked(params.phone, gate.reason);
            return false;
        }
        if (gate.mode === 'pretend') {
            await this.logPretend({
                phone: params.phone,
                preview: `[Template ${params.campaignName || this.getCampaignForRuleType()}] ${params.templateParams.join(' | ')}`,
            });
            return true;
        }
        return this.postTemplate(params);
    }

    /**
     * Onboarding kickoff templates (manager / employee). Same gate as every other message.
     * Returns `pretend: true` when nothing was delivered, so callers must NOT record the kickoff as sent.
     */
    static async sendKickoffTemplate(params: {
        phone: string;
        campaignName: string;
        templateParams: string[];
        departmentId?: string | null;
        messageType: 'manager_kickoff' | 'employee_kickoff';
    }): Promise<{ success: boolean; pretend?: boolean; blocked?: boolean; error?: string }> {
        const gateOptions: GateOptions = {
            departmentId: params.departmentId || undefined,
            messageType: params.messageType,
        };
        const gate = await this.resolveSendMode(gateOptions);

        if (gate.mode === 'blocked') {
            await this.logBlocked(params.phone, gate.reason, gateOptions);
            return { success: false, blocked: true, error: gate.reason };
        }

        if (gate.mode === 'pretend') {
            await this.logPretend({
                phone: params.phone,
                preview: `[Template ${params.campaignName}] ${params.templateParams.join(' | ')}`,
                options: gateOptions,
            });
            return { success: true, pretend: true };
        }

        const res = await AiSensyService.sendTemplate({
            phone: params.phone,
            campaignName: params.campaignName,
            templateParams: params.templateParams,
        });
        return { success: res.success, error: res.success ? undefined : (res.error || 'Failed to dispatch template') };
    }

    /**
     * Unified message dispatcher:
     * 1. Evaluates the gate once (kill switches, then Pretend Mode; fails closed).
     * 2. Attempts freeform reply first (within 24h session window).
     * 3. Falls back to Meta-approved template campaign if freeform fails.
     */
    static async sendMessage(
        phone: string,
        text: string,
        options?: {
            departmentId?: string;
            ruleType?: string;
            messageType?: string;
            campaignName?: string;
            templateParams?: string[];
            bypassKillSwitch?: boolean;
        }
    ): Promise<boolean> {
        const gate = await this.resolveSendMode(options);

        if (gate.mode === 'blocked') {
            console.warn(`[TaskMessagingService] 🛑 Message to ${this.maskPhone(phone)} blocked: ${gate.reason}`);
            await this.logBlocked(phone, gate.reason, options);
            return false;
        }

        if (gate.mode === 'pretend') {
            await this.logPretend({ phone, preview: text, options });
            return true;
        }

        const sent = await this.postFreeform(phone, text);
        if (sent) return true;

        // Fallback to Meta-approved template if outside 24h window or freeform fails
        const campaignName = options?.campaignName || this.getCampaignForRuleType(options?.ruleType);
        const params = options?.templateParams && options.templateParams.length > 0
            ? options.templateParams
            : [text];

        return this.postTemplate({
            phone,
            campaignName,
            templateParams: params,
        });
    }

    static async sendFreeformMessage(phone: string, text: string): Promise<boolean> {
        return this.sendMessage(phone, text);
    }
}
