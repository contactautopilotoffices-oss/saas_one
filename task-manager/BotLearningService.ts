import { supabaseAdmin } from '@/backend/lib/supabase/admin';
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase JSON columns and admin payloads are validated at this boundary */
import { botSwitchOn } from './BotSwitches';
import { phoneKey } from './InboundLedger';
import { learningTriggers, sanitizeReplayContext, validateReviewLabel, type LearningTrigger } from './LearningLoop';
import { TaskDatabaseService } from './TaskDatabaseService';
import type { BrainContext } from './brain/types';
import { BUILTIN_PROMPT_SECTIONS, type PromptSections, validatePromptSections } from './brain/prompt';

const REVIEW = 'whatsapp_bot_review_items', CASES = 'whatsapp_bot_eval_cases', PROMPTS = 'whatsapp_bot_prompts';
const warn = (where: string, e: unknown) => console.warn(`[BotLearning] ${where}:`, e instanceof Error ? e.message : (e as any)?.message || e);

export interface AlertAdmin { name: string; phone: string }
export function validateAlertAdmins(value: unknown): AlertAdmin[] {
    if (!Array.isArray(value)) throw new Error('Alert recipients must be a list.');
    if (value.length > 10) throw new Error('At most 10 alert recipients are allowed.');
    return value.map((x: any) => {
        const name = String(x?.name || '').trim().slice(0, 80), phone = String(x?.phone || '').replace(/\D/g, '');
        if (!name || phone.length < 10 || phone.length > 15) throw new Error('Every alert recipient needs a name and a 10–15 digit phone number.');
        return { name, phone };
    });
}

export async function beginObservation(input: { messageId?: string | null; phone?: string | null; text?: string | null; context?: BrainContext | null }): Promise<void> {
    if (!input.messageId || !input.phone || !input.text || !(await botSwitchOn('learningLoop'))) return;
    try {
        const { error } = await supabaseAdmin.from(REVIEW).upsert({ message_id: input.messageId, phone_key: phoneKey(input.phone), message_text: input.text.slice(0, 1500), ...(input.context ? { context_snapshot: sanitizeReplayContext(input.context) } : {}), status: 'provisional', expires_at: new Date(Date.now() + 86400_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'message_id' });
        if (error) warn('begin observation skipped', error);
    } catch (e) { warn('begin observation skipped', e); }
}

export async function observeTurn(input: { messageId?: string | null; phone?: string | null; text: string; context: BrainContext; intent?: string | null; outcome?: string | null; previousOutcome?: string | null; exact?: string | null; apology?: boolean; interpretation?: unknown }): Promise<void> {
    if (!(await botSwitchOn('learningLoop'))) return;
    const triggers = learningTriggers(input);
    try {
        if (!input.messageId) return;
        if (!triggers.length) {
            await supabaseAdmin.from(REVIEW).delete().eq('message_id', input.messageId).eq('status', 'provisional');
            return;
        }
        const { error } = await supabaseAdmin.from(REVIEW).upsert({ message_id: input.messageId, phone_key: phoneKey(input.phone || ''), message_text: input.text.slice(0, 1500), interpretation: input.interpretation ?? null, context_snapshot: sanitizeReplayContext(input.context), triggers, status: 'waiting', expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'message_id' });
        if (error) warn('observe turn skipped', error);
    } catch (e) { warn('observe turn skipped', e); }
}

export async function promoteApology(messageId: string | null | undefined): Promise<void> {
    if (!messageId || !(await botSwitchOn('learningLoop'))) return;
    try {
        const { data } = await supabaseAdmin.from(REVIEW).select('triggers').eq('message_id', messageId).maybeSingle();
        const triggers = [...new Set<LearningTrigger>([...((data?.triggers || []) as LearningTrigger[]), 'apology'])];
        await supabaseAdmin.from(REVIEW).update({ status: 'waiting', triggers, updated_at: new Date().toISOString() }).eq('message_id', messageId);
    } catch (e) { warn('apology promotion skipped', e); }
}

export async function clearAnsweredObservations(phone: string | null | undefined): Promise<void> {
    if (!phone || !(await botSwitchOn('learningLoop'))) return;
    try { await supabaseAdmin.from(REVIEW).delete().eq('phone_key', phoneKey(phone)).eq('status', 'provisional'); }
    catch (e) { warn('answered cleanup skipped', e); }
}

export async function listReviewItems(limit = 30, before?: string | null) {
    let q = supabaseAdmin.from(REVIEW).select('*').eq('status', 'waiting').order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q; if (error) throw error; return data || [];
}
export async function ignoreReview(id: string, actor: string) { const { error } = await supabaseAdmin.from(REVIEW).update({ status: 'ignored', reviewed_at: new Date().toISOString(), reviewed_by: actor, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting'); if (error) throw error; }
export async function labelReview(id: string, raw: unknown, actor: string) { const checked = validateReviewLabel(raw); if (!checked.ok) throw new Error(checked.error); const { data, error } = await supabaseAdmin.rpc('whatsapp_bot_label_review', { p_review_id: id, p_label: checked.value, p_reviewer: actor }); if (error) throw error; return data; }
export async function listPromptVersions() { const { data, error } = await supabaseAdmin.from(PROMPTS).select('*').order('version', { ascending: false }).limit(30); if (error) throw error; return data || []; }
export async function activatePrompt(id: string, actor: string) {
    const [{ data: row, error: readError }, { data: active, error: activeError }] = await Promise.all([
        supabaseAdmin.from(PROMPTS).select('sections').eq('id', id).eq('status', 'waiting').maybeSingle(),
        supabaseAdmin.from(PROMPTS).select('sections').eq('prompt_key', 'task_brain_understand').eq('status', 'active').maybeSingle(),
    ]);
    if (readError || activeError || !row) throw readError || activeError || new Error('Prompt is not waiting.');
    const activeChecked = active ? validatePromptSections(active.sections, { maxChars: 12000, maxBaseChars: 10000 }) : null;
    const baseSections = activeChecked?.ok ? activeChecked.value : BUILTIN_PROMPT_SECTIONS;
    const base = baseSections.steps.concat(baseSections.examples).join('\n').length;
    const valid = validatePromptSections(row.sections, { maxChars: 12000, maxBaseChars: base });
    if (!valid.ok) throw new Error(valid.error);
    const { error } = await supabaseAdmin.rpc('whatsapp_bot_activate_prompt', { p_prompt_id: id, p_actor: actor });
    if (error) throw error;
    resetPromptCache();
}
export async function rejectPrompt(id: string, actor: string) { const { error } = await supabaseAdmin.from(PROMPTS).update({ status: 'rejected', rejection_reason: `Rejected by ${actor}`, updated_at: new Date().toISOString() }).eq('id', id).in('status', ['waiting', 'draft']); if (error) throw error; }
export async function rollbackPrompt(actor: string) { const { error } = await supabaseAdmin.rpc('whatsapp_bot_rollback_prompt', { p_prompt_key: 'task_brain_understand', p_actor: actor }); if (error) throw error; resetPromptCache(); }

let promptCache: { at: number; value: PromptSections } | null = null;
export const resetPromptCache = () => { promptCache = null; };
export async function activePromptSections(): Promise<PromptSections> {
    if (!(await botSwitchOn('promptVersions'))) return BUILTIN_PROMPT_SECTIONS;
    if (promptCache && Date.now() - promptCache.at < 60_000) return promptCache.value;
    try {
        const { data, error } = await supabaseAdmin.from(PROMPTS).select('sections').eq('prompt_key', 'task_brain_understand').eq('status', 'active').maybeSingle();
        if (error || !data) throw error || new Error('no active version');
        const checked = validatePromptSections(data.sections, { maxChars: 12000, maxBaseChars: 10000 });
        if (!checked.ok) throw new Error(checked.error);
        promptCache = { at: Date.now(), value: checked.value }; return checked.value;
    } catch (e) {
        warn('using built-in prompt', e);
        promptCache = { at: Date.now(), value: BUILTIN_PROMPT_SECTIONS };
        return BUILTIN_PROMPT_SECTIONS;
    }
}

export async function saveAlertAdmins(raw: unknown, actor: string) { const botAlertAdmins = validateAlertAdmins(raw); const out = await TaskDatabaseService.saveTestingConfig({ botAlertAdmins }); await TaskDatabaseService.logAudit({ eventType: 'bot_alert_admins_updated', details: { actor, count: botAlertAdmins.length } }); return out.botAlertAdmins || []; }
export async function purgeReviewItems(now = new Date()) { const { data, error } = await supabaseAdmin.from(REVIEW).delete().lt('expires_at', now.toISOString()).in('status', ['provisional', 'waiting', 'ignored']).select('id'); if (error) throw error; return (data || []).length; }
export const tables = { REVIEW, CASES, PROMPTS };
