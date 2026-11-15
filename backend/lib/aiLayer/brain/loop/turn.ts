/**
 * ONE BRAIN TURN. Pure orchestration over injected dependencies, so every path is tested without a database, a model
 * key or a WhatsApp number.
 *
 *   rate limit → HR filter → a Yes / No / number for something pending (code, no model)
 *   → skills this person may use → model with those skills as tools (bounded loop)
 *        read skill  → runs now, result goes back to the model as text
 *        write skill → validated by code; a confirmation card is shown; NOTHING runs
 *        ask_user / handoff / plain answer → the turn ends
 *   → the answer is checked against what code returned (nothing invented) → reply
 *   Yes on a later turn → access re-checked → the existing service runs it once → result from code
 *
 * ## Agent Spec — Unified Brain  (docs/AGENT_DOCTRINE.md §3; full reasoning in docs/WHATSAPP_UNIFIED_BRAIN_PLAN.md §12)
 *
 * **1. Workflow or agent?** Hybrid: a fixed workflow around one bounded agent step [BAA p.121]. Only the model step
 *    decides, and it may decide not to call a tool [BAA p.90]. Justification (a) [BAA p.115]: resolving "my complaint",
 *    "the room I had yesterday" needs a lookup before a decision, which the one-shot classifiers could not do.
 *    Head-to-head vs. the deterministic path [BAA pp.94–95, 99]: not yet run; the eval harness and shadow mode exist
 *    for it and promotion to live waits on that comparison.
 * **2. Context** [BAA p.112]: the person's role class and properties, open files, the pending question or proposal,
 *    remembered facts, handles issued in this thread, the last turns, and this turn's tool results. Never ids,
 *    phone numbers, file paths, other people's data outside scope, or which channel it is on.
 * **3. Cost of a false positive** [BAA p.112]: writes medium (every write needs the person's Yes on a card code
 *    built); answers with numbers high (so numbers must trace to tool results, checked in grounding.ts). Model tier
 *    is a setting (Control Center → AI models → "Unified brain"), chosen by measurement.
 * **4. Tools**: every skill in skills/registry.ts. Description states when NOT to use it [BAA p.107]; run/prepare
 *    never throw past this loop, errors go back as text [BAA p.94]; arguments are strict-schema and re-parsed with
 *    zod, handles only [BAA p.93]; MCP: not yet [BAA p.106], see item 10.
 * **5. Prompt** [BAA pp.105, 114]: ten numbered steps with a no-skip clause and one tone example (loop/prompt.ts).
 *    Terminal state in data: ai_action_log.decision and the proposal's op_id.
 * **6. Memory** [BAA pp.100–103]: the workload repeats (same people, buildings, rooms). Write tool memory_remember
 *    with a closed key list, unknown keys refused before writing [BAA p.101]; past actions read only through
 *    memory_recall [BAA p.103]. Organisation memory (stage 4): lessons the Tech team judged and one tested guidance
 *    note (learning/lessons.ts). The model has no tool to write either; a lesson is used only for the same kind of
 *    login and a skill the person already has [BAA p.101], and never as a source of facts.
 * **7. Multi-agent?** [BAA p.116]: one brain, skills as data; code owns the step order, one thread per person. Tasks
 *    are handed to the Task Manager's own assistant (a different context and a tuned prompt) [BAA p.112].
 * **8. Evaluation** [BAA pp.118–119], measured 2026-11-14 on the 56-case test set (eval/cases.ts, fake data, run by
 *    scripts/brain/eval.ts; saved in eval/lastRun.json and shown on the console's Scorecard):
 *    System: provider errors, latency and model hops are in every trace; median turn 2.0 to 2.4 s on the three tiers.
 *    Quality assurance (rubric: family GLM (5.3 Flash) against a Claude brain, tier mid, scale 0–3 with reasoning
 *      first, manual audit 10% = 16 of 156 grades, 14 agreed, checked by the coding assistant and NOT yet by a person)
 *      [BAA pp.96–98]: mean 2.88 Haiku 5.5, 2.81 Sonnet 5.5, 2.87 Opus 5.5; plus fixed checks in eval/grade.ts.
 *    Tool interaction (expected skill, tools and arguments per case; measured call count) [BAA p.95]: 56/56 on each
 *      tier, 0 unsafe; 0.82 to 0.86 tool calls per turn.
 *    Agent efficiency [BAA p.119]: US$0.0003 / 0.0042 / 0.0069 per turn (Haiku / Sonnet / Opus) with the cached
 *      prompt; the 4-call cap and effort "low" are the two sides of the token-vs-tool trade.
 *    Not measured: real conversations (the set is written, not sampled from traffic) and the live shadow comparison.
 * **9. Trace** [BAA pp.119–120]: every model call and tool call of a turn is returned in TurnTrace and stored by the
 *    channel; each skill is tested alone before scale [BAA p.116].
 * **10. Laws knowingly violated:** L9 (skills run in-process, not behind MCP: they share the app's code and permission
 *    checks; the registry is the single definition an MCP catalog can expose later). L13 (no agent framework: the
 *    project forbids new frameworks without approval; the loop is ~150 lines). L2 timing (the head-to-head runs in
 *    shadow after deploy, not before the build).
 */
import { createHash, randomUUID } from 'node:crypto';
import { buildAuditRow, type AuditInput, type AuditStore } from '../../audit';
import { istDate, istStart } from '../../dates';
import { isHrMatter } from '../../interpret';
import { NO, YES, detectLang, t } from '../../language';
import type { ActorContext, Lang } from '../../types';
import { effectiveBrainLimits, roleClass, scopeFingerprint, type BrainSettings } from '../config';
import { NO_LEARNING, cleanGuidance, echoesLesson, guidanceBlock, lessonsBlock, selectLessons, type Learned } from '../learning/lessons';
import { handleBook, openThread, HISTORY_TURNS, type PendingConfirm, type ThreadState } from '../memory/thread';
import { ASK_USER, HANDOFF, skillByTool, skillsFor, tasksInBrain, toolDefs, toolName, type AvailableSkill } from '../skills/registry';
import { bt } from '../text';
import type { AttachmentRef, Block, BrainChannel, BrainData, BrainModel, BrainReply, MemoryFact, Msg, Outcome, SkillContext, TurnTrace, WriteSkill } from '../types';
import { ungroundedParts } from './grounding';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_TASKS, buildContext } from './prompt';

export interface TurnDeps {
    data: BrainData;
    model: BrainModel;
    /** The models to try, in order: the main one first, then the backups (Control Center → AI models). */
    chain(): Promise<string[]>;
    audit: AuditStore;
    now(): Date;
    /** true = allowed. Per person per hour. */
    allowMessage(key: string, perHour: number): boolean;
    /**
     * What the organisation's Tech team has taught the brain (lessons) and told it (guidance). Optional, and a failure
     * here means "nothing learned this turn": learning must never stop a reply (doctrine L7, memory failure isolation).
     */
    learning?(): Promise<Learned>;
}

export interface TurnImage { handle: string; mime: string; base64: string }

export interface TurnInput {
    /** Loaded from the database for THIS turn. Never cached across a confirmation. */
    actor: ActorContext;
    settings: BrainSettings;
    /** Property nicknames (AI Access settings). */
    aliases?: Record<string, string[]>;
    channel: BrainChannel;
    text: string;
    /** Photos that arrived with this message, for the model to look at this once. */
    images?: TurnImage[];
    /** Every file of this person that is not attached to anything yet (including this turn's). */
    attachments?: AttachmentRef[];
    /** The stored thread, untrusted. */
    state: unknown;
    /** Shadow: think and record, never run a write, never write the audit log. */
    dryRun?: boolean;
}

export interface TurnOutput {
    /** null = the brain has nothing to say (the message belongs to another assistant). */
    reply: BrainReply | null;
    state: ThreadState;
    outcome: Outcome;
    handoffTo: 'tasks_assistant' | 'human' | null;
    lang: Lang;
    trace: TurnTrace;
}

const MAX_MODELS = 3;
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const clipArg = (v: unknown): unknown => (typeof v === 'string' ? v.slice(0, 200) : Array.isArray(v) ? v.slice(0, 10).map(clipArg) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clipArg(x)])) : v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

type LoopEnd =
    | { kind: 'text'; text: string }
    | { kind: 'ask'; question: string; options: string[] }
    | { kind: 'handoff'; to: 'tasks_assistant' | 'human' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { kind: 'propose'; skill: WriteSkill<any, any>; payload: unknown; card: string; auditFields: Record<string, unknown> | undefined };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutput> {
    const started = Date.now();
    const now = deps.now();
    const { actor, settings, channel } = input;
    const dryRun = input.dryRun === true;
    const aliases = input.aliases ?? {};
    const attachments = input.attachments ?? [];
    const images = settings.model.vision ? (input.images ?? []) : [];
    const raw = input.text.trim().slice(0, 1500);
    const state = openThread(input.state, now);
    const limits = effectiveBrainLimits(settings);
    const book = handleBook(state.handles);
    const trace: TurnTrace = { outcome: 'error', reason: null, skillId: null, modelCalls: [], toolCalls: [], hops: [], grounded: null, latencyMs: 0, costUsd: null, tokensIn: 0, tokensOut: 0, lessons: [], guidance: null };

    // Memory never blocks a turn: any failure reads as "nothing remembered".
    const memory: MemoryFact[] = settings.memory.enabled ? await deps.data.listMemory(actor.orgId, actor.userId).catch(() => []) : [];
    const shortReply = raw.length <= 12 && (YES.test(raw) || NO.test(raw) || /^\d+$/.test(raw));
    const preferred = memory.find(m => m.key === 'preferred_language')?.value;
    const detected = detectLang(raw);
    const lang: Lang = preferred === 'en' || preferred === 'hi' || preferred === 'hinglish' ? preferred
        : state.lang && (shortReply || !raw || (state.pending && detected === 'en')) ? state.lang : detected;

    const audit = (a: Omit<AuditInput, 'orgId' | 'userId' | 'channel' | 'lang'>) =>
        deps.audit.write(buildAuditRow({ ...a, orgId: actor.orgId, userId: actor.userId, channel, lang, latencyMs: Date.now() - started }));
    const safeAudit = (a: Parameters<typeof audit>[0]) => (dryRun ? Promise.resolve() : audit(a).catch(err => { console.error('[Brain] audit write failed', errText(err)); }));

    /** What is kept of the person's words. HR matters and empty photo-only turns are never stored as text. */
    let storedUserText = raw || (images.length || attachments.length ? '[sent a file]' : '');
    const finish = (outcome: Outcome, reply: BrainReply | null, next: { pending?: ThreadState['pending']; askStreak?: number; keepThread?: boolean; handoffTo?: TurnOutput['handoffTo']; reason?: string | null; skillId?: string | null } = {}): TurnOutput => {
        const at = now.toISOString();
        const history = next.keepThread ? state.history : [
            ...state.history,
            ...(storedUserText ? [{ role: 'user' as const, text: storedUserText.slice(0, 2000), at }] : []),
            ...(reply ? [{ role: 'assistant' as const, text: reply.text.slice(0, 2000), at }] : []),
        ].slice(-HISTORY_TURNS);
        trace.outcome = outcome;
        trace.reason = next.reason ?? trace.reason;
        trace.skillId = next.skillId ?? trace.skillId;
        trace.latencyMs = Date.now() - started;
        trace.tokensIn = trace.modelCalls.reduce((n, c) => n + c.tokensIn, 0);
        trace.tokensOut = trace.modelCalls.reduce((n, c) => n + c.tokensOut, 0);
        const priced = trace.modelCalls.filter(c => c.costUsd !== null);
        trace.costUsd = priced.length ? priced.reduce((n, c) => n + (c.costUsd as number), 0) : null;
        return {
            reply, outcome, lang, trace, handoffTo: next.handoffTo ?? null,
            state: next.keepThread ? { ...state, lastActiveAt: state.lastActiveAt } : {
                lang, handles: book.snapshot(), history, lastActiveAt: at,
                pending: next.pending === undefined ? null : next.pending,
                askStreak: next.askStreak ?? 0,
            },
        };
    };

    // ── 1. Limits ──
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    const recentTurns = dryRun ? 0 : await deps.audit.countTurnsSince(actor.orgId, actor.userId, hourAgo).catch(() => 0);
    if (!deps.allowMessage(`ai-brain:${actor.orgId}:${actor.userId}`, limits.perUserPerHour) || recentTurns >= limits.perUserPerHour) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'rate_limited' });
        return finish('refuse', { text: bt('rate_limited', lang) }, { pending: state.pending, askStreak: state.askStreak, reason: 'rate_limited' });
    }

    // ── 2. HR matters never reach the model, a ticket, the memory or the stored thread ──
    if (raw && isHrMatter(raw)) {
        storedUserText = '[an HR matter: not stored]';
        await safeAudit({ entryId: 'hr.redirect', decision: 'refused', refusalReason: 'hr_matter' });
        return finish('refuse', { text: t('hr_redirect', lang) }, { reason: 'hr_matter' });
    }

    const available = skillsFor(actor, settings);
    const scope = sha(scopeFingerprint(actor, available.map(a => a.skill.id)));
    const userWords = [...state.history.filter(h => h.role === 'user').slice(-5).map(h => h.text), raw].join('\n');
    const ctx: SkillContext = { actor, lang, now, channel, data: deps.data, aliases, userWords, attachments, handle: book.issue, resolve: book.resolve, memory };

    // ── 3. Fast path: an answer to something pending needs no model ──
    if (state.pending?.kind === 'confirm' && raw) {
        if (YES.test(raw)) return confirm(state.pending);
        if (NO.test(raw)) {
            await safeAudit({ entryId: state.pending.skillId, decision: 'cancelled', opId: state.pending.opId });
            return finish('cancelled', { text: bt('cancelled', lang) }, { skillId: state.pending.skillId });
        }
    }
    if (!state.pending && !images.length && (!raw || shortReply)) {
        // "yes", "2", "ok" with nothing of ours waiting: it answers another assistant's question, or nothing at all.
        if (raw || !attachments.length) return finish('unsupported', null, { keepThread: true, reason: 'not_ours' });
    }
    let text = raw;
    if (state.pending?.kind === 'ask' && /^\d{1,2}$/.test(raw)) {
        const pick = state.pending.options[Number(raw) - 1];
        if (pick) text = pick;
    }

    if (!available.length) {
        await safeAudit({ entryId: null, decision: 'refused', refusalReason: 'nothing_enabled' });
        return finish('unsupported', { text: bt('nothing_enabled', lang) }, { reason: 'nothing_enabled' });
    }

    // ── 4. The model step ──
    const tools = toolDefs(available);
    // Tasks in the brain (owner 2026-11-15): only when one of the person's task actions is on; otherwise the same prompt as before.
    const system = tasksInBrain(available) ? SYSTEM_PROMPT_TASKS : SYSTEM_PROMPT;
    const visible = images.filter(i => attachments.some(a => a.handle === i.handle));
    const context = buildContext({ actor, lang, now, aliases, attachments, pending: state.pending, memory, handles: book.all(), visibleImages: visible.map(i => i.handle) });
    // What the Tech team taught (lessons) and wrote (guidance). It sits AFTER the frozen prompt and the context, so the
    // cached prefix is untouched, and it is kept apart from `context`: a lesson is another person's message and must
    // never count as a source of facts for the grounding check.
    let learned: Learned = NO_LEARNING;
    if (deps.learning) { try { learned = await deps.learning(); } catch (err) { console.warn('[Brain] learning skipped this turn:', errText(err)); } }
    const lessons = settings.learning.lessons
        ? selectLessons(text, learned.lessons, { role: roleClass(actor), skillIds: available.map(a => a.skill.id), max: settings.learning.maxLessons })
        : [];
    const guidance = learned.guidance && cleanGuidance(learned.guidance.text) ? learned.guidance : null;
    trace.lessons = lessons.map(l => l.id);
    trace.guidance = guidance?.version ?? null;
    const taught = [guidance ? guidanceBlock(guidance.text) : '', lessonsBlock(lessons)].filter(Boolean).join('\n');
    const userBlocks: Block[] = [
        ...visible.map(i => ({ type: 'image' as const, mime: i.mime, base64: i.base64 })),
        { type: 'text', text: `${context}\n${taught ? `${taught}\n` : ''}<message>\n${text || '(the person sent a file with no words)'}\n</message>` },
    ];
    const history: Msg[] = [];
    for (const h of state.history) {
        if (!history.length && h.role === 'assistant') continue; // the first message must be the person's
        history.push({ role: h.role, blocks: [{ type: 'text', text: h.text }] });
    }

    let sources: string[] = [];
    let displays: string[] = [];
    let lastRead: string | null = null;

    const runLoop = async (model: string): Promise<LoopEnd> => {
        sources = []; displays = []; lastRead = null;
        const messages: Msg[] = [...history, { role: 'user', blocks: userBlocks }];
        let reads = 0; let problems = 0;
        for (let round = 0; round < limits.maxToolCalls + 4; round++) {
            const t0 = Date.now();
            const reply = await deps.model.call({ model, system, tools, messages, maxTokens: settings.model.maxTokens, effort: settings.model.effort });
            trace.modelCalls.push({ seq: trace.modelCalls.length + 1, model: reply.model, keySlot: reply.keySlot ?? null, tokensIn: reply.usage.tokensIn, tokensOut: reply.usage.tokensOut, cacheRead: reply.usage.cacheRead, cacheWrite: reply.usage.cacheWrite, costUsd: reply.usage.costUsd, ms: Date.now() - t0, stopReason: reply.stopReason });
            if (reply.stopReason === 'refusal') throw new Error('the model declined to answer');
            const uses = reply.blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
            const said = reply.blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
            if (!uses.length) {
                if (reply.stopReason === 'max_tokens' && !said) throw new Error('the model ran out of room before answering');
                return { kind: 'text', text: said };
            }
            messages.push({ role: 'assistant', blocks: reply.blocks, raw: reply.raw });

            const results: Block[] = [];
            const note = (use: { id: string }, textOut: string, isError = false) => { results.push({ type: 'tool_result', toolUseId: use.id, text: textOut, ...(isError ? { isError: true } : {}) }); };
            const record = (skillId: string, kind: 'read' | 'write' | 'control', args: unknown, ok: boolean, chars: number, ms: number, error?: string) => {
                trace.toolCalls.push({ seq: trace.toolCalls.length + 1, skillId, kind, args: clipArg(args), ok, resultChars: chars, ms, error: error ?? null });
            };

            // Reads the model asked for together run side by side; their results keep the order they were asked in.
            const readJobs = new Map<string, Promise<void>>();
            for (const use of uses) {
                const entry = available.find(a => toolName(a.skill.id) === use.name);
                if (!entry || entry.skill.kind !== 'read') continue;
                const skill = entry.skill;
                const parsed = skill.args.safeParse(use.input ?? {});
                if (!parsed.success) { record(skill.id, 'read', use.input, false, 0, 0, 'bad arguments'); note(use, `Those arguments are not valid for ${use.name}: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`, true); continue; }
                if (reads >= limits.maxToolCalls) { record(skill.id, 'read', parsed.data, false, 0, 0, 'tool budget used up'); note(use, 'You have used all your lookups for this turn. Answer now with what you have, or call ask_user.', true); continue; }
                reads++;
                const t1 = Date.now();
                readJobs.set(use.id, (async () => {
                    try {
                        const out = await skill.run(ctx, parsed.data);
                        // The same finished answer from two look-ups is shown once (test set 2026-11-14: "no tickets" appeared twice).
                        sources.push(out.text); if (out.display) { sources.push(out.display); if (!displays.includes(out.display)) displays.push(out.display); }
                        lastRead = skill.id;
                        record(skill.id, 'read', parsed.data, true, out.text.length, Date.now() - t1);
                        note(use, out.text);
                    } catch (err) {
                        // Doctrine L3: a tool failure goes back to the model as text; it never breaks the turn.
                        console.error('[Brain] read skill failed', skill.id, errText(err));
                        record(skill.id, 'read', parsed.data, false, 0, Date.now() - t1, errText(err));
                        note(use, 'That lookup failed just now (a system problem, not the person\'s fault). Tell them you could not check it and to try again shortly.', true);
                    }
                })());
            }
            await Promise.all(readJobs.values());

            for (const use of uses) {
                if (readJobs.has(use.id) || results.some(r => r.type === 'tool_result' && r.toolUseId === use.id)) continue;
                if (use.name === ASK_USER) {
                    const a = use.input as { question?: unknown; options?: unknown } | null;
                    const question = typeof a?.question === 'string' ? a.question.trim().slice(0, 500) : '';
                    const options = Array.isArray(a?.options) ? a.options.filter((o): o is string => typeof o === 'string' && !!o.trim()).map(o => o.trim().slice(0, 160)).slice(0, 8) : [];
                    record(ASK_USER, 'control', { options: options.length }, !!question, 0, 0);
                    if (question) return { kind: 'ask', question, options };
                    note(use, 'ask_user needs a question.', true); continue;
                }
                if (use.name === HANDOFF) {
                    const to = (use.input as { to?: unknown } | null)?.to === 'tasks_assistant' ? 'tasks_assistant' as const : 'human' as const;
                    record(HANDOFF, 'control', { to }, true, 0, 0);
                    return { kind: 'handoff', to };
                }
                const entry = available.find(a => toolName(a.skill.id) === use.name);
                if (!entry) {
                    // A tool that exists but is not this person's is answered exactly like one that does not exist.
                    record(skillByTool(use.name)?.id ?? use.name.slice(0, 60), 'control', null, false, 0, 0, 'not available');
                    note(use, `${use.name} is not available. Use only the tools you were given, or tell the person this is done in the app.`, true); continue;
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const skill = entry.skill as WriteSkill<any, any>;
                const parsed = skill.args.safeParse(use.input ?? {});
                if (!parsed.success) { record(skill.id, 'write', use.input, false, 0, 0, 'bad arguments'); note(use, `Those arguments are not valid for ${use.name}: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`, true); continue; }
                const t1 = Date.now();
                try {
                    const prepared = await skill.prepare(ctx, parsed.data);
                    if (prepared.ok) {
                        record(skill.id, 'write', parsed.data, true, prepared.card.length, Date.now() - t1);
                        return { kind: 'propose', skill, payload: prepared.payload, card: prepared.card, auditFields: prepared.auditFields };
                    }
                    problems++;
                    sources.push(prepared.problem);
                    record(skill.id, 'write', parsed.data, false, prepared.problem.length, Date.now() - t1, 'needs more');
                    note(use, prepared.problem, true);
                } catch (err) {
                    problems++;
                    console.error('[Brain] write skill could not be prepared', skill.id, errText(err));
                    record(skill.id, 'write', parsed.data, false, 0, Date.now() - t1, errText(err));
                    note(use, 'That could not be checked just now (a system problem). Tell the person to try again shortly.', true);
                }
            }
            // Results go back in the order the calls were made, all in one message.
            results.sort((x, y) => uses.findIndex(u => x.type === 'tool_result' && u.id === x.toolUseId) - uses.findIndex(u => y.type === 'tool_result' && u.id === y.toolUseId));
            messages.push({ role: 'user', blocks: results });
            if (problems > 3) break;
        }
        return { kind: 'text', text: '' }; // the loop cap was reached: answer from what code already has
    };

    let end: LoopEnd | null = null;
    let models: string[] = [];
    try { models = (await deps.chain()).slice(0, MAX_MODELS); } catch (err) { trace.hops.push({ model: 'chain', error: errText(err) }); }
    for (const model of models) {
        try { end = await runLoop(model); break; }
        catch (err) {
            trace.hops.push({ model, error: errText(err) });
            console.warn(`[Brain] ${model} failed, trying the next model: ${errText(err)}`);
        }
    }
    if (!end) {
        await safeAudit({ entryId: null, decision: 'error', refusalReason: 'ai_unavailable' });
        // Nothing is lost: an open question or proposal stays exactly as it was.
        return finish('error', { text: bt('down', lang) }, { keepThread: true, reason: 'ai_unavailable' });
    }
    const usage = { model: trace.modelCalls.at(-1)?.model ?? null, tokensIn: trace.modelCalls.reduce((n, c) => n + c.tokensIn, 0), tokensOut: trace.modelCalls.reduce((n, c) => n + c.tokensOut, 0) };
    // Guidance is written and tested by the Tech team, so a fact in it (a helpdesk name, a number) may be said. Lessons are not here.
    const allSources = [context, guidance ? cleanGuidance(guidance.text) : '', userWords, text, ...sources, ...state.history.map(h => h.text)].join('\n');
    /** The reply repeats another person's judged message: treated like an invented fact. */
    const echoes = (reply: string) => echoesLesson(reply, lessons, allSources);

    if (end.kind === 'handoff') {
        await safeAudit({ entryId: null, decision: 'handed_off', refusalReason: end.to === 'tasks_assistant' ? 'to_task_manager' : 'to_human', ...usage });
        return end.to === 'tasks_assistant'
            ? finish('handoff', { text: bt('tasks_elsewhere', lang) }, { handoffTo: 'tasks_assistant', reason: 'tasks' })
            : finish('handoff', { text: bt('handoff_asked', lang) }, { handoffTo: 'human', reason: 'human' });
    }

    if (end.kind === 'propose') {
        const pending: PendingConfirm = { kind: 'confirm', opId: randomUUID(), skillId: end.skill.id, payload: end.payload, card: end.card, scope, at: now.toISOString() };
        await safeAudit({ entryId: end.skill.id, decision: 'confirm_shown', opId: pending.opId, fields: end.auditFields ?? null, ...usage });
        const yes = lang === 'hi' ? ['हाँ', 'रद्द करें'] : ['Yes', 'Cancel'];
        return finish('propose', { text: end.card, options: yes, awaitingConfirm: true }, { pending, skillId: end.skill.id });
    }

    if (end.kind === 'ask') {
        const askStreak = state.askStreak + 1;
        if (askStreak > limits.maxQuestionsInRow) {
            await safeAudit({ entryId: lastRead, decision: 'handed_off', refusalReason: 'too_many_questions', ...usage });
            return finish('handoff', { text: bt('handoff_human', lang) }, { handoffTo: 'human', reason: 'too_many_questions' });
        }
        let options = end.options;
        let missing = ungroundedParts([end.question, ...options].join('\n'), allSources, istDate(now));
        if (echoes([end.question, ...options].join('\n'))) missing.push('(a lesson)');
        // Choices the model made up ("10:00 to 11:00?" when no room was looked up) are dropped, not the whole question:
        // a sound question with invented choices is asked without them (found by the test set 2026-11-14).
        const dropped = missing.length > 0 && options.length > 0 && ungroundedParts(end.question, allSources, istDate(now)).length === 0 && !echoes(end.question);
        if (dropped) { options = []; missing = []; }
        // Still recorded as not grounded: the model did make something up, and the console flags the turn for a look.
        trace.grounded = !dropped && missing.length === 0;
        if (missing.length) {
            await safeAudit({ entryId: lastRead, decision: 'error', refusalReason: 'ungrounded_question', ...usage });
            return finish('answer', { text: displays.length ? displays.join('\n\n') : bt('ungrounded', lang) }, { reason: 'ungrounded_question' });
        }
        const body = options.length ? `${end.question}\n${options.map((o, i) => `${i + 1}) ${o}`).join('\n')}\n${bt('pick', lang)}` : end.question;
        await safeAudit({ entryId: lastRead, decision: 'asked', fields: { options: options.length }, ...usage });
        return finish('ask', { text: body, ...(options.length ? { options } : {}) }, { pending: { kind: 'ask', question: end.question, options, at: now.toISOString() }, askStreak, skillId: lastRead, reason: dropped ? 'choices_dropped' : null });
    }

    // A plain answer: the model's wording is used only if every number and reference in it traces to a source.
    const missing = end.text ? ungroundedParts(end.text, allSources, istDate(now)) : ['(empty)'];
    if (end.text && echoes(end.text)) missing.push('(a lesson)');
    trace.grounded = missing.length === 0;
    const answer = missing.length === 0 ? end.text : displays.length ? displays.join('\n\n') : bt(end.text ? 'ungrounded' : 'down', lang);
    await safeAudit({ entryId: lastRead, decision: lastRead || missing.length === 0 ? 'answered' : 'error', refusalReason: missing.length ? 'ungrounded_answer' : null, ...usage });
    return finish('answer', { text: answer }, { skillId: lastRead, reason: missing.length ? 'ungrounded_answer' : null });

    // ── A confirmed proposal (closure over deps, actor, lang) ──

    async function confirm(p: PendingConfirm): Promise<TurnOutput> {
        const entry: AvailableSkill | undefined = available.find(a => a.skill.id === p.skillId);
        // Guardrail G3: everything is checked again NOW, against the person's access as it is at this moment.
        if (!entry || entry.skill.kind !== 'write' || p.scope !== scope) {
            await safeAudit({ entryId: p.skillId, decision: 'refused', opId: p.opId, refusalReason: 'access_changed' });
            return finish('not_executed', { text: bt('access_changed', lang) }, { skillId: p.skillId, reason: 'access_changed' });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skill = entry.skill as WriteSkill<any, any>;
        const payload = skill.payload.safeParse(p.payload);
        if (!payload.success) {
            await safeAudit({ entryId: p.skillId, decision: 'error', opId: p.opId, refusalReason: 'bad_proposal' });
            return finish('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'bad_proposal' });
        }
        if (dryRun || entry.mode === 'shadow') {
            await safeAudit({ entryId: p.skillId, decision: 'shadow', opId: p.opId });
            return finish('not_executed', { text: bt('shadow_write', lang) }, { skillId: p.skillId, reason: 'test_mode' });
        }
        // Idempotency: the same proposal confirmed twice (double tap, a retried delivery) runs once. The unique index
        // on ai_action_log (op_id) WHERE decision = 'accepted' makes this race-safe in the database too.
        const status = await deps.audit.opStatus(actor.orgId, actor.userId, p.opId).catch(() => 'accepted' as const);
        if (status === 'accepted') return finish('not_executed', { text: bt('already_done', lang) }, { skillId: p.skillId, reason: 'already_done' });
        if (status === 'failed') return finish('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'failed_before' });
        // The audit row is written FIRST. If it cannot be written, nothing runs (no unlogged writes).
        try { await audit({ entryId: p.skillId, decision: 'accepted', opId: p.opId }); }
        catch { return finish('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'audit_failed' }); }
        // The daily cap is counted AFTER our own row exists, so parallel confirmations cannot all slip under it.
        const since = istStart(istDate(now)).toISOString();
        const actions = await deps.audit.countActionsSince(actor.orgId, actor.userId, since).catch(() => Infinity);
        if (actions > limits.actionsPerUserPerDay) {
            await safeAudit({ entryId: p.skillId, decision: 'refused', opId: p.opId, refusalReason: 'daily_limit' });
            return finish('not_executed', { text: bt('daily_limit', lang) }, { skillId: p.skillId, reason: 'daily_limit' });
        }
        try {
            const out = await skill.execute(ctx, payload.data, p.opId);
            await safeAudit({ entryId: p.skillId, decision: out.ok ? 'acted' : 'error', opId: p.opId, resultRef: out.resultRef ?? null, refusalReason: out.ok ? null : 'not_done' });
            if (out.ok) {
                // Memory and bookkeeping never fail an action that already happened.
                for (const id of out.usedAttachments ?? []) await deps.data.markAttachmentUsed(id, `${p.skillId}:${out.resultRef ?? p.opId}`).catch(() => undefined);
                if (out.episode && settings.memory.enabled) await deps.data.addEpisode({ orgId: actor.orgId, userId: actor.userId, summary: out.episode, skillId: p.skillId }).catch(() => undefined);
            }
            return finish(out.ok ? 'executed' : 'not_executed', { text: out.reply }, { skillId: p.skillId, reason: out.ok ? null : 'not_done' });
        } catch (err) {
            console.error('[Brain] write skill failed', p.skillId, errText(err));
            await safeAudit({ entryId: p.skillId, decision: 'error', opId: p.opId, refusalReason: 'write_failed' });
            return finish('not_executed', { text: bt('failed', lang) }, { skillId: p.skillId, reason: 'write_failed' });
        }
    }
}

/** For channels: does this outcome mean the brain took the message? (false → another assistant should answer it). */
export function brainHandled(out: Pick<TurnOutput, 'outcome' | 'handoffTo' | 'reply'>): boolean {
    if (out.outcome === 'unsupported' && !out.reply) return false;
    if (out.outcome === 'handoff' && out.handoffTo === 'tasks_assistant') return false;
    if (out.outcome === 'error') return false;
    return true;
}

export type { ActorContext, BrainChannel };
