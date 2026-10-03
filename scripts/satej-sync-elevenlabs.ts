/**
 * Create or update Satej's in-app voice — the ElevenLabs Conversational AI
 * agent the "Call Satej" button talks to. (Vendors are phoned by Meera on
 * Bolna; this is the team talking to Satej about a requirement.)
 *
 *   npx tsx scripts/satej-sync-elevenlabs.ts            # dry run
 *   npx tsx scripts/satej-sync-elevenlabs.ts --apply    # create/update, print the agent id
 *
 * The agent's own prompt is only a fallback: every call overrides it with the
 * requirement's live context (/api/satej/call), which is why the prompt and
 * first-message overrides are switched on here — ElevenLabs refuses an override
 * the agent does not allow.
 *
 * Needs ELEVENLABS_API_KEY. Writes nothing to .env; put the printed id in
 * SATEJ_ELEVENLABS_AGENT_ID (local .env and Vercel).
 */

import * as dotenv from 'dotenv';

dotenv.config();

const KEY = process.env.ELEVENLABS_API_KEY || '';
const EXISTING = process.env.SATEJ_ELEVENLABS_AGENT_ID || '';
const APPLY = process.argv.includes('--apply');
const BASE = 'https://api.elevenlabs.io';

/** "Amay - Professional Indian English", shared library, conversational. */
const VOICE = { id: 'w2VczpnpJO48HDyBg1xV', name: 'Amay - Professional Indian English' };

const FALLBACK_PROMPT =
    'You are Satej, the vendor-discovery assistant of Autopilot Offices. Speak briefly and plainly. '
    + 'If you were not given a requirement to discuss, say so and ask the caller to open one in FMS.';

const AGENT_CONFIG = {
    name: 'Satej (FMS vendor discovery)',
    conversation_config: {
        agent: {
            first_message: 'Hi, Satej here. What would you like to know?',
            language: 'en',
            prompt: { prompt: FALLBACK_PROMPT, llm: 'gemini-2.5-flash', temperature: 0.3 },
        },
        tts: { voice_id: VOICE.id, model_id: 'eleven_flash_v2', stability: 0.5, speed: 1.0 },
        conversation: { max_duration_seconds: 900 },
    },
    platform_settings: {
        overrides: {
            conversation_config_override: {
                agent: { prompt: { prompt: true }, first_message: true, language: false },
            },
        },
    },
};

async function el(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'xi-api-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
}

async function main() {
    if (!KEY) throw new Error('ELEVENLABS_API_KEY is not set');

    // A shared-library voice must be in the account before an agent can use it.
    const mine = await el('GET', '/v2/voices?page_size=100');
    const have = (mine.voices ?? []).some((v: { voice_id: string }) => v.voice_id === VOICE.id);
    console.log(`Voice ${VOICE.name}: ${have ? 'already in the account' : 'will be added from the library'}`);
    console.log(EXISTING ? `Agent ${EXISTING}: will be updated` : 'Agent: will be created');
    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply.');
        return;
    }

    if (!have) {
        const shared = await el('GET', `/v1/shared-voices?page_size=5&search=${encodeURIComponent('Amay')}`);
        const hit = (shared.voices ?? []).find((v: { voice_id: string }) => v.voice_id === VOICE.id);
        if (!hit) throw new Error('Amay was not found in the shared voice library');
        await el('POST', `/v1/voices/add/${hit.public_owner_id}/${VOICE.id}`, { new_name: VOICE.name });
        console.log('Voice added.');
    }

    if (EXISTING) {
        await el('PATCH', `/v1/convai/agents/${EXISTING}`, AGENT_CONFIG);
        console.log(`Updated agent ${EXISTING}.`);
    } else {
        const created = await el('POST', '/v1/convai/agents/create', AGENT_CONFIG);
        console.log(`Created agent ${created.agent_id}. Set SATEJ_ELEVENLABS_AGENT_ID=${created.agent_id}`);
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
