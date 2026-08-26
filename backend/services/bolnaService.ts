/**
 * Bolna — outbound voice for Ira.
 *
 * Three calls we need: create/update her agent, place a call, read the result.
 * Post-call data arrives on our webhook (app/api/webhooks/bolna/route.ts);
 * getExecution() is the polling fallback when the webhook is missed.
 *
 * Voice deliberately reuses the ElevenLabs voice already configured for this
 * org, so Ira sounds the same on a call as anywhere else.
 *
 * The in-call LLM is Bolna-hosted on purpose. Routing conversation turns
 * through our own LLM router adds a network hop to every utterance, and in
 * voice that reads as hesitation. The router is for the offline steps.
 */

const BOLNA_BASE = 'https://api.bolna.ai';

export interface BolnaCallResult {
    execution_id: string | null;
    status: 'queued' | 'failed' | 'unconfigured';
    error?: string;
}

function apiKey(): string | null {
    return process.env.BOLNA_API_KEY || null;
}

async function bolnaFetch(path: string, init: RequestInit): Promise<Response> {
    const key = apiKey();
    if (!key) throw new Error('BOLNA_API_KEY not configured');
    return fetch(`${BOLNA_BASE}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
}

/** Ira's voice-call agent config. Edit the prompt in iraVoicePrompt.ts. */
export function buildAgentConfig(systemPrompt: string, welcome: string, webhookUrl: string) {
    return {
        agent_config: {
            agent_name: 'Ira — Autopilot Procurement',
            agent_welcome_message: welcome,
            webhook_url: webhookUrl,
            tasks: [
                {
                    task_type: 'conversation',
                    toolchain: {
                        execution: 'sequential',
                        pipelines: [['transcriber', 'llm', 'synthesizer']],
                    },
                    tools_config: {
                        llm_agent: {
                            agent_type: 'simple_llm_agent',
                            agent_flow_type: 'streaming',
                            llm_config: {
                                provider: process.env.BOLNA_LLM_PROVIDER || 'openai',
                                model: process.env.BOLNA_LLM_MODEL || 'gpt-5.4-mini',
                                max_tokens: 150,
                                temperature: 1,
                            },
                        },
                        synthesizer: {
                            provider: 'elevenlabs',
                            provider_config: {
                                voice: process.env.IRA_VOICE_NAME || 'Eric',
                                voice_id: process.env.ELEVENLABS_VOICE_ID || 'cjVigY5qzO86Huf0OWal',
                                model: 'eleven_turbo_v2_5',
                            },
                            stream: true,
                            buffer_size: 250,
                            audio_format: 'wav',
                        },
                        transcriber: {
                            provider: 'deepgram',
                            model: 'nova-3',
                            language: 'en',
                            stream: true,
                            encoding: 'linear16',
                            sampling_rate: 16000,
                            endpointing: 250,
                        },
                        input: { provider: process.env.BOLNA_TELEPHONY || 'plivo', format: 'wav' },
                        output: { provider: process.env.BOLNA_TELEPHONY || 'plivo', format: 'wav' },
                    },
                    task_config: {
                        // Vendor intro calls should be short. Cut at 3 minutes.
                        call_terminate: 180,
                        hangup_after_silence: 10,
                    },
                },
            ],
        },
        agent_prompts: {
            task_1: { system_prompt: systemPrompt },
        },
    };
}

export async function createAgent(systemPrompt: string, welcome: string, webhookUrl: string) {
    const res = await bolnaFetch('/v2/agent', {
        method: 'POST',
        body: JSON.stringify(buildAgentConfig(systemPrompt, welcome, webhookUrl)),
    });
    if (!res.ok) throw new Error(`Bolna createAgent ${res.status}: ${(await res.text()).slice(0, 400)}`);
    return res.json() as Promise<{ agent_id: string; state: string }>;
}

/**
 * Place one outbound call. `userData` keys become {placeholders} inside the
 * system prompt and welcome message — this is how each vendor call carries
 * its own context without a new agent per vendor.
 */
export async function placeCall(
    recipient: string,
    userData: Record<string, string>,
): Promise<BolnaCallResult> {
    if (!apiKey()) {
        console.log(`[bolna] not configured — would call ${recipient}`);
        return { execution_id: null, status: 'unconfigured' };
    }
    const agentId = process.env.BOLNA_AGENT_ID;
    if (!agentId) return { execution_id: null, status: 'failed', error: 'BOLNA_AGENT_ID not set' };

    try {
        const res = await bolnaFetch('/call', {
            method: 'POST',
            body: JSON.stringify({
                agent_id: agentId,
                recipient_phone_number: recipient,
                ...(process.env.BOLNA_FROM_NUMBER ? { from_phone_number: process.env.BOLNA_FROM_NUMBER } : {}),
                user_data: userData,
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { execution_id: null, status: 'failed', error: `${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
        }
        return { execution_id: body.execution_id ?? null, status: 'queued' };
    } catch (e) {
        return { execution_id: null, status: 'failed', error: (e as Error).message };
    }
}

/** Polling fallback when the webhook doesn't arrive. */
export async function getExecution(executionId: string) {
    const res = await bolnaFetch(`/executions/${executionId}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Bolna getExecution ${res.status}`);
    return res.json();
}

export function isBolnaConfigured(): boolean {
    return !!(apiKey() && process.env.BOLNA_AGENT_ID);
}
