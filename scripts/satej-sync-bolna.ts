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
 * SARVAM_API_KEY, and SATEJ_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL (the public https origin).
 *
 * SINCE 2026-10-06 MEERA RUNS ON SARVAM, end to end. Bolna (over our own Plivo
 * number) only dials and carries the audio:
 *   · voice   — Sarvam Bulbul v3, inside Bolna's flat per-minute rate;
 *   · ears    — Sarvam Saaras, also inside the flat rate;
 *   · brain   — sarvam-105b-conversations on our own Sarvam key, registered
 *               once on Bolna as a custom OpenAI-compatible model. First token
 *               in ~0.1–0.16 s with this prompt (measured 2026-10-06) against
 *               ~0.4 s on the Azure model it replaces.
 *   … --apply --llm=azure   puts the brain back on Bolna's Azure GPT if Sarvam misbehaves.
 *
 * The approved FAQ (satej_faq) is written into the "# Common questions" section.
 *
 * Bolna's PATCH cannot reach the engine settings (ambient noise, voicemail,
 * hang-up lines, endpointing), so this is a full PUT built from the agent as it
 * stands. The run re-reads the agent afterwards and fails loudly if anything
 * it did not mean to touch has changed. The agent as it was before the change
 * is saved to docs/satej/ first.
 */

import * as dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { withFaq, withoutFaq, type FaqLike } from '../backend/lib/satej/faqSection';
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
const SARVAM_KEY = process.env.SARVAM_API_KEY || '';
const USE_AZURE = process.argv.includes('--llm=azure');
const ORG_ID = process.env.SATEJ_ORG_ID || '211e1330-ad83-446d-941f-dcea48396798'; // Autopilot Offices — whose FAQ Meera speaks

/**
 * One voice for the whole call, in every language slot: Sarvam Bulbul v3, "Priya"
 * (Bolna lists her as conversational). Samples of the other female voices are in
 * docs/satej/voice-samples/ — change voice/voice_id here to switch.
 * Hindi in Devanagari reads cleanly in Bulbul; the prompt writes it that way.
 */
const VOICE = {
    voice: 'Priya',
    voice_id: 'priya',
    model: 'bulbul:v3',
    language: 'hi',
    speed: 1.0,
};
/** Bolna: 100–150 fastest but choppy, 250 balanced. */
const BUFFER_SIZE = 200;
/** Bolna: 350–500 ms suits callers who pause mid-sentence; 200 cut vendors off. */
const ENDPOINTING_MS = 300;
/** Saaras v4: Bolna's recommended Sarvam transcriber; Hindi with English words mixed in. */
const TRANSCRIBER = { provider: 'sarvam', model: 'saaras:v4', language: 'hi', stream: true, endpointing: ENDPOINTING_MS };

const SARVAM_BASE = 'https://api.sarvam.ai/v1';
const SARVAM_MODEL = 'sarvam-105b-conversations';
/** What the brain runs on. Only the fields Bolna documents for a custom model: Azure-only knobs (reasoning_effort, verbosity) are dropped. */
function llmConfig(old: Json): Json {
    if (USE_AZURE) return { ...old, model: 'azure/gpt-5.4-mini', provider: 'azure', family: 'openai', base_url: null, temperature: 1, max_tokens: 250 };
    return {
        provider: 'custom',
        model: SARVAM_MODEL,
        base_url: SARVAM_BASE,
        family: 'sarvam',
        max_tokens: 200,
        temperature: 0.5, // 0.2 repeated the same phrasings call after call
        agent_flow_type: 'streaming',
        request_json: false,
    };
}

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

/** A clean Sarvam synthesizer: the ElevenLabs-only fields (style, similarity_boost…) must not ride along. */
function withVoice(synth: Json): Json {
    return { stream: true, caching: true, audio_format: synth?.audio_format ?? 'wav', buffer_size: BUFFER_SIZE, provider: 'sarvam', provider_config: { ...VOICE } };
}

/** Sarvam transcriber on top of the shared fields (task, encoding, sampling rate, VAD); Deepgram-only fields dropped. */
function withEars(t: Json): Json {
    const keep = ['task', 'encoding', 'sampling_rate', 'vad_threshold', 'vad_prefix_padding_ms', 'keywords'];
    return { ...Object.fromEntries(keep.filter((k) => t?.[k] !== undefined).map((k) => [k, t[k]])), ...TRANSCRIBER };
}

function desired(agent: Json, webhookUrl: string, prompt: string): Json {
    const task = structuredClone(agent.tasks[0]);
    Object.assign(task.task_config, TASK_SETTINGS);
    const tools = task.tools_config;
    tools.synthesizer = withVoice(tools.synthesizer);
    tools.transcriber = withEars(tools.transcriber);
    tools.llm_agent.llm_config = llmConfig(tools.llm_agent.llm_config);

    // One voice, one ear, one prompt. Bulbul and Saaras handle Hindi and English
    // together, so Bolna's per-language hand-off (which swapped voice and
    // transcriber mid-call) is switched off; the slots are kept consistent anyway.
    const ml = tools.multilingual_config;
    if (ml?.languages) {
        ml.enabled = false;
        for (const lang of Object.keys(ml.languages)) {
            const slot = ml.languages[lang];
            slot.system_prompt = prompt;
            slot.synthesizer = withVoice(slot.synthesizer);
            slot.transcriber = withEars(slot.transcriber);
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
        agent_prompts: { task_1: { system_prompt: prompt } },
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
        languages: Object.keys(t.tools_config?.multilingual_config?.languages ?? {}),
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
    if (!USE_AZURE && !SARVAM_KEY) missing.push('SARVAM_API_KEY (or run with --llm=azure)');
    if (missing.length) throw new Error(`Missing in .env: ${missing.join(', ')}`);
    const origin = new URL(ORIGIN).origin;
    if (!origin.startsWith('https://')) throw new Error(`Bolna can only reach a public https origin, got ${origin}`);
    const webhookUrl = `${origin}/api/satej/bolna?token=${encodeURIComponent(TOKEN)}`;

    // The prompt may only use variables the CSV supplies — the whole point of the contract.
    const stray = promptVariables(`${VOICE_WELCOME_MESSAGE}\n${VOICE_AGENT_PROMPT}`).filter(
        (v) => !(CALL_VARIABLES as readonly string[]).includes(v),
    );
    if (stray.length) throw new Error(`Prompt uses variables the CSV does not send: ${stray.join(', ')}`);

    const faq = await approvedFaq();
    const prompt = withFaq(VOICE_AGENT_PROMPT, faq);
    const before = await bolna('GET', `/v2/agent/${AGENT_ID}`);
    // The Satej console can publish Meera's script. If the live one is not the
    // repo's (FAQ aside — that comes from the FAQ page), someone changed it there:
    // do not silently put it back.
    const livePrompt: string = before.agent_prompts?.task_1?.system_prompt ?? '';
    if (withoutFaq(livePrompt) !== withoutFaq(VOICE_AGENT_PROMPT) && !process.argv.includes('--force')) {
        throw new Error('Meera\'s live prompt differs from backend/lib/satej/prompts/voiceAgent.ts — it was probably edited from the Satej console '
            + '(Caller script tab, which keeps every version). Copy that version into voiceAgent.ts first, or re-run with --force to overwrite it.');
    }
    const body = desired(before, webhookUrl, prompt);
    const oldPrompt: string = before.agent_prompts?.task_1?.system_prompt ?? '';

    console.log(`Agent: ${before.agent_name} (${AGENT_ID})`);
    console.log(`Prompt: ${oldPrompt.length} → ${prompt.length} characters (${faq.length} approved FAQ answers)`);
    console.log(`Variables: ${promptVariables(oldPrompt + (before.agent_welcome_message ?? '')).join(', ') || 'none'} → ${CALL_VARIABLES.slice(1).join(', ')}`);
    console.log(`Welcome: "${before.agent_welcome_message}" → "${VOICE_WELCOME_MESSAGE}"`);
    console.log(`Webhook: ${String(before.webhook_url ?? 'none').replace(/token=[^&]+/, 'token=…')} → ${origin}/api/satej/bolna?token=…`);
    const oldTools = before.tasks?.[0]?.tools_config ?? {};
    console.log(`Voice: ${oldTools.synthesizer?.provider}/${oldTools.synthesizer?.provider_config?.voice} → sarvam/${VOICE.voice} (${VOICE.model})`);
    console.log(`Ears: ${oldTools.transcriber?.provider}/${oldTools.transcriber?.model} → sarvam/${TRANSCRIBER.model}, endpointing ${ENDPOINTING_MS} ms`);
    console.log(`Brain: ${oldTools.llm_agent?.llm_config?.provider}/${oldTools.llm_agent?.llm_config?.model} → ${USE_AZURE ? 'azure/gpt-5.4-mini' : `custom/${SARVAM_MODEL}`}`);
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

    if (!USE_AZURE) await ensureSarvamModel();
    await bolna('PUT', `/v2/agent/${AGENT_ID}`, body);
    const after = await bolna('GET', `/v2/agent/${AGENT_ID}`);

    const problems: string[] = [];
    const t = after.tasks?.[0] ?? {};
    if (after.agent_prompts?.task_1?.system_prompt !== prompt) problems.push('system prompt did not take');
    const llm = t.tools_config?.llm_agent?.llm_config ?? {};
    if (!USE_AZURE && (llm.provider !== 'custom' || llm.model !== SARVAM_MODEL)) problems.push(`LLM did not take (${llm.provider}/${llm.model})`);
    if (t.tools_config?.transcriber?.provider !== 'sarvam') problems.push('transcriber did not take');
    if (after.agent_welcome_message !== VOICE_WELCOME_MESSAGE) problems.push('welcome message did not take');
    if (after.webhook_url !== webhookUrl) problems.push('webhook did not take');
    for (const [k, v] of Object.entries(TASK_SETTINGS)) {
        if (JSON.stringify(t.task_config?.[k]) !== JSON.stringify(v)) problems.push(`task_config.${k} did not take`);
    }
    const synths = [t.tools_config?.synthesizer, ...Object.values(t.tools_config?.multilingual_config?.languages ?? {}).map((s: any) => s?.synthesizer)]; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const s of synths) {
        if (s?.provider !== 'sarvam' || s?.provider_config?.voice_id !== VOICE.voice_id || s?.provider_config?.model !== VOICE.model) problems.push('a voice slot did not take');
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

/** Approved FAQ answers for Meera's "# Common questions" section. Empty (with a warning) if the table is not there yet. */
async function approvedFaq(): Promise<FaqLike[]> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return [];
    const { data, error } = await createClient(url, key).from('satej_faq').select('*').eq('organization_id', ORG_ID).eq('status', 'approved').order('sort_order');
    if (error) {
        console.warn(`FAQ not read (${error.message}) — Meera goes out without common answers. Apply supabase/migrations/20261006000001_satej_rate_benchmark.sql.`);
        return [];
    }
    return (data ?? []).map((x) => ({ question: x.question, answer: x.answer, status: x.status }));
}

/** Register sarvam-105b-conversations on Bolna once. Bolna checks the endpoint and key before saving. */
async function ensureSarvamModel() {
    try {
        await bolna('POST', '/user/model/custom', {
            custom_model_name: SARVAM_MODEL,
            custom_model_url: SARVAM_BASE,
            custom_model_key: SARVAM_KEY,
            custom_model_family: 'sarvam',
        });
        console.log(`Registered ${SARVAM_MODEL} on Bolna as a custom model.`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already|exist|unique|duplicate/i.test(msg)) console.log(`${SARVAM_MODEL} is already registered on Bolna.`);
        else throw new Error(`Could not register Sarvam on Bolna: ${msg}`);
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
