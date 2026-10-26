import { after } from 'next/server';
import type { AccessDecision } from '../TaskAccessService';
import type { Employee, TestingConfig } from '../types';
import type { BrainResult } from './index';
import type { BrainContext, PendingState } from './types';

/**
 * The language brain — Phase 3: SHADOW MODE.
 *
 * The brain reads a real message beside the old bot and only LOGS what it WOULD have done. It never replies, never changes a
 * task, and never touches the old bot's path: this file does not even import the module that sends WhatsApp messages.
 *
 * Double-gated, so it can never run for the wider team by accident:
 *   1. the environment switch TASK_BRAIN_SHADOW=true, AND
 *   2. the SANDBOX is ON and the sender is one of the sandbox numbers (your own number).
 * The log row holds the brain's INTERPRETATION (intent, outcome, a one-line summary, its drafted reply) — never the person's
 * original words.
 */

export const SHADOW_ENV = 'TASK_BRAIN_SHADOW';
export const SHADOW_EVENT = 'brain_shadow';

const last10 = (p: string) => String(p || '').replace(/\D/g, '').slice(-10);
const mask = (p: string) => `****${String(p || '').replace(/\D/g, '').slice(-4)}`;

export type ShadowSkip = 'switch_off' | 'empty_message' | 'not_employee' | 'locked' | 'sandbox_off' | 'outside_sandbox';

/** Pure: may the brain watch this message? */
export function decideShadow(p: {
    enabled: boolean; text: string; phone: string;
    config: Pick<TestingConfig, 'enabled' | 'manager' | 'employees'>;
    employee: Pick<Employee, 'id'> | null; access: Pick<AccessDecision, 'allowed'> | null;
}): { run: boolean; skip?: ShadowSkip } {
    if (!p.enabled) return { run: false, skip: 'switch_off' };
    if (!String(p.text || '').trim()) return { run: false, skip: 'empty_message' };
    if (!p.employee) return { run: false, skip: 'not_employee' };
    if (!p.access?.allowed) return { run: false, skip: 'locked' };
    if (!p.config.enabled) return { run: false, skip: 'sandbox_off' };
    const me = last10(p.phone);
    const inSandbox = (p.config.manager?.phone && last10(p.config.manager.phone) === me)
        || (p.config.employees || []).some(e => e.phone && last10(e.phone) === me);
    return inSandbox ? { run: true } : { run: false, skip: 'outside_sandbox' };
}

/** What the old bot is waiting on, in the brain's terms (shapes taken from TaskGatewayExecutor and the import flow). */
export function mapPending(ctx: { context_type?: string; context_data?: any } | null): PendingState | null {
    if (!ctx) return null;
    const d = ctx.context_data || {};
    if (ctx.context_type === 'NL_CONFIRM') {
        return { kind: 'confirm', summary: typeof d.summary === 'string' && d.summary ? d.summary : 'a change to your tasks' };
    }
    if (ctx.context_type === 'NL_PICK' && Array.isArray(d.options)) {
        const options = d.options.map((o: any) => (typeof o === 'string' ? o : o?.label)).filter((o: unknown): o is string => typeof o === 'string' && !!o);
        return options.length ? { kind: 'pick', options } : null;
    }
    if (ctx.context_type === 'IMPORT_PREVIEW' && Array.isArray(d.tasks)) return { kind: 'preview', count: d.tasks.length };
    return null;
}

/** The log row. Interpretation only — no original words. */
export function shadowDetails(p: { phone: string; messageId?: string | null; messageChars: number; result: BrainResult; ms: number }) {
    const r = p.result;
    const d: any = r.decision;
    const a: any = d && 'action' in d ? d.action : null;
    return {
        phoneMasked: mask(p.phone), messageId: p.messageId || null, messageChars: p.messageChars, status: r.status,
        intent: r.interpretation?.intent ?? null, confidence: r.interpretation?.confidence ?? null, summary: r.interpretation?.summary ?? null,
        outcome: d?.outcome ?? null, reason: d?.reason ?? null, domain: d?.domain ?? null,
        actionType: a?.type ?? null, actionCount: a ? (a.taskIds?.length ?? a.tasks?.length ?? 1) : 0,
        replyText: r.reply?.text ?? null, replySource: r.reply?.source ?? null,
        models: { understand: r.trace.interpretModel, reply: r.trace.replyModel }, fastPath: r.trace.fastPath,
        ms: p.ms, tokensIn: r.trace.tokensIn, tokensOut: r.trace.tokensOut, failures: r.trace.failures.length,
    };
}

export interface ShadowIO {
    enabled(): boolean;
    getConfig(): Promise<TestingConfig>;
    getEmployee(phone: string): Promise<Employee | null>;
    checkAccess(employee: Employee): Promise<AccessDecision>;
    buildContext(employee: Employee, phone: string): Promise<BrainContext>;
    runBrain(text: string, ctx: BrainContext): Promise<BrainResult>;
    audit(details: Record<string, unknown>, employee: Employee): Promise<void>;
}

/**
 * Watch one inbound message. NEVER throws and NEVER sends: any problem is swallowed, so the old bot is unaffected.
 * Returns what happened, for tests and logs.
 */
export async function observeInShadow(input: { phone: string; text: string; messageId?: string | null }, io?: ShadowIO): Promise<string> {
    try {
        if (!(io ? io.enabled() : process.env[SHADOW_ENV] === 'true')) return 'skipped:switch_off';
        const text = String(input.text || '').trim();
        if (!text) return 'skipped:empty_message';
        const real = io ?? await defaultShadowIO();

        const config = await real.getConfig();
        if (!config.enabled) return 'skipped:sandbox_off'; // before any other read: shadow only ever runs inside the sandbox
        const employee = await real.getEmployee(input.phone);
        const access = employee ? await real.checkAccess(employee) : null;
        const verdict = decideShadow({ enabled: true, text, phone: input.phone, config, employee, access });
        if (!verdict.run || !employee) return `skipped:${verdict.skip}`;

        const started = Date.now();
        const ctx = await real.buildContext(employee, input.phone);
        const result = await real.runBrain(text, ctx);
        await real.audit(shadowDetails({ phone: input.phone, messageId: input.messageId, messageChars: text.length, result, ms: Date.now() - started }), employee);
        return 'logged';
    } catch (err) {
        console.warn('[TaskBrainShadow] skipped after an error (the old bot is unaffected):', err instanceof Error ? err.message : err);
        return 'error';
    }
}

/**
 * What the webhook calls: schedule the watching to run AFTER the webhook has answered, so it can never slow down or change
 * the reply. Outside a web request (tests, scripts) there is nothing to schedule, and that is silently fine.
 */
export function scheduleShadow(input: { phone: string; text: string; messageId?: string | null }): void {
    try {
        after(async () => { await observeInShadow(input); });
    } catch {
        // not inside a request: nothing to do
    }
}

/** The real wiring — READ-ONLY on tasks and people, and it writes exactly one audit row. Loaded lazily. */
async function defaultShadowIO(): Promise<ShadowIO> {
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskAccessService } = await import('../TaskAccessService');
    const { runBrain } = await import('./index');
    const { buildBrainContext } = await import('./context');
    const { engyBrainLlm } = await import('./llm');
    const llm = engyBrainLlm();


    return {
        enabled: () => process.env[SHADOW_ENV] === 'true',
        getConfig: () => TaskDatabaseService.getTestingConfig(),
        getEmployee: phone => TaskDatabaseService.getEmployeeByPhone(phone),
        checkAccess: e => TaskAccessService.check({ userId: e.id, departmentId: e.department_id }),
        async buildContext(emp, phone) {
            const pending = mapPending(await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER'));
            return buildBrainContext(emp, phone, { pending });
        },
        runBrain: (text, ctx) => runBrain(text, ctx, { llm }),
        async audit(details, employee) {
            await TaskDatabaseService.logAudit({ eventType: SHADOW_EVENT, actorId: employee.id, details });
        },
    };
}
