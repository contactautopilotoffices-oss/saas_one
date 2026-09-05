/**
 * ONE PROMPT → THE WHOLE AGENT.
 * -----------------------------------------------------------------------------
 * Until now a description produced an identity, a prompt and a table bundle, and
 * left the operator to work out the rest by hand: when it runs, whether it may
 * act, what it costs, who it mails, how far each scan looks back. Those are all
 * IN the sentence people write —
 *
 *   "Every morning at 11, Mon to Sat, mail the team what's wrong with the POs"
 *
 * carries a schedule, a cadence, a channel and an audience. Making the operator
 * re-enter them is asking them to translate their own sentence into config.
 *
 * This derives the whole envelope and hands back a REVIEWABLE PROPOSAL. Nothing
 * is written. The operator sees each field with the phrase it came from, and
 * changes what is wrong — which is the job they actually wanted.
 *
 * ── WHAT IS AND IS NOT INFERRED ─────────────────────────────────────────────
 * Schedule, timezone, cadence and quiet hours come from the text. Autonomy does
 * NOT: it defaults to `suggest` no matter how confidently the sentence is
 * phrased, because "act on its own" is a decision a person makes with their eyes
 * open, not something a model reads out of a request. Recipients are matched
 * against REAL users; an address that resolves to nobody is reported, never
 * invented.
 */

import { z } from 'zod';
import { councilChat, isMockLlm } from '@/backend/lib/council/llm';
import { extractJsonObject } from '@/backend/lib/agents/compose';
import type { AgentRuntimeConfig } from '@/frontend/types/agentRuntime';

const Derived = z.object({
    schedule_cron: z.string().trim().max(60).nullable().optional(),
    timezone: z.string().trim().max(48).nullable().optional(),
    cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).nullable().optional(),
    quiet_hours: z.object({ from: z.string().max(8), to: z.string().max(8) }).nullable().optional(),
    channel: z.enum(['email', 'whatsapp', 'push', 'none']).nullable().optional(),
    audience: z.array(z.string().trim().max(80)).max(12).optional(),
    max_runs_per_day: z.number().int().min(0).max(500).nullable().optional(),
    /** field -> the phrase it was read from. This is what makes it reviewable. */
    evidence: z.record(z.string(), z.string().max(200)).optional(),
    unresolved: z.array(z.string().max(200)).max(8).optional(),
});

export interface ConfiguredAgent {
    runtime: AgentRuntimeConfig;
    cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    channel: 'email' | 'whatsapp' | 'push' | 'none';
    /** Names or descriptions of people the sentence pointed at, unresolved. */
    audience: string[];
    /** Each derived field with the words it came from. Rendered beside the field. */
    evidence: Record<string, string>;
    /** What the sentence did not say and this refused to guess. */
    unresolved: string[];
    source: 'model' | 'rules';
}

const SYSTEM = `Read an operator's description of a scheduled agent and extract its RUNTIME ENVELOPE.

Return ONLY JSON:
{"schedule_cron","timezone","cadence","quiet_hours":{"from","to"},"channel","audience":[],
 "max_runs_per_day","evidence":{"field":"the exact phrase this came from"},"unresolved":[]}

RULES
- schedule_cron: standard 5-field cron. "every morning at 11, Mon to Sat" is "0 11 * * 1-6".
  Sunday off means 1-6, not *. If no time is stated, return null — do not invent one.
- timezone: "Asia/Kolkata" unless another is named.
- cadence: how much history one run covers. A morning digest of what changed is "daily".
- channel: how it reaches people. "HTML mail" is email.
- audience: who it goes to, in the operator's own words ("the team", "procurement",
  "the person handling that PO"). Do NOT invent email addresses.
- max_runs_per_day: only if a limit is implied. Usually null.
- evidence: for EVERY field you filled, the phrase you read it from. If you cannot
  quote the phrase, do not fill the field.
- unresolved: things the description clearly needs but does not say.

Never guess. A null with an entry in unresolved is better than a plausible value.`;

/** Rules fallback — enough to be useful when no model is available. */
function ruleDerive(description: string): ConfiguredAgent {
    const d = description.toLowerCase();
    const time = d.match(/\b(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?\b/);
    let hour: number | null = null;
    if (time) {
        hour = Number(time[1]);
        if (time[3] === 'pm' && hour < 12) hour += 12;
        if (time[3] === 'am' && hour === 12) hour = 0;
        if (hour > 23) hour = null;
    }
    const monSat = /mon\w*\s*(?:to|–|-|through)\s*sat/i.test(description) || /sunday\s*(?:is\s*)?off/i.test(description);
    const weekly = /\bweekly\b|every week/i.test(description);
    const monthly = /\bmonthly\b|every month/i.test(description);

    return {
        runtime: {
            schedule_cron: hour !== null ? `0 ${hour} * * ${monSat ? '1-6' : '*'}` : undefined,
            timezone: 'Asia/Kolkata',
            autonomy: 'suggest',
        },
        cadence: monthly ? 'monthly' : weekly ? 'weekly' : 'daily',
        channel: /whatsapp/i.test(description) ? 'whatsapp' : 'email',
        audience: [],
        evidence: hour !== null ? { schedule_cron: time?.[0]?.trim() ?? '' } : {},
        unresolved: hour === null ? ['No time of day was stated, so no schedule was set.'] : [],
        source: 'rules',
    };
}

export async function configureFromPrompt(description: string): Promise<ConfiguredAgent> {
    if (isMockLlm() || !description.trim()) return ruleDerive(description);

    try {
        const raw = await councilChat(
            [{ role: 'system', content: SYSTEM }, { role: 'user', content: description }],
            'opinion' as never,
        );
        const p = Derived.parse(extractJsonObject(raw));

        // Cron is validated, never trusted: a malformed one would silently never fire.
        const cron = p.schedule_cron?.trim();
        const cronOk = cron ? /^(\S+\s+){4}\S+$/.test(cron) : false;

        return {
            runtime: {
                schedule_cron: cronOk ? cron : undefined,
                timezone: p.timezone ?? 'Asia/Kolkata',
                quiet_hours: p.quiet_hours ?? undefined,
                max_runs_per_day: p.max_runs_per_day ?? undefined,
                // NEVER inferred. Acting without a human is a decision a person
                // makes deliberately, not something read out of a sentence.
                autonomy: 'suggest',
            },
            cadence: p.cadence ?? 'daily',
            channel: p.channel ?? 'email',
            audience: p.audience ?? [],
            evidence: p.evidence ?? {},
            unresolved: [
                ...(p.unresolved ?? []),
                ...(cron && !cronOk ? [`The model proposed "${cron}", which is not a valid cron. No schedule was set.`] : []),
                'Autonomy is always set to "suggest" on a new agent, whatever the description says. Promote it deliberately.',
            ],
            source: 'model',
        };
    } catch {
        return ruleDerive(description);
    }
}
