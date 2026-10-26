/**
 * Meera's caller script, from the Meera console: read it, preview it, get a
 * revision from feedback, publish it to Bolna, and keep every version.
 *
 * Two guarantees:
 *   · A script may only use the {variables} Meera's call CSV supplies
 *     (CALL_VARIABLES) plus Bolna's own. Anything else would be spoken as a
 *     blank — refused before publishing, not discovered on a vendor's phone.
 *   · The script that was live is saved BEFORE the new one goes out, so any
 *     publish can be read back and undone.
 *
 * Publishing changes what every vendor hears, so it is limited to org super
 * admins and master admins (backend/lib/satej/access.ts); suggesting is open
 * to the procurement team.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import { councilChat } from '@/backend/lib/council/llm';
import { satejConfig } from './config';
import { publishVoiceScript, getVoiceScript } from './clients/bolna';
import { CALL_VARIABLES, promptVariables } from './prompts/voiceAgent';
import { buildCallCsv } from './pipeline';
import type { Requirement, Vendor } from './types';
import { parseJsonLoose } from './util';

const VERSIONS = 'satej_voice_versions';
/** Bolna fills these itself. */
const SYSTEM_VARIABLES = ['agent_id', 'execution_id', 'call_sid', 'from_number', 'to_number', 'current_date', 'current_time', 'timezone'];

export function unknownVariables(text: string): string[] {
    return promptVariables(text).filter((v) => !(CALL_VARIABLES as readonly string[]).includes(v) && !SYSTEM_VARIABLES.includes(v));
}

export function validateScript(welcome: string, prompt: string): string[] {
    const errs: string[] = [];
    if (welcome.trim().length < 5) errs.push('The greeting is empty');
    if (welcome.length > 600) errs.push('The greeting is longer than 600 characters — vendors hang up on long openings');
    if (prompt.trim().length < 200) errs.push('The prompt is too short to run a call');
    if (prompt.length > 20000) errs.push('The prompt is longer than 20,000 characters, which slows every reply');
    const bad = unknownVariables(`${welcome}\n${prompt}`);
    if (bad.length) errs.push(`Uses variables Meera does not send, which would be spoken as blanks: ${bad.join(', ')}. Allowed: ${CALL_VARIABLES.slice(1).join(', ')}`);
    return errs;
}

/** The greeting exactly as one vendor would hear it, filled from a real requirement's call row. */
export function previewGreeting(welcome: string, r: Requirement, vendors: Vendor[]): { vendor: string; text: string; row: Record<string, string> } | null {
    if (!r.brief) return null;
    const v = vendors.find((x) => x.status !== 'excluded') ?? {
        id: 'sample', organizationId: r.organizationId, requirementId: r.id, name: 'Sample Vendor', phone: '+919999999999', phoneRaw: '', address: '', area: '', city: '',
        website: '', sells: '', webYearsInBusiness: null, relevance: 0, sourceUrls: [], status: 'found' as const, createdAt: '',
    };
    const [header, line] = buildCallCsv(r, [v]).trim().split('\n');
    const cols = header.split(',');
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    const text = welcome.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (_, k) => row[k] ?? '');
    return { vendor: v.name, text, row };
}

const REVISE_SYSTEM = `
You revise the script of Meera, a Hinglish voice agent who phones local vendors for Autopilot Offices' procurement team. You receive her current greeting and system prompt, the team's feedback, and possibly call transcripts.

Rules, in order. Do not skip any.
1. Change only what the feedback asks for, plus what is needed to make it work. Keep everything else word for word.
2. Keep every {variable} exactly as written. Use no variable outside this list: ${CALL_VARIABLES.slice(1).join(', ')}.
3. Keep the honesty rule: she never brings up being an AI, and answers honestly if asked directly.
4. Keep her a woman speaking everyday Hinglish (feminine verb forms), short turns, no textbook Hindi.
5. The greeting stays one or two short sentences.
Return ONLY JSON: { "welcome": string, "prompt": string, "changes": string[] } — "changes" lists each edit in one plain sentence.
`.trim();

export async function suggestRevision(input: { welcome: string; prompt: string; feedback: string; transcripts?: string[] }) {
    const raw = await councilChat(
        [
            { role: 'system', content: REVISE_SYSTEM },
            {
                role: 'user',
                content: [
                    `FEEDBACK FROM THE TEAM:\n${input.feedback}`,
                    input.transcripts?.length ? `CALL TRANSCRIPTS THEY ARE REACTING TO:\n${input.transcripts.map((t, i) => `--- call ${i + 1}\n${t.slice(0, 4000)}`).join('\n')}` : '',
                    `CURRENT GREETING:\n${input.welcome}`,
                    `CURRENT SYSTEM PROMPT:\n${input.prompt}`,
                ].filter(Boolean).join('\n\n'),
            },
        ],
        'plan', // the whole prompt comes back; 'procure' (6,000 tokens) is too tight after reasoning
        { model: satejConfig.modelSmart || null },
    );
    const out = parseJsonLoose(raw) as { welcome?: unknown; prompt?: unknown; changes?: unknown } | undefined;
    const welcome = String(out?.welcome ?? '').trim();
    const prompt = String(out?.prompt ?? '').trim();
    if (!welcome || !prompt) throw new Error('The rewrite came back incomplete. Try again, or make the feedback more specific.');
    return {
        welcome,
        prompt,
        changes: Array.isArray(out?.changes) ? out.changes.map(String).slice(0, 12) : [],
        problems: validateScript(welcome, prompt),
    };
}

export interface VoiceVersion {
    id: string;
    kind: 'before_publish' | 'published';
    welcome: string;
    prompt: string;
    note: string | null;
    by: string | null;
    createdAt: string;
}

export async function listVersions(organizationId: string): Promise<{ versions: VoiceVersion[]; tableMissing: boolean }> {
    const { data, error } = await supabaseAdmin.from(VERSIONS).select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(30);
    if (error && isMissingSchemaError(error)) return { versions: [], tableMissing: true };
    if (error) throw new Error(`Script versions: ${error.message}`);
    return {
        tableMissing: false,
        versions: (data ?? []).map((x) => ({
            id: x.id, kind: x.kind, welcome: x.welcome_message, prompt: x.system_prompt, note: x.note, by: x.published_by_name, createdAt: x.created_at,
        })),
    };
}

export async function publishScript(organizationId: string, input: { welcome: string; prompt: string; note?: string }, by: { id: string; name: string }) {
    const agentId = satejConfig.bolnaAgentId;
    if (!agentId) throw new Error('SATEJ_BOLNA_AGENT_ID is not set');
    const problems = validateScript(input.welcome, input.prompt);
    if (problems.length) throw new Error(problems.join('; '));

    const live = await getVoiceScript(agentId);
    if (live.welcome === input.welcome && live.prompt === input.prompt) throw new Error('This is already the live script');

    // Save what was live first. If the versions table is missing, refuse: an un-undoable publish is worse than none.
    const base = { organization_id: organizationId, bolna_agent_id: agentId, published_by_id: by.id, published_by_name: by.name };
    const { error: e1 } = await supabaseAdmin.from(VERSIONS).insert({ ...base, kind: 'before_publish', welcome_message: live.welcome, system_prompt: live.prompt, note: 'Live before this publish' });
    if (e1) {
        throw new Error(isMissingSchemaError(e1)
            ? 'Publishing is off until supabase/migrations/20261003000002_satej_voice_versions.sql is applied — without it the current script could not be restored.'
            : `Could not save the current script before publishing: ${e1.message}`);
    }
    await publishVoiceScript(agentId, input.welcome, input.prompt);
    await supabaseAdmin.from(VERSIONS).insert({ ...base, kind: 'published', welcome_message: input.welcome, system_prompt: input.prompt, note: input.note?.trim() || null });
    return getVoiceScript(agentId);
}
