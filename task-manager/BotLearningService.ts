import { supabaseAdmin } from '@/backend/lib/supabase/admin';
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase JSON columns and admin payloads are validated at this boundary */
import { botSwitchOn } from './BotSwitches';
import { phoneKey } from './InboundLedger';
import { FOLLOW_UP_TRIGGERS, RECENT_KEEP_MS, isRephrase, learningTriggers, sanitizeReplayContext, sanitizeReplyText, validateReviewLabel, type LearningTrigger } from './LearningLoop';
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

/**
 * Bot review upgrade (migration 20261014000001): are the new columns there? Until the owner applies the migration the
 * learning loop keeps its old behaviour exactly. Checked at most every 5 minutes.
 */
let schemaCheck: { at: number; ok: boolean } | null = null;
export const resetReviewSchemaCache = () => { schemaCheck = null; };
export async function reviewSchemaV2(): Promise<boolean> {
    if (schemaCheck && Date.now() - schemaCheck.at < 300_000) return schemaCheck.ok;
    let ok = false;
    try { const { error } = await supabaseAdmin.from(REVIEW).select('bot_reply,follow_up,ai_summary,fix_owner,dev_state').limit(1); ok = !error; }
    catch { ok = false; }
    schemaCheck = { at: Date.now(), ok };
    return ok;
}

const in30Days = () => new Date(Date.now() + 30 * 86400_000).toISOString();

export async function observeTurn(input: { messageId?: string | null; phone?: string | null; text: string; context: BrainContext; intent?: string | null; outcome?: string | null; previousOutcome?: string | null; exact?: string | null; apology?: boolean; interpretation?: unknown; reply?: string | null }): Promise<void> {
    if (!(await botSwitchOn('learningLoop'))) return;
    try {
        if (!input.messageId) return;
        if (!(await reviewSchemaV2())) return await observeTurnLegacy(input);
        const now = Date.now(), key = phoneKey(input.phone || '');
        // The person's previous answered message (kept 10 minutes), so "no, I meant…" / asking again flags THAT message.
        const { data: prev } = await supabaseAdmin.from(REVIEW).select('id,message_text,triggers,updated_at').eq('phone_key', key).eq('status', 'recent')
            .neq('message_id', input.messageId).gt('expires_at', new Date(now).toISOString()).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        const rephrase = !!prev && isRephrase(prev.message_text, input.text, now - Date.parse(prev.updated_at));
        const triggers = learningTriggers({ ...input, rephrase, pending: !!input.context?.pending });
        const followUps = triggers.filter(t => FOLLOW_UP_TRIGGERS.includes(t));
        let own = triggers.filter(t => !FOLLOW_UP_TRIGGERS.includes(t));
        if (followUps.length) {
            if (prev) {
                const { error } = await supabaseAdmin.from(REVIEW).update({ status: 'waiting', triggers: [...new Set([...((prev.triggers || []) as LearningTrigger[]), ...followUps])], follow_up: { text: input.text.slice(0, 1500), at: new Date(now).toISOString() }, expires_at: in30Days(), updated_at: new Date(now).toISOString() }).eq('id', prev.id).eq('status', 'recent');
                if (error) warn('follow-up promotion skipped', error);
            } else own = triggers;   // nothing earlier to point at: review this message itself, as before
        }
        const row = { message_id: input.messageId, phone_key: key, message_text: input.text.slice(0, 1500), interpretation: input.interpretation ?? null, context_snapshot: sanitizeReplayContext(input.context), bot_reply: input.reply ? sanitizeReplyText(input.reply) : null, updated_at: new Date(now).toISOString() };
        if (own.length) {
            const { error } = await supabaseAdmin.from(REVIEW).upsert({ ...row, triggers: own, status: 'waiting', expires_at: in30Days() }, { onConflict: 'message_id' });
            if (error) warn('observe turn skipped', error);
            return;
        }
        // Not a mistake (yet): keep only this person's newest answered message, for 10 minutes.
        await supabaseAdmin.from(REVIEW).delete().eq('phone_key', key).eq('status', 'recent').neq('message_id', input.messageId);
        const { error } = await supabaseAdmin.from(REVIEW).upsert({ ...row, triggers: [], status: 'recent', expires_at: new Date(now + RECENT_KEEP_MS).toISOString() }, { onConflict: 'message_id' });
        if (error) warn('recent turn skipped', error);
    } catch (e) { warn('observe turn skipped', e); }
}

/** The behaviour before the review upgrade, used until its migration is applied. */
async function observeTurnLegacy(input: { messageId?: string | null; phone?: string | null; text: string; context: BrainContext; intent?: string | null; outcome?: string | null; previousOutcome?: string | null; exact?: string | null; apology?: boolean; interpretation?: unknown }): Promise<void> {
    const triggers = learningTriggers(input);
    if (!input.messageId) return;
    if (!triggers.length) {
        await supabaseAdmin.from(REVIEW).delete().eq('message_id', input.messageId).eq('status', 'provisional');
        return;
    }
    const { error } = await supabaseAdmin.from(REVIEW).upsert({ message_id: input.messageId, phone_key: phoneKey(input.phone || ''), message_text: input.text.slice(0, 1500), interpretation: input.interpretation ?? null, context_snapshot: sanitizeReplayContext(input.context), triggers, status: 'waiting', expires_at: in30Days(), updated_at: new Date().toISOString() }, { onConflict: 'message_id' });
    if (error) warn('observe turn skipped', error);
}

export async function promoteApology(messageId: string | null | undefined): Promise<void> {
    if (!messageId || !(await botSwitchOn('learningLoop'))) return;
    try {
        const { data } = await supabaseAdmin.from(REVIEW).select('triggers').eq('message_id', messageId).maybeSingle();
        const triggers = [...new Set<LearningTrigger>([...((data?.triggers || []) as LearningTrigger[]), 'apology'])];
        // expires_at too: the row may be a 10-minute 'recent' one, which must now be kept 30 days like any review item.
        await supabaseAdmin.from(REVIEW).update({ status: 'waiting', triggers, expires_at: in30Days(), updated_at: new Date().toISOString() }).eq('message_id', messageId);
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
/**
 * Delete a review item now (owner 2026-10-15), instead of waiting for the 30-day purge. Only items still waiting for review
 * or ignored: an approved one is a permanent test, and a developer case has its own list. Recorded in the audit log.
 */
export async function deleteReview(id: string, actor: string) {
    const { data, error } = await supabaseAdmin.from(REVIEW).delete().eq('id', id).in('status', ['waiting', 'ignored']).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Only a message waiting for review (or ignored) can be deleted.');
    await TaskDatabaseService.logAudit({ eventType: 'bot_review_deleted', details: { reviewId: id, actor } }).catch(() => undefined);
}

/** Delete a prompt version. Never the one the bot is using now (roll back first). Recorded in the audit log. */
export async function deletePrompt(id: string, actor: string) {
    const { data, error } = await supabaseAdmin.from(PROMPTS).delete().eq('id', id).neq('status', 'active').select('id,version');
    if (error) throw error;
    if (!data?.length) throw new Error('The version the bot is using now cannot be deleted. Roll back first.');
    await TaskDatabaseService.logAudit({ eventType: 'bot_prompt_deleted', details: { promptId: id, version: data[0].version, actor } }).catch(() => undefined);
}

export async function ignoreReview(id: string, actor: string) { const { error } = await supabaseAdmin.from(REVIEW).update({ status: 'ignored', reviewed_at: new Date().toISOString(), reviewed_by: actor, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting'); if (error) throw error; }
export async function labelReview(id: string, raw: unknown, actor: string) { const checked = validateReviewLabel(raw); if (!checked.ok) throw new Error(checked.error); const { data, error } = await supabaseAdmin.rpc('whatsapp_bot_label_review', { p_review_id: id, p_label: checked.value, p_reviewer: actor }); if (error) throw error; return data; }

// ── Bot review upgrade, Phase 2: the AI summary, approve, the developer list ──────────────────────────────────────
const needV2 = async () => { if (!(await reviewSchemaV2())) throw new Error('The review upgrade migration (20261014000001) has not been applied yet.'); };

/** Cases sent to a developer, newest first: still open, and fixed ones (which may now be tests). */
export async function listDeveloperItems(limit = 50) {
    if (!(await reviewSchemaV2())) return [];
    const { data, error } = await supabaseAdmin.from(REVIEW).select('*').eq('fix_owner', 'developer').in('status', ['developer', 'labelled']).order('updated_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw error; return data || [];
}

/** Write (or, with the admin's sentence, rewrite) the AI summary of one waiting item. One AI call. */
export async function summarizeReview(id: string, actor: string, adminNote?: string | null) {
    await needV2();
    const note = adminNote == null ? null : String(adminNote).trim().slice(0, 800);
    if (adminNote != null && !note) throw new Error('Write what the bot should have done.');
    const { data: row, error } = await supabaseAdmin.from(REVIEW).select('*').eq('id', id).eq('status', 'waiting').maybeSingle();
    if (error) throw error; if (!row) throw new Error('This message is no longer waiting for review.');
    const { summarizeReviewItem } = await import('./BotReviewSummary');
    let out: Awaited<ReturnType<typeof summarizeReviewItem>>;
    try { out = await summarizeReviewItem(row, note); }
    catch (e) { await TaskDatabaseService.logAudit({ eventType: 'bot_review_summary', details: { reviewId: id, actor, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'failed' } }).catch(() => undefined); throw e; }
    const { error: saveError } = await supabaseAdmin.from(REVIEW).update({ ai_summary: out.summary, fix_owner: out.summary.owner, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting');
    if (saveError) throw saveError;
    await TaskDatabaseService.logAudit({ eventType: 'bot_review_summary', details: { reviewId: id, actor, ok: true, model: out.summary.model, owner: out.summary.owner, rewritten: !!note, tokensIn: out.tokensIn, tokensOut: out.tokensOut, failedModels: out.failures.length } }).catch(() => undefined);
    return out.summary;
}

/**
 * ✅ Correct. "learn" → the AI's test (re-checked here, never taken from the browser) becomes a permanent test through the
 * existing label function. "developer" → moves to the developer list; it becomes a test when someone marks it Fixed.
 */
export async function approveReview(id: string, owner: unknown, actor: string) {
    await needV2();
    if (owner !== 'learn' && owner !== 'developer') throw new Error('Choose who can fix it.');
    const { data: row, error } = await supabaseAdmin.from(REVIEW).select('id,ai_summary').eq('id', id).eq('status', 'waiting').maybeSingle();
    if (error) throw error; if (!row) throw new Error('This message is no longer waiting for review.');
    if (!row.ai_summary) throw new Error('Wait for the AI summary first.');
    const editedBy = { ...row.ai_summary, owner };
    if (owner === 'learn') {
        const checked = validateReviewLabel(row.ai_summary.test);
        if (!checked.ok) throw new Error("There's no test for this one yet. Use Fix to describe the right answer, or send it to a developer.");
        await labelReview(id, checked.value, actor);
        await supabaseAdmin.from(REVIEW).update({ ai_summary: editedBy, fix_owner: 'learn' }).eq('id', id);
        return;
    }
    const { error: e2 } = await supabaseAdmin.from(REVIEW).update({ status: 'developer', fix_owner: 'developer', dev_state: 'new', ai_summary: editedBy, reviewed_at: new Date().toISOString(), reviewed_by: actor, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting');
    if (e2) throw e2;
}

/** Undo for "Ignore" and "Send to developer" (while still New). A saved test is permanent and is not undone here. */
export async function undoReview(id: string, actor: string) {
    await needV2();
    const { data: row, error } = await supabaseAdmin.from(REVIEW).select('status,dev_state').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row || !(row.status === 'ignored' || (row.status === 'developer' && row.dev_state === 'new'))) throw new Error('This can no longer be undone.');
    const { error: e2 } = await supabaseAdmin.from(REVIEW).update({ status: 'waiting', dev_state: null, reviewed_at: null, reviewed_by: null, expires_at: in30Days(), updated_at: new Date().toISOString() }).eq('id', id).eq('status', row.status);
    if (e2) throw e2;
    await TaskDatabaseService.logAudit({ eventType: 'bot_review_undo', details: { reviewId: id, actor, from: row.status } }).catch(() => undefined);
}

/** New → In progress → Fixed. Fixed turns the case into a permanent test when the AI could write one. */
export async function setDevState(id: string, state: unknown, actor: string): Promise<{ testSaved: boolean }> {
    await needV2();
    if (state !== 'new' && state !== 'in_progress' && state !== 'fixed') throw new Error('Unknown status.');
    const { data: row, error } = await supabaseAdmin.from(REVIEW).select('id,status,ai_summary').eq('id', id).eq('fix_owner', 'developer').in('status', ['developer', 'labelled']).maybeSingle();
    if (error) throw error; if (!row) throw new Error('Developer case not found.');
    let testSaved = false;
    if (state === 'fixed' && row.status === 'developer') {
        const checked = validateReviewLabel(row.ai_summary?.test);
        if (checked.ok) { await labelReview(id, checked.value, actor); testSaved = true; }
    }
    const { error: e2 } = await supabaseAdmin.from(REVIEW).update({ dev_state: state, updated_at: new Date().toISOString() }).eq('id', id);
    if (e2) throw e2;
    await TaskDatabaseService.logAudit({ eventType: 'bot_review_dev_state', details: { reviewId: id, actor, state, testSaved } }).catch(() => undefined);
    return { testSaved };
}

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
export async function purgeReviewItems(now = new Date()) { const { data, error } = await supabaseAdmin.from(REVIEW).delete().lt('expires_at', now.toISOString()).in('status', (await reviewSchemaV2()) ? ['provisional', 'recent', 'waiting', 'ignored'] : ['provisional', 'waiting', 'ignored']).select('id'); if (error) throw error; return (data || []).length; }
export const tables = { REVIEW, CASES, PROMPTS };
