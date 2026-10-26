/**
 * Create or update "Meera (graph)" — Meera's vendor call as a Bolna GRAPH agent.
 *
 *   npx tsx scripts/satej-graph-agent.ts            # dry run: prints the graph
 *   npx tsx scripts/satej-graph-agent.ts --apply    # creates (or updates SATEJ_BOLNA_GRAPH_AGENT_ID)
 *
 * Why a graph: the single-prompt Meera holds the whole call in one 6,800-
 * character prompt and can wander or skip a step. Here each stage is its own
 * node with a short prompt and explicit transitions, so the GST gate cannot be
 * skipped and a "not registered" answer always ends the call politely.
 *
 * It is a SEPARATE agent. Meera (single prompt) stays as she is and keeps
 * calling vendors; test this one with "Call me first" (choose "Meera (graph)"),
 * and only point SATEJ_BOLNA_AGENT_ID at it once it sounds better.
 *
 * Voice, transcriber, telephony, ambient sound, hang-up rules and the webhook
 * are copied from Meera (SATEJ_BOLNA_AGENT_ID), so the only difference heard on
 * a call is the conversation logic.
 */

import * as dotenv from 'dotenv';
import { VOICE_HANGUP_PROMPT, VOICE_WELCOME_MESSAGE } from '../backend/lib/satej/prompts/voiceAgent';

dotenv.config();

const BASE = (process.env.BOLNA_BASE_URL || 'https://api.bolna.ai').replace(/\/$/, '');
const KEY = process.env.BOLNA_API_KEY || '';
const MEERA = process.env.SATEJ_BOLNA_AGENT_ID || '';
const EXISTING = process.env.SATEJ_BOLNA_GRAPH_AGENT_ID || '';
const APPLY = process.argv.includes('--apply');

/** Graph prompts take {{double}} braces; every one of these comes from Meera's CSV row. */
const CALL = `
This call: business {{vendor_name}}; work: {{item_summary}} ({{item_category}}); quantity {{quantity_text}}; scope {{scope_text}}; site {{location_text}}; {{spend_type_text}}; timeline {{timeline_text}}.
About us, if asked: Autopilot Offices runs managed and flexible offices in Mumbai, Bengaluru, Noida, Hyderabad, Indore and Kolkata. The procurement team sends a detailed requirement or BOQ on WhatsApp for a quotation; orders go by formal purchase order.`.trim();

const STYLE = `
You are Meera, a procurement coordinator at Autopilot Offices, on a live phone call. Everything you write is spoken aloud.
Speak everyday Hinglish in Roman letters (switch to simple Indian English if they speak English). You are a woman: "bol rahi hoon", "samajh gayi".
At most two short sentences and one question per turn. Begin with a short varied acknowledgement or none ("achha", "haan ji", "theek hai"). Never number or announce questions. Never use textbook Hindi (saksham, uplabdh, kripya, sampark) or "Wonderful", "Great", "Certainly".
Never discuss prices, rates or budget — say "Rate aap details dekh ke quote kar dijiye, main WhatsApp pe bhej deti hoon." Never promise an order.
If they ask what the work is, tell them from this call's details. If asked directly whether you are a person or an AI, say honestly in one line that you are Autopilot Offices' AI assistant and the procurement team will follow up, then continue.
${CALL}`.trim();

const node = (id: string, task: string, edges: unknown[], extra: Record<string, unknown> = {}) => ({
    id,
    node_type: 'llm',
    prompt: `${STYLE}\n\nNOW: ${task}`,
    edges,
    ...extra,
});
const to = (to_node_id: string, condition: string, priority = 100) => ({ to_node_id, condition, condition_type: 'llm', priority });

const BUSY = to('callback', 'The person is busy or asks to be called later', 50);
const WRONG = to('end_sorry', 'Wrong number, or the business does not do this kind of work, or they are not interested', 60);

export const NODES = [
    node('confirm',
        'The greeting already asked whether this is {{vendor_name}}. Read their reply. If they ask who is calling, say "Meera, Autopilot Offices se."',
        [to('intro', 'They confirm this is the business, or ask who is calling or what it is about'), WRONG, BUSY]),
    node('intro',
        'Introduce yourself and the work in one go, in your own words, e.g. "Main Meera, Autopilot Offices se. Humein {{location_text}} mein {{item_category}} ka kaam karwana hai, {{quantity_text}}, {{timeline_text}}. Aap yeh kaam karte hain?"',
        [to('gst', 'They say they do this kind of work or are interested'), WRONG, BUSY]),
    node('gst',
        'Ask whether their business is GST registered: "Aapka business GST registered hai?" Ask nothing else.',
        [to('basics', 'They say yes, the business is GST registered'), to('end_no_gst', 'They say the business is not GST registered', 40), BUSY]),
    node('basics',
        'Ask these one at a time, in order, and wait for each answer: how many years they have been in this line; roughly their annual turnover (offer ranges if they hesitate: pachees lakh se kam, pachees lakh se ek crore, ek se paanch crore, paanch crore se upar); whether they have a website or company profile to share; and for {{quantity_text}} at {{location_text}}, how many days they need.',
        [to('capability', 'All four have been asked and answered (or politely declined)'), BUSY]),
    node('capability',
        'Ask these one at a time, in order: what kind of {{item_category}} work they mainly do; two or three clients or projects where they did similar work; whether one of those clients can be contacted for a reference; what makes them different from others.',
        [to('close', 'All four have been asked and answered (or politely declined)'), BUSY]),
    node('close',
        'Ask the name of the person you are speaking with if you do not have it. Check WhatsApp is on this same number. Say the team will send the full details on WhatsApp and ask them to send their company profile, GST certificate and client list there. End with one short line, e.g. "Theek hai ji, thank you. Main details bhej deti hoon."',
        []),
    node('callback',
        'They are busy. Ask when to call back, confirm the time once, thank them and end: "Theek hai ji, tab call karti hoon. Thank you."',
        []),
    {
        id: 'end_no_gst',
        node_type: 'static',
        static_message: 'Achha, samajh gayi. Hamare process mein abhi GST registered vendors hi chahiye hote hain. Aapka time dene ke liye shukriya ji.',
        edges: [],
    },
    {
        id: 'end_sorry',
        node_type: 'static',
        static_message: 'Achha, maaf kijiye disturb kiya. Thank you ji, aapka din achha rahe.',
        edges: [],
    },
];

const ROUTING = 'Route on what the vendor actually said in their last reply. If unclear, stay on the current node and ask again.';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function bolna(method: string, path: string, body?: unknown): Promise<Json> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 900)}`);
    return text ? JSON.parse(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')) : {};
}

async function main() {
    if (!KEY || !MEERA) throw new Error('BOLNA_API_KEY and SATEJ_BOLNA_AGENT_ID are required');
    const meera = await bolna('GET', `/v2/agent/${MEERA}`);
    const task = structuredClone(meera.tasks[0]);
    const tools = task.tools_config;

    // Bolna reads the graph from INSIDE llm_config (GraphAgentConfig), not beside it.
    tools.llm_agent = {
        agent_type: 'graph_agent',
        agent_flow_type: 'streaming',
        llm_config: {
            ...(tools.llm_agent?.llm_config ?? {}),
            agent_flow_type: 'streaming',
            agent_information: 'Meera, procurement coordinator at Autopilot Offices, screening a local vendor for a live requirement on a phone call.',
            routing_instructions: ROUTING,
            nodes: NODES,
            current_node_id: 'confirm',
        },
    };
    // One language path: the graph carries the Hinglish/English switch in its own prompts.
    delete tools.multilingual_config;
    task.task_config = { ...task.task_config, voicemail: false, call_cancellation_prompt: VOICE_HANGUP_PROMPT };

    const agent_config = {
        agent_name: 'Meera (graph)',
        agent_welcome_message: VOICE_WELCOME_MESSAGE.replace(/\{(\w+)\}/g, '{{$1}}'),
        webhook_url: meera.webhook_url,
        agent_type: meera.agent_type,
        tasks: [task],
        calling_guardrails: meera.calling_guardrails,
    };
    const body = { agent_config, agent_prompts: { task_1: { system_prompt: STYLE } } };

    console.log(`Graph: ${NODES.map((n) => n.id).join(' → ')}`);
    for (const n of NODES) console.log(`  ${n.id.padEnd(11)} ${n.node_type.padEnd(7)} → ${(n.edges as { to_node_id: string }[]).map((e) => e.to_node_id).join(', ') || '(end)'}`);
    if (!APPLY) { console.log('\nDry run. Re-run with --apply.'); return; }

    if (EXISTING) {
        await bolna('PUT', `/v2/agent/${EXISTING}`, body);
        console.log(`Updated ${EXISTING}.`);
    } else {
        const created = await bolna('POST', '/v2/agent', body);
        const id = created.agent_id ?? created.id;
        console.log(`Created "Meera (graph)": ${id}\nSet SATEJ_BOLNA_GRAPH_AGENT_ID=${id}`);
    }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
