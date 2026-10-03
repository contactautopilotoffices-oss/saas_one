/**
 * Push Satej's voice agent (Meera) onto Bolna: prompt, greeting, voice, engine
 * settings and the per-call webhook. The text comes from
 * backend/lib/satej/prompts/voiceAgent.ts, so the repo — not the Bolna
 * dashboard — is where Meera's words are edited.
 *
 *   npx tsx scripts/satej-sync-bolna.ts            # dry run: prints what would change
 *   npx tsx scripts/satej-sync-bolna.ts --apply    # backs up, applies, re-reads and verifies
 *   … --apply --force                              # also when the live prompt was edited from the console
 *
 * Needs in .env: BOLNA_API_KEY, SATEJ_BOLNA_AGENT_ID, SATEJ_BOLNA_WEBHOOK_TOKEN,
 * and SATEJ_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL (the public https origin).
 *
 * Bolna's PATCH cannot reach the engine settings (ambient noise, voicemail,
 * hang-up lines, endpointing), so this is a full PUT built from the agent as it
 * stands. The run re-reads the agent afterwards and fails loudly if anything
 * it did not mean to touch has changed. The agent as it was before the change
 * is saved to docs/satej/ first.
 */

import * as dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
    CALL_VARIABLES,
    VOICE_AGENT_PROMPT,
    VOICE_HANGUP_PROMPT,
    VOICE_WELCOME_MESSAGE,
    promptVariables,
} from '../backend/lib/satej/prompts/voiceAgent';

dotenv.config();

const BASE = (process.env.BOLNA_BASE_URL || 'https://api.bolna.ai').replace(/\/$/, '');
const KEY = process.env.BOLNA_API_KEY || '';
const AGENT_ID = process.env.SATEJ_BOLNA_AGENT_ID || '';
const TOKEN = process.env.SATEJ_BOLNA_WEBHOOK_TOKEN || '';
const ORIGIN = process.env.SATEJ_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
const APPLY = process.argv.includes('--apply');

/**
 * One voice for the whole call. Meera used to speak Hindi as "Saavi" and switch
 * to a different voice ("Sheps Rocky") the moment a vendor spoke English —
 * a caller changing voice mid-sentence is the clearest tell there is.
 * Turbo v2.5 is Bolna's recommended production model and is faster than
 * multilingual v2, which took 280–530 ms to first audio per turn on this
 * agent's own calls (24 Sep, on top of ~400 ms of LLM time).
 */
const VOICE = {
    model: 'eleven_turbo_v2_5',
    voice: 'Saavi - Friendly, Empathetic and Helpful',
    voice_id: 'DpnM70iDHNHZ0Mguv6GJ',
    speed: 1,
    style: 0,
    temperature: 0.5,
    similarity_boost: 0.6,
};
/** Bolna: 100–150 fastest but choppy, 250 balanced. The English slot sat at 40. */
const BUFFER_SIZE = 250;
/** Bolna: 350–500 ms suits callers who pause mid-sentence; 200 cut vendors off. */
const ENDPOINTING_MS = 300;

const TASK_SETTINGS: Record<string, unknown> = {
    ambient_noise: true, // quiet office behind the voice instead of studio silence
    ambient_noise_track: 'office-ambience',
    discard_pre_welcome_utterance: true, // the vendor's "Hello?" no longer gets a second greeting
    // OFF: Plivo's detector hung up on real people within 2 s of "hello" (code 4010,
    // voicemail_detected — every test call on 2026-10-03). The prompt already ends
    // the call itself when a voicemail or IVR answers.
    voicemail: false,
    call_hangup_message: { en: 'Okay, bye.', hi: 'Theek hai ji, bye.' }, // was "The call will now disconnect. Goodbye!"
    check_user_online_message: { en: 'Hello? Can you hear me?', hi: 'Hello? Aawaz aa rahi hai?' },
    call_cancellation_prompt: VOICE_HANGUP_PROMPT,
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bolna(method: string, path: string, body?: unknown): Promise<Json> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : {};
}

function withVoice(synth: Json): Json {
    return { ...synth, buffer_size: BUFFER_SIZE, provider: 'elevenlabs', provider_config: { ...(synth?.provider_config ?? {}), ...VOICE } };
}

function desired(agent: Json, webhookUrl: string): Json {
    const task = structuredClone(agent.tasks[0]);
    Object.assign(task.task_config, TASK_SETTINGS);
    const tools = task.tools_config;
    tools.synthesizer = withVoice(tools.synthesizer);
    tools.transcriber = { ...tools.transcriber, endpointing: ENDPOINTING_MS };
    tools.llm_agent.llm_config.temperature = 0.4; // 0.2 repeated the same phrasings call after call

    const ml = tools.multilingual_config;
    if (ml?.languages) {
        for (const lang of Object.keys(ml.languages)) {
            const slot = ml.languages[lang];
            slot.system_prompt = VOICE_AGENT_PROMPT;
            slot.synthesizer = withVoice(slot.synthesizer);
            slot.transcriber = { ...slot.transcriber, endpointing: ENDPOINTING_MS };
            // "Let me connect you with {agent_name} who speaks {language}" — spoken with no agent name set.
            slot.handoff_message = null;
        }
    }

    return {
        agent_config: {
            agent_name: agent.agent_name,
            agent_welcome_message: VOICE_WELCOME_MESSAGE,
            webhook_url: webhookUrl,
            agent_type: agent.agent_type,
            tasks: [task],
            ingest_source_config: agent.ingest_source_config,
            calling_guardrails: agent.calling_guardrails,
            call_summary_enabled: agent.call_summary_enabled,
        },
        agent_prompts: { task_1: { system_prompt: VOICE_AGENT_PROMPT } },
    };
}

/** Fields this script must NOT change. Compared before and after. */
function untouched(agent: Json): Json {
    const t = agent.tasks?.[0] ?? {};
    return {
        agent_name: agent.agent_name,
        agent_type: agent.agent_type,
        dispositions: agent.dispositions,
        custom_analytics: agent.custom_analytics,
        calling_guardrails: agent.calling_guardrails,
        call_summary_enabled: agent.call_summary_enabled,
        input: t.tools_config?.input,
        output: t.tools_config?.output,
        toolchain: t.toolchain,
        llm_model: t.tools_config?.llm_agent?.llm_config?.model,
        max_tokens: t.tools_config?.llm_agent?.llm_config?.max_tokens,
        transcriber_model: t.tools_config?.transcriber?.model,
        transcriber_language: t.tools_config?.transcriber?.language,
        languages: Object.keys(t.tools_config?.multilingual_config?.languages ?? {}),
        active_language: t.tools_config?.multilingual_config?.active_language,
        call_terminate: t.task_config?.call_terminate,
        hangup_after_silence: t.task_config?.hangup_after_silence,
    };
}

async function main() {
    const missing = [
        ['BOLNA_API_KEY', KEY],
        ['SATEJ_BOLNA_AGENT_ID', AGENT_ID],
        ['SATEJ_BOLNA_WEBHOOK_TOKEN', TOKEN],
        ['SATEJ_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL', ORIGIN],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`Missing in .env: ${missing.join(', ')}`);
    const origin = new URL(ORIGIN).origin;
    if (!origin.startsWith('https://')) throw new Error(`Bolna can only reach a public https origin, got ${origin}`);
    const webhookUrl = `${origin}/api/satej/bolna?token=${encodeURIComponent(TOKEN)}`;

    // The prompt may only use variables the CSV supplies — the whole point of the contract.
    const stray = promptVariables(`${VOICE_WELCOME_MESSAGE}\n${VOICE_AGENT_PROMPT}`).filter(
        (v) => !(CALL_VARIABLES as readonly string[]).includes(v),
    );
    if (stray.length) throw new Error(`Prompt uses variables the CSV does not send: ${stray.join(', ')}`);

    const before = await bolna('GET', `/v2/agent/${AGENT_ID}`);
    // The Satej console can now publish Meera's script. If the live one is not
    // the repo's, someone changed it there — do not silently put it back.
    const livePrompt: string = before.agent_prompts?.task_1?.system_prompt ?? '';
    if (livePrompt !== VOICE_AGENT_PROMPT && !process.argv.includes('--force')) {
        throw new Error('Meera\'s live prompt differs from backend/lib/satej/prompts/voiceAgent.ts — it was probably edited from the Satej console '
            + '(Caller script tab, which keeps every version). Copy that version into voiceAgent.ts first, or re-run with --force to overwrite it.');
    }
    const body = desired(before, webhookUrl);
    const oldPrompt: string = before.agent_prompts?.task_1?.system_prompt ?? '';

    console.log(`Agent: ${before.agent_name} (${AGENT_ID})`);
    console.log(`Prompt: ${oldPrompt.length} → ${VOICE_AGENT_PROMPT.length} characters`);
    console.log(`Variables: ${promptVariables(oldPrompt + (before.agent_welcome_message ?? '')).join(', ') || 'none'} → ${CALL_VARIABLES.slice(1).join(', ')}`);
    console.log(`Welcome: "${before.agent_welcome_message}" → "${VOICE_WELCOME_MESSAGE}"`);
    console.log(`Webhook: ${before.webhook_url ?? 'none'} → ${origin}/api/satej/bolna?token=…`);
    console.log(`Voice: one voice (${VOICE.voice}, ${VOICE.model}) for every language; endpointing ${ENDPOINTING_MS} ms`);
    console.log(`Engine: ${Object.keys(TASK_SETTINGS).join(', ')}`);

    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply to change the agent.');
        return;
    }

    mkdirSync('docs/satej', { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const backup = `docs/satej/bolna-agent-backup-${stamp}.json`;
    // The live webhook URL carries the shared secret; backups are committed, so it never goes in one.
    const redacted = JSON.stringify(before, null, 2).split(encodeURIComponent(TOKEN)).join('REDACTED');
    writeFileSync(backup, redacted);
    console.log(`\nBackup written: ${backup}`);

    await bolna('PUT', `/v2/agent/${AGENT_ID}`, body);
    const after = await bolna('GET', `/v2/agent/${AGENT_ID}`);

    const problems: string[] = [];
    const t = after.tasks?.[0] ?? {};
    if (after.agent_prompts?.task_1?.system_prompt !== VOICE_AGENT_PROMPT) problems.push('system prompt did not take');
    if (after.agent_welcome_message !== VOICE_WELCOME_MESSAGE) problems.push('welcome message did not take');
    if (after.webhook_url !== webhookUrl) problems.push('webhook did not take');
    for (const [k, v] of Object.entries(TASK_SETTINGS)) {
        if (JSON.stringify(t.task_config?.[k]) !== JSON.stringify(v)) problems.push(`task_config.${k} did not take`);
    }
    const synths = [t.tools_config?.synthesizer, ...Object.values(t.tools_config?.multilingual_config?.languages ?? {}).map((s: any) => s?.synthesizer)]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const s of synths) {
        if (s?.provider_config?.voice_id !== VOICE.voice_id || s?.provider_config?.model !== VOICE.model) problems.push('a voice slot did not take');
    }
    const a = JSON.stringify(untouched(before));
    const b = JSON.stringify(untouched(after));
    if (a !== b) problems.push(`fields outside this change moved:\n  before ${a}\n  after  ${b}`);

    if (problems.length) {
        console.error(`\nVERIFY FAILED:\n- ${problems.join('\n- ')}\nRestore from ${backup} if needed.`);
        process.exit(1);
    }
    console.log('Applied and verified. Reload the agent page in the Bolna dashboard before editing it there.');
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
