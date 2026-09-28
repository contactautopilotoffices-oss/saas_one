/**
 * SATEJ settings. Read at call time, never at module load, so a deployment that
 * adds a variable later is not stuck with the empty value it booted with.
 *
 * Everything that already exists in FMS is reused rather than duplicated:
 *   · LLM      → backend/lib/council/llm.ts (Engy via COUNCIL_PROVIDER=custom)
 *   · Bolna    → the account's BOLNA_API_KEY; only the agent id is Satej's own
 *   · Exa      → the `EXA` key already in .env (EXA_API_KEY also accepted)
 *   · WhatsApp → AiSensy (AISENSY_API_KEY), the sender every other module uses
 *
 * Only settings with no FMS equivalent get a SATEJ_ prefix.
 */

import { resolveProvider } from '@/backend/lib/council/llm';

function env(name: string, fallback = ''): string {
    const v = process.env[name];
    return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function envBool(name: string, fallback: boolean): boolean {
    const v = process.env[name];
    if (v === undefined || v.trim() === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function envInt(name: string, fallback: number): number {
    const n = parseInt(process.env[name] || '', 10);
    return Number.isFinite(n) ? n : fallback;
}

function envList(name: string): string[] {
    return env(name).split(',').map((s) => s.trim()).filter(Boolean);
}

export const satejConfig = {
    /** Canned Engy / Exa / Bolna / WhatsApp. Nothing leaves the server. */
    get mockMode() {
        return envBool('SATEJ_MOCK_MODE', false);
    },

    /**
     * Public origin for links and the Bolna webhook when a requirement carries
     * none (raised from WhatsApp, or a local dev server). NEXT_PUBLIC_APP_URL
     * first, deliberately: APP_URL on the hosted deployment is a LAN address.
     */
    get publicBaseUrl(): string | null {
        const raw = env('SATEJ_PUBLIC_BASE_URL') || env('NEXT_PUBLIC_APP_URL') || env('APP_URL');
        if (!raw) return null;
        try {
            return new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
        } catch {
            return null;
        }
    },

    // --- Engy, through the shared council client. Empty = COUNCIL_MODEL.
    get modelSmart() {
        return env('SATEJ_MODEL_SMART');
    },
    /**
     * Reading search pages — the wide end of the funnel, 30–40 calls a round.
     * Measured 2026-09-28 on the same two vendor pages: deepseek-v4-flash-0731
     * 2.7 s and 25 s, more vendors found; glm-5.3-flash 17 s, then failed on the
     * long directory page (finish_reason=length). 40 pages at glm speed would
     * not fit inside one 300 s function.
     */
    get modelFast() {
        return env('SATEJ_MODEL_FAST', 'deepseek-v4-flash-0731');
    },

    // --- Exa web search
    get exaApiKey() {
        return env('EXA_API_KEY') || env('EXA');
    },
    get exaResultsPerQuery() {
        return envInt('SATEJ_EXA_RESULTS_PER_QUERY', 10);
    },

    // --- Bolna voice
    get bolnaApiKey() {
        return env('BOLNA_API_KEY');
    },
    /** Satej's own voice agent. BOLNA_AGENT_ID is Ira's and is never used here. */
    get bolnaAgentId() {
        return env('SATEJ_BOLNA_AGENT_ID');
    },
    get bolnaBaseUrl() {
        return env('BOLNA_BASE_URL', 'https://api.bolna.ai').replace(/\/$/, '');
    },
    get bolnaFromNumbers(): string[] {
        return envList('SATEJ_BOLNA_FROM_NUMBERS');
    },
    /** Shape from Bolna's create-batch docs (fetched 2026-09-28). */
    get bolnaRetryConfig() {
        return env(
            'SATEJ_BOLNA_RETRY_CONFIG',
            JSON.stringify({ enabled: true, max_retries: 2, retry_intervals_minutes: [30, 90], prioritize_retries: true }),
        );
    },
    /** Shared secret in the webhook URL. Bolna signs nothing, so this is the only check. */
    get webhookToken() {
        return env('SATEJ_BOLNA_WEBHOOK_TOKEN');
    },
    get callWindowStart() {
        return env('SATEJ_CALL_WINDOW_START', '10:00'); // IST
    },
    get callWindowEnd() {
        return env('SATEJ_CALL_WINDOW_END', '18:30'); // IST
    },
    get callDays(): number[] {
        // 0 = Sunday. Default Monday to Saturday.
        return env('SATEJ_CALL_DAYS', '1,2,3,4,5,6')
            .split(',')
            .map((s) => parseInt(s, 10))
            .filter((n) => n >= 0 && n <= 6);
    },
    /** Every vendor has a final result and nothing changed for this long → retries are over. */
    get retryIdleMinutes() {
        return envInt('SATEJ_CALL_RETRY_IDLE_MINUTES', 120);
    },
    get callBatchTimeoutHours() {
        return envInt('SATEJ_CALL_BATCH_TIMEOUT_HOURS', 6);
    },

    // --- WhatsApp through AiSensy. Both templates are in WHATSAPP_META_TEMPLATES.md.
    get waSummaryTemplate() {
        return env('SATEJ_WA_SUMMARY_TEMPLATE', 'satej_vendor_summary_v1');
    },
    /** Questions to answer, or a call list to approve. */
    get waInputTemplate() {
        return env('SATEJ_WA_INPUT_TEMPLATE', 'satej_input_needed_v1');
    },
    get defaultNotifyNumber() {
        return env('SATEJ_WA_DEFAULT_NOTIFY');
    },

    // --- Pipeline behaviour
    /**
     * OFF by default: a person approves the call list before Bolna dials anyone.
     * Calls cost money and reach real businesses; turning this on is a decision,
     * not a default.
     */
    get autoStartCalls() {
        return envBool('SATEJ_AUTO_START_CALLS', false);
    },
    get vendorTarget() {
        return envInt('SATEJ_VENDOR_TARGET', 12);
    },
    get doNotRecallDays() {
        return envInt('SATEJ_DO_NOT_RECALL_DAYS', 30);
    },
    get blockedNumbers(): string[] {
        return envList('SATEJ_BLOCKED_NUMBERS');
    },
};

/**
 * Names of the settings without which Satej cannot run end to end. Names only —
 * this list is shown in the console, so it must never carry a value.
 */
export function missingKeys(): string[] {
    if (satejConfig.mockMode) return [];
    const needed: [string, boolean][] = [
        ['COUNCIL_API_KEY (Engy)', !!resolveProvider().apiKey],
        ['EXA', !!satejConfig.exaApiKey],
        ['BOLNA_API_KEY', !!satejConfig.bolnaApiKey],
        ['SATEJ_BOLNA_AGENT_ID', !!satejConfig.bolnaAgentId],
        ['SATEJ_BOLNA_WEBHOOK_TOKEN', !!satejConfig.webhookToken],
    ];
    return needed.filter(([, ok]) => !ok).map(([k]) => k);
}
