/**
 * AGENT SECRET STORE — how an agent credential turns into a usable value.
 * ============================================================================
 *
 * THE ONE STORAGE SHAPE: secret_ref, the NAME of a server environment variable.
 *
 * This file used to also carry an AES-256-GCM encryptor and its inverse, so an
 * operator could PASTE a provider key into the console and have it stored in
 * oem_agent_credentials.secret_enc. That has been removed, and the reason is
 * worth writing down so nobody adds it back by reflex.
 *
 *   A pasted per-agent key had NO CONSUMER anywhere in this codebase.
 *
 * The agent LLM path is councilChat() in backend/lib/council/llm.ts, and it
 * reads exactly one thing — `process.env.OPENAI_API_KEY` (llm.ts:172). It takes
 * no per-agent key argument, and neither does any other agent execution path
 * here. So a stored key could be written, encrypted, displayed with a green
 * "configured" chip... and never reach a provider SDK. The operator got an
 * assurance and an agent that still failed with llm_key_missing.
 *
 * Two ways out of that: teach the execution path to accept a per-agent key, or
 * stop offering storage that leads nowhere. This deployment takes the second.
 * A secret this system cannot spend is a stored liability plus a false
 * assurance, and the encryptor that produced it was 150 lines of
 * security-critical code standing over a hole.
 *
 * What remains is honest and small:
 *
 *   - A credential names an environment variable from a CLOSED ALLOWLIST.
 *   - `readAgentSecret()` resolves that name to its value, server-side only.
 *   - "configured" therefore means exactly one checkable thing: THE NAMED
 *     VARIABLE IS PRESENT ON THIS SERVER. Not "a row exists". Not "someone
 *     pasted something once".
 *
 * A key referenced this way also never enters the database, a backup, or a
 * replica, and rotation is an env change rather than a re-entry — which was
 * always the recommended path in the console copy anyway.
 *
 * ############################################################################
 * # readAgentSecret() MUST NEVER BE REACHABLE FROM A ROUTE HANDLER THAT
 * # RETURNS ITS VALUE — OR ANY FUNCTION OF ITS VALUE — TO A CLIENT.
 * #
 * # Not through a response body. Not through a query parameter that echoes it.
 * # Not through an error message that interpolates it. Not "just the first six
 * # characters for debugging". Legitimate callers are server-side paths that
 * # hand the value straight to a provider SDK, and one diagnostic caller —
 * # app/api/cron/agent-heartbeat — which keeps only the BOOLEAN "did this
 * # resolve" and discards the string. GET /api/agents/credentials selects an
 * # explicit column allowlist and must keep doing so.
 * #
 * # If you are here because a form needs to pre-fill a key: it does not. Show
 * # the variable name and whether it is set.
 * ############################################################################
 *
 * IF YOU ARE ADDING PER-AGENT KEY SUPPORT FOR REAL: the order matters. First
 * give the execution path a way to take a key (councilChat(..., { apiKey })),
 * then wire readAgentSecret() into it, and only then offer storage in the UI.
 * Doing it in the other order is how the previous version of this file came to
 * document a closed loop that was open.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_CREDENTIAL_PURPOSES,
    isNotProvisionedError,
    type AgentCredentialPurpose,
} from '@/frontend/types/agentRuntime';

/**
 * Hard stop rather than a comment. This module reads process.env on the server;
 * bundling it into a browser chunk would be a serious mistake, and a mistake
 * that throws at import time is one that gets fixed.
 */
if (typeof window !== 'undefined') {
    throw new Error(
        'app/api/agents/credentials/secretStore.ts is server-only. It must never be imported from a client component.',
    );
}

/* ===========================================================================
 * ENVIRONMENT VARIABLE ALLOWLIST
 *
 * secret_ref stores the NAME of a server environment variable. Two things read
 * that name: `readAgentSecret()` (to fetch the value) and the credentials route
 * (to report `env_present`, so an operator can tell "key missing" from "key
 * wrong"). Both are bounded by the SAME closed set, for two reasons.
 *
 *   1. `env_present` over an arbitrary caller-supplied name is an existence
 *      oracle over the whole server environment for any org admin. Probing
 *      SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY or an internal hostname
 *      returns a boolean today and a map of the deployment after fifty
 *      requests. The value was never returned — but "which secrets does this
 *      server hold" is itself worth not answering.
 *   2. If the read side and the display side disagreed, `configured: true`
 *      would go back to being a claim nothing can honour.
 *
 * A name that is not in this table is rejected at WRITE time with a 400, so an
 * operator finds out immediately rather than after a silent outage.
 * ========================================================================= */

/** Env var names this feature legitimately supplies, and the slots they fit. */
export const CREDENTIAL_ENV_NAMES: Readonly<Record<string, readonly AgentCredentialPurpose[]>> = {
    // Language model
    ANTHROPIC_API_KEY: ['llm'],
    OPENAI_API_KEY: ['llm'],
    GROQ_API_KEY: ['llm'],
    GOOGLE_AI_API_KEY: ['llm'],
    // Voice
    ELEVENLABS_API_KEY: ['voice'],
    // WhatsApp
    WASENDER_API_KEY: ['whatsapp'],
    AISENSY_API_KEY: ['whatsapp'],
    // Telephony (Bolna is both a voice and a calling vendor here)
    BOLNA_API_KEY: ['voice', 'telephony'],
    PLIVO_AUTH_ID: ['telephony'],
    PLIVO_AUTH_TOKEN: ['telephony'],
};

/**
 * The environment variable the agent LLM path actually reads
 * (backend/lib/council/llm.ts:172). Exported because the heartbeat needs to
 * decide whether a credential can make the LLM RUN, which is a stricter
 * question than whether it resolves: a resolvable GROQ_API_KEY does not help a
 * caller that only ever looks at OPENAI_API_KEY.
 *
 * If councilChat() ever learns to take a key argument, this constant and the
 * heartbeat check that uses it are the two places to revisit.
 */
export const LLM_RUNTIME_ENV_NAME = 'OPENAI_API_KEY';

/** Pasting a secret is not a storage option on this deployment. See the header. */
export const SECRET_PASTE_SUPPORTED = false;

/** Said to the operator verbatim, at read time and at write time. */
export const SECRET_PASTE_REFUSAL =
    'This deployment does not store pasted agent keys. A stored key had no consumer — the agent LLM path reads OPENAI_API_KEY from the server environment and takes no per-agent key — so storing one produced a "configured" badge over a credential nothing could spend. Reference an environment variable by name (secret_ref) instead: the value never enters the database, and "configured" then means the variable is actually set.';

/** Shown against a legacy row that still carries ciphertext from the old path. */
export const LEGACY_STORED_SECRET_REASON =
    'This credential holds a key pasted under the old storage path. Nothing in this codebase can read it — the decryptor was removed along with the storage option — so it is reported as NOT configured. Replace it with an environment-variable reference.';

/** May this name be used as a secret_ref (and have its presence reported)? */
export function isCredentialEnvRef(name: string | null | undefined): boolean {
    return !!name && Object.prototype.hasOwnProperty.call(CREDENTIAL_ENV_NAMES, name);
}

/**
 * `true` / `false` for an allowlisted name, `null` for anything else — null
 * meaning "not answered", not "absent". Callers must render the two differently.
 */
export function envPresent(name: string | null | undefined): boolean | null {
    if (!isCredentialEnvRef(name)) return null;
    return !!process.env[name as string];
}

/** The closed set, shaped for the UI so the console never invents a name. */
export function describeAllowedSecretRefs(): Array<{
    name: string;
    purposes: readonly AgentCredentialPurpose[];
}> {
    return Object.entries(CREDENTIAL_ENV_NAMES).map(([name, purposes]) => ({ name, purposes }));
}

/* ===========================================================================
 * THE READ PATH
 * ========================================================================= */

/**
 * Resolve one agent credential to its value, for SERVER-SIDE use only. See the
 * box at the top of this file before calling it.
 *
 * Returns null when there is no credential row, when the runtime tables are not
 * provisioned yet, when the row still carries a legacy pasted secret, when the
 * referenced name is outside the allowlist, or when the referenced variable is
 * unset on this server. Every null is logged with a REASON and never with any
 * part of a value.
 *
 * @example
 *   const key = await readAgentSecret(orgId, 'procurement_scout', 'voice');
 *   if (!key) return { error: 'voice_key_missing' };
 *   const client = new Vendor({ apiKey: key });   // straight to the SDK
 */
export async function readAgentSecret(
    orgId: string,
    agentKey: string,
    purpose: AgentCredentialPurpose,
): Promise<string | null> {
    if (!orgId || !agentKey) return null;
    if (!AGENT_CREDENTIAL_PURPOSES.includes(purpose)) return null;

    const { data, error } = await supabaseAdmin
        .from('oem_agent_credentials')
        .select('secret_ref, last4')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .eq('purpose', purpose)
        .maybeSingle();

    if (isNotProvisionedError(error)) {
        console.warn(`[agents/secret] ${agentKey}/${purpose}: agent runtime tables are not provisioned yet.`);
        return null;
    }
    if (error) {
        console.warn(`[agents/secret] ${agentKey}/${purpose}: lookup failed (${error.code ?? 'unknown'}).`);
        return null;
    }
    if (!data) return null;

    const row = data as { secret_ref: string | null; last4: string | null };

    if (!row.secret_ref) {
        // A row with no ref and a last4 is a legacy pasted key. Say which of the
        // two it is; "returns null" without a reason is how a config problem
        // becomes an outage nobody can diagnose.
        if (row.last4) {
            console.warn(`[agents/secret] ${agentKey}/${purpose}: ${LEGACY_STORED_SECRET_REASON}`);
        }
        return null;
    }

    if (!isCredentialEnvRef(row.secret_ref)) {
        // The write path rejects these, so this is a legacy row or a manual
        // insert. Refuse it rather than reading an arbitrary env var chosen by
        // whoever could write the table.
        console.warn(
            `[agents/secret] ${agentKey}/${purpose}: secret_ref "${row.secret_ref}" is not an accepted environment variable for agent credentials.`,
        );
        return null;
    }

    const value = process.env[row.secret_ref];
    if (!value) {
        console.warn(
            `[agents/secret] ${agentKey}/${purpose}: environment variable ${row.secret_ref} is not set on this server.`,
        );
        return null;
    }
    return value;
}
