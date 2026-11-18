/**
 * WhatsApp channel for the Unified Brain. Pure over injected dependencies.
 *
 * Runs in the AiSensy webhook BEFORE the task importer, the AI Action Layer and Smart chat. It takes a message only
 * when ALL of these hold; otherwise it returns { handled: false } and the existing bots answer exactly as before:
 *   1. the kill switch is off and at least one org has the brain on for WhatsApp;
 *   2. it is text, or a photo (other files, voice notes and videos stay with the flows that handle them today);
 *   3. the phone matches exactly ONE approved user (never a master admin) and exactly ONE org lets them in;
 *   4. the Task Manager's importer is not in the middle of something with this person, and a photo's caption is not
 *      about tasks (those belong to the importer);
 *   4b. when the brain does tasks itself for this person (owner 2026-11-15), the task assistant is not waiting for
 *      their answer (its own question, or a reminder ping from a superuser): that answer is the task assistant's;
 *   5. the brain actually has an answer: a reply, a question, a card, a result. A short "yes" / "2" with nothing of
 *      the brain's waiting, a task request, or a model outage all go on to the existing bots.
 * In SHADOW mode it never takes a message: it returns work to run after the webhook has answered, which thinks,
 * records what it would have said, and sends nothing.
 * Any error inside returns { handled: false }: this channel can never break the existing WhatsApp flows.
 */
import type { ActorContext } from '../../types';
import { brainGate, roleClass, type BrainSettings, type RoleClass } from '../config';
import { NO, YES } from '../../language';
import { brainHandled, runTurn, type TurnDeps, type TurnImage, type TurnOutput } from '../loop/turn';
import { mergeThreads, openThread, type ThreadState } from '../memory/thread';
import { skillsFor, tasksInBrain } from '../skills/registry';
import type { AttachmentRef } from '../types';
import type { Staged } from './media';

export interface BrainInbound {
    phone: string; text: string; mediaUrl?: string | null; mediaType?: string | null; messageId?: string | null;
    /**
     * A line put above the brain's reply. A voice note arrives here as the words that were heard, with
     * '🎙️ I heard: "…"' as the prefix, so the person sees what was understood and answers ONE question (the brain's
     * own card), not two (owner 2026-11-14).
     */
    replyPrefix?: string | null;
}

export interface BrainPerson { userId: string; orgId: string }

export interface BrainWhatsAppDeps {
    env: Record<string, string | undefined>;
    /** Cheap, cached: is the brain on for WhatsApp in ANY org? While false, nothing else is read. */
    anyOrgOn(): Promise<boolean>;
    findUser(phone: string): Promise<{ id: string; is_master_admin?: boolean | null } | null>;
    orgsForUser(userId: string): Promise<string[]>;
    /** Loaded from the database each time it is called: access is never cached across a confirmation. */
    loadActor(userId: string, orgId: string): Promise<ActorContext | null>;
    loadSettings(orgId: string): Promise<{ settings: BrainSettings; aliases: Record<string, string[]> }>;
    /** Optional cache of "who is this phone, in which org" (60 s live). Never caches the actor or the settings. */
    cachedPerson?: { get(phone: string): BrainPerson | null | undefined; set(phone: string, person: BrainPerson | null): void };
    /** The Task Manager's importer is waiting for, reading or previewing a list for this phone. */
    importBusy(phone: string): Promise<boolean>;
    captionMentionsTasks(text: string): boolean;
    /** The task assistant is waiting for this person's answer (its own question, or a superuser's reminder ping). Optional: absent = never waiting. */
    taskBotWaiting?(phone: string, userId: string): Promise<boolean>;
    loadThread(orgId: string, userId: string, shadow: boolean): Promise<unknown | null>;
    saveThread(orgId: string, userId: string, shadow: boolean, state: unknown): Promise<void>;
    listOpenFiles(orgId: string, userId: string): Promise<AttachmentRef[]>;
    stage(input: { orgId: string; userId: string; url: string; caption: string | null; messageId: string | null }): Promise<Staged>;
    turnDeps(ctx: { orgId: string; userId: string; phone: string; settings: BrainSettings }): TurnDeps;
    record(r: { orgId: string; userId: string; shadow: boolean; messageId: string | null; userText: string | null; hadFile: boolean; out: TurnOutput; roleClass: RoleClass }): Promise<void>;
    sendReply(phone: string, text: string): Promise<boolean>;
    /** Housekeeping after a reply (optional). */
    sweep?(orgId: string, settings: BrainSettings): Promise<void>;
    /** Duplicate-delivery guard for messages this server already took (optional). */
    seenBefore?(messageId: string): boolean;
    markSeen?(messageId: string): void;
    /** Shadow only: look at a photo WITHOUT storing it (the existing bot is the one handling that photo). */
    peekImage?(url: string): Promise<{ mime: string; base64: string } | null>;
    /**
     * 2026-11-18 batching (the same inbox Smart chat uses, task-manager/SmartChatInbox.ts): wait until the person stops
     * typing; the newest message's webhook answers all their waiting messages in ONE reply. Optional: absent, or
     * 'unavailable' (table missing, any error) = every message is answered on its own, exactly as before.
     */
    batch?(input: { phone: string; messageId: string; text: string }): Promise<BatchResult>;
    /** The batched turn is over (its thread is saved): the next batch of this person may start. Never throws. */
    finishBatch?(token: string): Promise<void>;
    /**
     * 2026-11-18: save only if nobody saved since `expectedRev` (null = there was no thread yet). 'conflict' = another
     * turn saved first; the caller merges and tries again, so no exchange is ever overwritten. Optional: absent = plain save.
     */
    saveThreadIf?(orgId: string, userId: string, shadow: boolean, state: unknown, expectedRev: number | null): Promise<'ok' | 'conflict'>;
}

export type BatchResult =
    | { kind: 'unavailable' }
    /** A newer message's webhook answers for this one too. */
    | { kind: 'deferred' }
    | { kind: 'batch'; texts: string[]; messageIds: string[]; token: string };

export type BrainClaim =
    | {
        handled: false; why: string; /** Skip the AI Action Layer too: the brain already read this and passed it on. */ skipAiLayer?: boolean; /** Work to run after the webhook has answered (shadow run, trace). Never throws. */ after?: () => Promise<void>;
        /**
         * 2026-11-18: the brain took several messages as one batch and then passed them on. These are all their words, one
         * per line: the bots below must answer THEM (not just this webhook's message), and must not batch again.
         */
        rewriteText?: string;
    }
    | { handled: true; background: () => Promise<void> };

const no = (why: string, extra: Partial<Extract<BrainClaim, { handled: false }>> = {}): BrainClaim => ({ handled: false, why, ...extra });

/** Exactly one approved user (never a master admin) and exactly one org whose brain settings let them in. */
async function resolvePerson(deps: BrainWhatsAppDeps, phone: string): Promise<{ person: BrainPerson; actor: ActorContext; settings: BrainSettings; aliases: Record<string, string[]>; mode: 'shadow' | 'live' } | { why: string }> {
    const cached = deps.cachedPerson?.get(phone);
    if (cached === null) return { why: 'not_enabled' };
    if (cached) {
        const [actor, loaded] = await Promise.all([deps.loadActor(cached.userId, cached.orgId), deps.loadSettings(cached.orgId)]);
        const gate = actor ? brainGate(actor, loaded.settings, 'whatsapp', deps.env) : null;
        if (actor && gate?.ok) return { person: cached, actor, settings: loaded.settings, aliases: loaded.aliases, mode: gate.mode };
        // Something changed since the cache was written: work it out again below.
    }
    const user = await deps.findUser(phone);
    if (!user || user.is_master_admin) { deps.cachedPerson?.set(phone, null); return { why: 'unknown_sender' }; }
    const found: Array<{ orgId: string; actor: ActorContext; settings: BrainSettings; aliases: Record<string, string[]>; mode: 'shadow' | 'live' }> = [];
    for (const orgId of await deps.orgsForUser(user.id)) {
        const actor = await deps.loadActor(user.id, orgId);
        if (!actor) continue;
        const loaded = await deps.loadSettings(orgId);
        const gate = brainGate(actor, loaded.settings, 'whatsapp', deps.env);
        if (gate.ok) found.push({ orgId, actor, settings: loaded.settings, aliases: loaded.aliases, mode: gate.mode });
    }
    // Two or more orgs: do not guess.
    if (found.length !== 1) { deps.cachedPerson?.set(phone, null); return { why: found.length ? 'several_orgs' : 'not_enabled' }; }
    const person = { userId: user.id, orgId: found[0].orgId };
    deps.cachedPerson?.set(phone, person);
    return { person, actor: found[0].actor, settings: found[0].settings, aliases: found[0].aliases, mode: found[0].mode };
}

export async function claimBrain(deps: BrainWhatsAppDeps, input: BrainInbound | null): Promise<BrainClaim> {
    try {
        if (deps.env.AI_BRAIN_DISABLED === 'true') return no('kill_switch');
        if (!input?.phone) return no('no_sender');
        const text = (input.text ?? '').trim();
        const media = input.mediaUrl ? String(input.mediaType ?? '').toLowerCase() : null;
        if (!text && !media) return no('empty');
        if (media && media !== 'image') return no('media_kind');
        if (media && text && deps.captionMentionsTasks(text)) return no('task_photo');
        if (!(await deps.anyOrgOn())) return no('off');

        const who = await resolvePerson(deps, input.phone);
        if ('why' in who) return no(who.why);
        const { person, actor, settings, aliases, mode } = who;
        if (await deps.importBusy(input.phone)) return no('import_busy');
        // Tasks in the brain: the task assistant's open question ("which task?", a superuser's ping) is answered by it,
        // never taken over half-way. Only checked when the brain does tasks for this person; otherwise as before.
        if (tasksInBrain(skillsFor(actor, settings)) && await deps.taskBotWaiting?.(input.phone, person.userId).catch(() => true)) return no('task_bot_waiting');
        // A repeat delivery of a message this server already took is answered once (the inbound ledger catches repeats
        // across servers when the never-silent switch is on; this covers the same server when it is off).
        if (mode === 'live' && input.messageId && deps.seenBefore?.(input.messageId)) return { handled: true, background: async () => undefined };

        const shadow = mode === 'shadow';
        const messageId = input.messageId ?? null;

        // ── Batching (2026-11-18): several messages sent back to back get ONE reply ──
        // Live, typed text only. A photo and a voice note are answered on their own, as before.
        let texts = [text];
        let batchToken: string | null = null;
        if (!shadow && !media && messageId && deps.batch && !input.replyPrefix) {
            const b: BatchResult = await deps.batch({ phone: input.phone, messageId, text }).catch(() => ({ kind: 'unavailable' as const }));
            if (b.kind === 'deferred') {
                // The newest message's webhook answers this one too. Nothing to do here, and no other bot may answer it.
                deps.markSeen?.(messageId);
                return { handled: true, background: async () => undefined };
            }
            if (b.kind === 'batch' && b.texts.length) { texts = b.texts.map(t => t.trim()).filter(Boolean); batchToken = b.token; }
            if (!texts.length) texts = [text];
        }
        const batched = texts.length > 1;
        const joined = texts.join('\n');
        const release = async () => { if (batchToken && deps.finishBatch) { const t = batchToken; batchToken = null; await deps.finishBatch(t).catch(() => undefined); } };
        const passOn = (why: string, extra: Partial<Extract<BrainClaim, { handled: false }>> = {}) => no(why, { ...extra, ...(batched ? { rewriteText: joined } : {}) });

        const run = async (): Promise<{ out: TurnOutput; hadFile: boolean }> => {
            let images: TurnImage[] = [];
            let hadFile = false;
            let transient: AttachmentRef[] = [];
            if (media && input.mediaUrl && shadow) {
                // Shadow stores nothing: the existing bot is handling this photo. The model is shown it under a handle
                // that exists only for this dry run, so nothing staged in shadow can appear once the org goes live.
                hadFile = true;
                const seen = await deps.peekImage?.(input.mediaUrl).catch(() => null);
                transient = [{ handle: 'A1', id: '00000000-0000-4000-8000-000000000000', kind: 'image', mime: 'image/jpeg', caption: text || null, receivedAt: new Date().toISOString() }];
                if (seen) images = [{ handle: 'A1', ...seen }];
            } else if (media && input.mediaUrl) {
                const staged = await deps.stage({ orgId: person.orgId, userId: person.userId, url: input.mediaUrl, caption: text || null, messageId });
                if (staged.ok) { hadFile = true; if (staged.image) images = [staged.image]; }
                // A photo that could not be taken in is not ours to answer: the existing flow gets it, as today.
                else throw new Error(`photo intake failed: ${staged.reason}`);
            }
            const [state, open] = await Promise.all([deps.loadThread(person.orgId, person.userId, shadow), shadow ? Promise.resolve([] as AttachmentRef[]) : deps.listOpenFiles(person.orgId, person.userId)]);
            baseState = state;
            const attachments = shadow ? transient : open;
            const tdeps = deps.turnDeps({ orgId: person.orgId, userId: person.userId, phone: input.phone, settings });
            const turn = (words: string, st: unknown, files: AttachmentRef[]) => runTurn(tdeps, { actor, settings, aliases, channel: 'whatsapp', text: words, images, attachments: files, state: st, dryRun: shadow });
            // A batch holding a bare Yes / No while a card waits: that line answers the card first, on its own, then the
            // rest is read as one turn. Otherwise a "yes" mixed into other words would never reach the card.
            const answerIdx = batched ? texts.findIndex(t => YES.test(t) || NO.test(t)) : -1;
            const cardWaiting = answerIdx >= 0 && openThread(state, tdeps.now()).pending?.kind === 'confirm';
            if (cardWaiting) {
                const first = await turn(texts[answerIdx], state, attachments);
                const rest = texts.filter((_, i) => i !== answerIdx).join('\n');
                const files = !shadow ? await deps.listOpenFiles(person.orgId, person.userId).catch(() => attachments) : attachments;
                const second = await turn(rest, first.state, files);
                return { out: combine(first, second), hadFile };
            }
            const out = await turn(joined, state, attachments);
            return { out, hadFile };
        };
        let baseState: unknown = null;
        const record = (out: TurnOutput, hadFile: boolean) => deps.record({ orgId: person.orgId, userId: person.userId, shadow, messageId, userText: text || null, hadFile, out, roleClass: roleClass(actor) }).catch(() => undefined);

        if (shadow) {
            // The existing bots answer this message. The brain only watches, afterwards, and never sends.
            return no('shadow', { after: async () => {
                try {
                    const { out, hadFile } = await run();
                    if (out.outcome === 'unsupported' && !out.reply) return; // "yes" / "2": nothing to learn from
                    await deps.saveThread(person.orgId, person.userId, true, out.state).catch(() => undefined);
                    await record(out, hadFile);
                } catch (err) { console.warn('[Brain] shadow run skipped:', err instanceof Error ? err.message : err); }
            } });
        }

        let ran: { out: TurnOutput; hadFile: boolean };
        try { ran = await run(); }
        catch (err) {
            // The existing bots answer instead; with a batch, they get ALL its words.
            console.error('[Brain] WhatsApp turn failed; the existing bots will answer', err instanceof Error ? err.message : err);
            await release();
            return passOn('error');
        }
        const { out, hadFile } = ran;
        // "Nothing is switched on for your role" is not worth a WhatsApp reply: the existing bots answer instead.
        if (out.outcome === 'unsupported' || !brainHandled(out) || !out.reply) {
            const tasks = out.handoffTo === 'tasks_assistant';
            const worth = out.outcome !== 'unsupported';
            await release();
            return passOn(out.trace.reason ?? out.outcome, { ...(tasks ? { skipAiLayer: true } : {}), ...(worth ? { after: () => record(out, hadFile) } : {}) });
        }
        const prefix = (input.replyPrefix ?? '').trim();
        const reply = prefix ? `${prefix}\n\n${out.reply.text}` : out.reply.text;
        if (input.messageId) deps.markSeen?.(input.messageId);
        return {
            handled: true,
            background: async () => {
                try {
                    // The thread is saved BEFORE the reply goes out, so a quick "yes" always finds what it answers. The turn has
                    // already run (an action may be done), so a failed save is logged and the reply still goes out.
                    await saveChecked(deps, person, baseState, out.state)
                        .catch(err => { console.error('[Brain] thread could not be saved', err instanceof Error ? err.message : err); });
                    // The next batch of this person may start only now: it must see the state this turn saved.
                    await release();
                    const sent = await deps.sendReply(input.phone, reply);
                    // Not sent: the message stays unanswered in the ledger under route 'brain', which the never-silent
                    // watchdog watches, so the person gets its apology instead of silence.
                    if (!sent) console.warn('[Brain] the reply could not be sent; the never-silent watchdog covers this message');
                    await record(out, hadFile);
                    await deps.sweep?.(person.orgId, settings).catch(() => undefined);
                } finally { await release(); }
            },
        };
    } catch (err) {
        console.error('[Brain] WhatsApp claim failed; the existing bots will answer', err instanceof Error ? err.message : err);
        return no('error');
    }
}

/** Two turns of one batch (a card's Yes or No, then the rest) as one reply and one record. */
function combine(first: TurnOutput, second: TurnOutput): TurnOutput {
    const texts = [first.reply?.text, brainHandled(second) ? second.reply?.text : null].filter((x): x is string => !!x && !!x.trim());
    const last = brainHandled(second) && second.reply ? second : first;
    return {
        ...last,
        reply: texts.length ? { ...(last.reply ?? {}), text: texts.join('\n\n') } : first.reply,
        outcome: brainHandled(second) ? second.outcome : first.outcome,
        handoffTo: brainHandled(second) ? second.handoffTo : first.handoffTo,
        state: brainHandled(second) ? second.state : first.state,
        trace: { ...last.trace, modelCalls: [...first.trace.modelCalls, ...second.trace.modelCalls], toolCalls: [...first.trace.toolCalls, ...second.trace.toolCalls], hops: [...first.trace.hops, ...second.trace.hops] },
    };
}

const revOf = (raw: unknown): number => {
    const r = raw && typeof raw === 'object' ? (raw as { rev?: unknown }).rev : undefined;
    return typeof r === 'number' && Number.isInteger(r) && r >= 0 ? r : 0;
};

/**
 * Saves a live thread without ever overwriting a turn that saved in between (2026-11-18). On a conflict the stored thread
 * is read again and this turn's exchange is merged into it (memory/thread.ts mergeThreads); at most 3 tries, then a
 * plain save of the merge. Without a checked save (older wiring, a store error), it is the plain save, as before.
 */
async function saveChecked(deps: BrainWhatsAppDeps, person: BrainPerson, base: unknown, ours: ThreadState): Promise<void> {
    if (!deps.saveThreadIf) return deps.saveThread(person.orgId, person.userId, false, ours);
    let latest: unknown = base;
    let next: ThreadState = ours;
    for (let attempt = 0; attempt < 3; attempt++) {
        const expected = latest === null || latest === undefined ? null : revOf(latest);
        let res: 'ok' | 'conflict';
        try { res = await deps.saveThreadIf(person.orgId, person.userId, false, { ...next, rev: (expected ?? 0) + 1 }, expected); }
        catch (err) {
            console.warn('[Brain] checked save failed, saving plainly:', err instanceof Error ? err.message : err);
            return deps.saveThread(person.orgId, person.userId, false, { ...next, rev: (expected ?? 0) + 1 });
        }
        if (res === 'ok') return;
        latest = await deps.loadThread(person.orgId, person.userId, false);
        next = mergeThreads(latest, base, ours, ours.lastActiveAt ?? new Date().toISOString());
    }
    console.warn('[Brain] thread kept changing; saving the merged state');
    await deps.saveThread(person.orgId, person.userId, false, { ...next, rev: revOf(latest) + 1 });
}
