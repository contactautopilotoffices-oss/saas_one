/**
 * Bolna — AGENT LIFECYCLE ONLY.
 *
 * Scope boundary, deliberately narrow:
 *   - This file creates, reads and updates Bolna *agents* (identity, prompt,
 *     voice, telephony). VoiceCallingService does not do this.
 *   - It does NOT place calls. `VoiceCallingService.triggerCall()` owns that,
 *     because it also writes the audit row to omnichannel_call_logs — the
 *     aggregator across WhatsApp, Plivo direct and Bolna. A second call path
 *     would mean calls that never appear in the log.
 *   - Post-call data lands on /api/voice/webhook (already wired to the
 *     aggregator via bolna_call_id). getExecution() is the polling fallback.
 *
 * Voice reuses the ElevenLabs voice already proven in this Bolna account, so
 * Ira sounds the same on a call as anywhere else.
 *
 * The in-call LLM is Bolna-hosted on purpose. Routing conversation turns
 * through our own LLM router adds a network hop to every utterance, and in
 * voice that reads as hesitation. The router is for the offline steps.
 */

const BOLNA_BASE = 'https://api.bolna.ai';

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
 * Placing calls lives in VoiceCallingService.triggerCall(), which also writes
 * the omnichannel_call_logs audit row. Import it there, not here.
 *
 *   import { VoiceCallingService } from '@/backend/services/VoiceCallingService';
 *   await VoiceCallingService.triggerCall({ ... });
 */

/** Polling fallback when the webhook doesn't arrive. */
export async function getExecution(executionId: string) {
    const res = await bolnaFetch(`/executions/${executionId}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Bolna getExecution ${res.status}`);
    return res.json();
}

export function isBolnaConfigured(): boolean {
    return !!(apiKey() && process.env.BOLNA_AGENT_ID);
}
