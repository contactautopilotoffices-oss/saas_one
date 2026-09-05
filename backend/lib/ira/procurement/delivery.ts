/**
 * WHERE MAIL GOES — read from the agent's own config, not from env.
 * -----------------------------------------------------------------------------
 * Recipients and mailboxes are per-agent and per-org. They belong in
 * oem_agents.runtime, editable in the console, and NOT in environment variables
 * or hardcoded constants (dailyDigest.ts still defaults its SPOC to a literal
 * 'saniel@worksquare.in' — that is the bug this replaces).
 *
 * Env survives only as a fallback for a deployment that has not been configured
 * yet, so nothing breaks the moment this ships.
 *
 * ── SITE ROUTING ────────────────────────────────────────────────────────────
 * A finding carries the property it belongs to. A Bengaluru duplicate should
 * reach whoever owns Bengaluru, not every procurement address in the company.
 * `recipients.sites` maps property name or code to addresses; a site with no
 * entry falls back to the role list, so partial configuration is safe.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { AgentRuntimeConfig } from '@/frontend/types/agentRuntime';
import type { RecipientKey } from './types';

export interface Delivery {
    from: string | null;
    replyTo: string | null;
    pollAddress: string | null;
    lookbackHours: number;
    /** role -> addresses, already merged with any site-specific owners. */
    to: Record<RecipientKey, string[]>;
    respond: { enabled: boolean; on: Array<'need_info' | 'blocked'> };
    /** True when nothing was configured and env defaults were used. */
    usingEnvFallback: boolean;
}

const DEFAULT_LOOKBACK_H = 24;

function norm(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.includes('@')) : [];
}

/** Case- and punctuation-insensitive site key, so "SS Plaza" matches "ss-plaza". */
function siteKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve delivery for one agent. Never throws; an unconfigured or unreachable
 * registry falls back to env so a scan can still be sent.
 */
export async function resolveDelivery(orgId: string, agentKey: string): Promise<Delivery> {
    let runtime: AgentRuntimeConfig = {};
    try {
        const { data } = await supabaseAdmin
            .from('oem_agents').select('runtime')
            .eq('organization_id', orgId).eq('agent_key', agentKey).maybeSingle();
        runtime = ((data?.runtime ?? {}) as AgentRuntimeConfig) ?? {};
    } catch { /* fall through to env */ }

    const inbox = runtime.inbox ?? {};
    const roles = runtime.recipients?.roles ?? {};

    const configured =
        Boolean(inbox.from || inbox.reply_to || inbox.poll_address) ||
        norm(roles.ceo).length + norm(roles.procurement).length + norm(roles.technical).length > 0;

    const envList = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

    return {
        from: inbox.from ?? process.env.IRA_FROM_EMAIL ?? null,
        // Reply-To must be a mailbox the poller reads. Defaulting it to
        // poll_address is deliberate: a reply-to nobody polls is the exact
        // failure this module exists to prevent.
        replyTo: inbox.reply_to ?? inbox.poll_address ?? process.env.IRA_REPLY_TO ?? null,
        pollAddress: inbox.poll_address ?? process.env.ZOHO_MAIL_ADDRESS ?? null,
        lookbackHours: inbox.lookback_hours ?? DEFAULT_LOOKBACK_H,
        to: {
            ceo: norm(roles.ceo).length ? norm(roles.ceo) : envList(process.env.IRA_SPOC_EMAIL),
            procurement: norm(roles.procurement),
            technical: norm(roles.technical),
        },
        respond: {
            enabled: runtime.respond?.enabled ?? false,
            on: (runtime.respond?.on as Array<'need_info' | 'blocked'>) ?? ['need_info', 'blocked'],
        },
        usingEnvFallback: !configured,
    };
}

/**
 * Narrow a role's recipients to the people who own a specific site.
 *
 * Returns the role list unchanged when the site is unknown or unmapped — partial
 * site configuration must never silently drop a recipient.
 */
export function recipientsForSite(
    runtime: AgentRuntimeConfig,
    role: RecipientKey,
    property: string | null,
    roleFallback: string[],
): string[] {
    const sites = runtime.recipients?.sites;
    if (!sites || !property) return roleFallback;

    const want = siteKey(property);
    for (const [name, addrs] of Object.entries(sites)) {
        if (siteKey(name) === want || want.includes(siteKey(name))) {
            const list = norm(addrs);
            if (list.length) return list;
        }
    }
    void role;
    return roleFallback;
}
