/**
 * Create the VMS Face (testing) host-approval voice agent on Bolna — a new, separate agent; Ira and
 * Meera are not touched. Spec: docs/vms-face/AGENT_SPEC.md.
 *
 *   npx tsx --env-file=.env scripts/vms-face-create-bolna-agent.ts            # dry run: print the config
 *   npx tsx --env-file=.env scripts/vms-face-create-bolna-agent.ts --create   # create it on Bolna
 *
 * Needs BOLNA_API_KEY, VMS_FACE_BOLNA_WEBHOOK_TOKEN and VMS_FACE_PUBLIC_BASE_URL (or NEXT_PUBLIC_APP_URL).
 * Afterwards set VMS_FACE_BOLNA_AGENT_ID to the printed agent id.
 */
import { buildAgentConfig } from '../backend/services/bolnaService';
import { HOST_CALL_AGENT_NAME, HOST_CALL_SYSTEM_PROMPT, HOST_CALL_WELCOME } from '../backend/lib/vms-face/hostCallPrompt';

async function main() {
    const create = process.argv.includes('--create');
    const origin = (process.env.VMS_FACE_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const token = process.env.VMS_FACE_BOLNA_WEBHOOK_TOKEN;
    if (!origin) throw new Error('Set VMS_FACE_PUBLIC_BASE_URL (or NEXT_PUBLIC_APP_URL) to the public app URL');
    if (!token) throw new Error('Set VMS_FACE_BOLNA_WEBHOOK_TOKEN first (any long random string)');

    const webhookUrl = `${origin}/api/vms-face/bolna?token=${encodeURIComponent(token)}`;
    const config = buildAgentConfig(HOST_CALL_SYSTEM_PROMPT, HOST_CALL_WELCOME, webhookUrl);
    config.agent_config.agent_name = HOST_CALL_AGENT_NAME;
    // An approval call is a few sentences: cut at 90 s, hang up after 8 s of silence.
    config.agent_config.tasks[0].task_config = { call_terminate: 90, hangup_after_silence: 8 };

    if (!create) {
        const shown = JSON.stringify(config, null, 2).replace(encodeURIComponent(token), '<token>');
        console.log(shown);
        console.log('\nDry run only. Re-run with --create to create the agent on Bolna.');
        return;
    }

    if (!process.env.BOLNA_API_KEY) throw new Error('BOLNA_API_KEY is not set');
    const res = await fetch('https://api.bolna.ai/v2/agent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Bolna create agent ${res.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text);
    console.log(`Created agent ${data.agent_id} (${data.state}). Set VMS_FACE_BOLNA_AGENT_ID=${data.agent_id}`);
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
