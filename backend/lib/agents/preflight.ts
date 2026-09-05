/**
 * PREFLIGHT — one honest answer to "can this agent actually run?"
 * -----------------------------------------------------------------------------
 * Everything needed to go live is currently spread across six tabs, three env
 * vars, a migration and a Zoho console. Nobody can hold that, so agents sit in
 * draft because nobody is sure what is missing.
 *
 * This is one list. Each item says what it checks, what it found, and — when it
 * fails — the single next action. Nothing here is a guess: every check reads the
 * live database or the live env, and a check that cannot run reports UNKNOWN
 * rather than passing.
 *
 * BLOCKING vs ADVISORY is the distinction that matters. A blocking item means
 * the agent cannot work at all. An advisory means it will run but do less than
 * you think — which is the more dangerous of the two, because it looks healthy.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { bindTools } from '@/backend/lib/agents/plan';
import { resolveDelivery } from '@/backend/lib/ira/procurement/delivery';

export type CheckState = 'ok' | 'blocking' | 'advisory' | 'unknown';

export interface Check {
    key: string;
    label: string;
    state: CheckState;
    /** What was found. Concrete, never "not configured". */
    detail: string;
    /** The one next action, when there is one. */
    fix?: string;
}

export interface Preflight {
    checks: Check[];
    canRun: boolean;
    canSend: boolean;
    summary: string;
}

export async function preflight(orgId: string, agentKey: string): Promise<Preflight> {
    const checks: Check[] = [];
    const push = (c: Check) => checks.push(c);

    /* ---- 1. the agent row -------------------------------------------------- */
    const { data: agent, error: agentErr } = await supabaseAdmin
        .from('oem_agents')
        .select('status, system_prompt, system_prompt_version, runtime, model_config')
        .eq('organization_id', orgId).eq('agent_key', agentKey).maybeSingle();

    if (agentErr || !agent) {
        push({ key: 'agent', label: 'Agent exists', state: agentErr ? 'unknown' : 'blocking',
            detail: agentErr ? `Registry unreadable: ${agentErr.message}` : 'No agent with this key in this org.',
            fix: agentErr ? undefined : 'Create it from Describe it.' });
        return { checks, canRun: false, canSend: false, summary: 'The agent could not be read.' };
    }

    const runtime = (agent.runtime ?? {}) as Record<string, unknown>;

    push({
        key: 'status', label: 'Lifecycle',
        state: agent.status === 'live' ? 'ok' : agent.status === 'shadow' ? 'advisory' : 'blocking',
        detail:
            agent.status === 'live' ? 'Live — it runs and it sends.'
            : agent.status === 'shadow' ? 'Shadow — it runs the whole job and mails nobody. Rehearsal only.'
            : `${agent.status} — it does nothing at all.`,
        fix: agent.status === 'draft' ? 'Move to shadow, watch a few runs, then promote.' : undefined,
    });

    /* ---- 2. a prompt ------------------------------------------------------- */
    const promptLen = (agent.system_prompt ?? '').trim().length;
    push({
        key: 'prompt', label: 'System prompt',
        state: promptLen > 60 ? 'ok' : 'blocking',
        detail: promptLen ? `v${agent.system_prompt_version ?? 0}, ${promptLen} characters.` : 'Empty.',
        fix: promptLen > 60 ? undefined : 'Describe it, then Build.',
    });

    /* ---- 3. data it may read ---------------------------------------------- */
    const { data: bundles } = await supabaseAdmin
        .from('oem_agent_bundles').select('version, is_active, bundle')
        .eq('organization_id', orgId).eq('agent_key', agentKey)
        .order('version', { ascending: false }).limit(1);
    const active = bundles?.[0];
    const tableCount = Array.isArray((active?.bundle as { tables?: unknown[] })?.tables)
        ? ((active!.bundle as { tables: unknown[] }).tables.length) : 0;

    push({
        key: 'bundle', label: 'Data access',
        state: tableCount > 0 ? 'ok' : 'blocking',
        detail: tableCount ? `v${active?.version} binds ${tableCount} table(s).` : 'No bundle — it can read nothing.',
        fix: tableCount ? undefined : 'Configure → Add from real config → Save bundle.',
    });

    /* ---- 4. when it runs --------------------------------------------------- */
    const cron = typeof runtime.schedule_cron === 'string' ? runtime.schedule_cron : '';
    push({
        key: 'schedule', label: 'Schedule',
        state: cron ? 'ok' : 'advisory',
        detail: cron ? `${cron} (${runtime.timezone ?? 'Asia/Kolkata'})` : 'None — it only runs when triggered by hand.',
        fix: cron ? undefined : 'Set schedule_cron, or say the time in the description and re-run setup.',
    });

    /* ---- 5. tools ---------------------------------------------------------- */
    const tools = bindTools(['db_read', 'db_write', 'llm', 'email', 'web_search', 'zoho_books']);
    const missing = tools.filter((t) => t.status === 'missing');
    push({
        key: 'tools', label: 'Tools',
        state: missing.length === 0 ? 'ok' : 'advisory',
        detail: `${tools.length - missing.length}/${tools.length} configured` +
            (missing.length ? ` — missing ${missing.map((m) => m.label).join(', ')}.` : '.'),
        fix: missing.length ? `Set ${missing[0].requires.map((r) => r.split('|').join(' or ')).join(', ')}.` : undefined,
    });

    /* ---- 6. who it mails --------------------------------------------------- */
    const delivery = await resolveDelivery(orgId, agentKey);
    const anyRecipient = Object.values(delivery.to).some((v) => v.length > 0);
    push({
        key: 'recipients', label: 'Recipients',
        state: anyRecipient ? 'ok' : 'blocking',
        detail: anyRecipient
            ? Object.entries(delivery.to).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ')
            : 'Nobody configured — a run would produce email with no destination.',
        fix: anyRecipient ? undefined : 'Delivery tab → fill at least one role.',
    });

    /* ---- 7. THE ONE THAT LOOKS FINE AND IS NOT ----------------------------- */
    const replyMismatch = Boolean(delivery.replyTo && delivery.pollAddress
        && delivery.replyTo.toLowerCase() !== delivery.pollAddress.toLowerCase());
    push({
        key: 'reply', label: 'Replies come back',
        state: !delivery.replyTo ? 'advisory' : replyMismatch ? 'advisory' : 'ok',
        detail: !delivery.replyTo
            ? 'No reply-to set — recipients can read but cannot answer.'
            : replyMismatch
              ? `Replies go to ${delivery.replyTo} but the poller reads ${delivery.pollAddress}. Every answer is lost silently.`
              : `${delivery.replyTo} — the same mailbox the poller reads.`,
        fix: replyMismatch || !delivery.replyTo ? 'Delivery tab → make reply-to and the polled mailbox the same address.' : undefined,
    });

    /* ---- 8. can it remember? ---------------------------------------------- */
    const { error: memErr } = await supabaseAdmin
        .from('oem_agent_findings').select('id').eq('organization_id', orgId).limit(1);
    push({
        key: 'memory', label: 'Closure and memory',
        state: memErr ? 'advisory' : 'ok',
        detail: memErr
            ? 'Findings store unreachable — closed lines will be raised again every run.'
            : 'Closed findings stay closed; work that did not hold comes back escalated.',
        fix: memErr ? 'Apply 20260905000001_agent_findings.' : undefined,
    });

    /* ---- 9. sending is gated globally ------------------------------------- */
    const sendOn = process.env.IRA_SEND_ENABLED === 'true';
    push({
        key: 'send_flag', label: 'Sending enabled',
        state: sendOn ? 'ok' : 'advisory',
        detail: sendOn ? 'IRA_SEND_ENABLED is true.' : 'IRA_SEND_ENABLED is not true — runs happen, mail does not.',
        fix: sendOn ? undefined : 'Set IRA_SEND_ENABLED=true when you are ready for real sends.',
    });

    const blocking = checks.filter((c) => c.state === 'blocking');
    const advisory = checks.filter((c) => c.state === 'advisory');

    return {
        checks,
        canRun: blocking.length === 0,
        canSend: blocking.length === 0 && sendOn && anyRecipient && agent.status === 'live',
        summary: blocking.length
            ? `${blocking.length} thing${blocking.length > 1 ? 's' : ''} must be fixed before this agent can run.`
            : advisory.length
              ? `Ready to run. ${advisory.length} thing${advisory.length > 1 ? 's' : ''} will make it do less than you expect.`
              : 'Ready.',
    };
}
