import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { BASE_MIGRATION, isMissingSchema, isUuid, orgIdFrom, type Db } from '../_shared';

/**
 * /api/agents/prompt — EDIT THE SYSTEM PROMPT AFTER THE FACT.
 *
 * The question this route exists to answer, in the operator's own words:
 * "if I write a system prompt and want to add one more thing later — like change
 * the delivery platform from notification to mail — how will we do that?"
 *
 * Until now the honest answer was: you cannot. oem_agents.system_prompt is
 * written by composeAgent() and by foldGuidance() (backend/lib/agents/compose.ts)
 * and by nothing else. The migration comment on the column even says
 * "generated, never hand-edited" (20260825000001_org_efficiency_meter.sql:107).
 * The only path from "I changed my mind" to "the agent behaves differently" ran
 * through the LLM composer: file a correction, wait for a fold, review a whole
 * regenerated persona. For a one-line standing rule that is absurd, and for a
 * composer outage it is a dead end.
 *
 *   GET  ?orgId=&agentKey=   the running prompt, SPLIT INTO ITS TWO PARTS
 *   PUT  { agent_key, system_prompt }        save an edited prompt
 *   POST { agent_key, append }               add ONE standing rule
 *
 * WHY THE SPLIT IS THE WHOLE POINT. The column holds two things with different
 * owners and, critically, DIFFERENT READERS:
 *
 *   1. the composed persona body — the composer's, read by the console agent;
 *   2. the `== OPERATOR CORRECTIONS (standing rules) ==` block — the operator's,
 *      and the ONLY part of this column that reaches Ira's live reply voice.
 *
 * `correctionsOnly()` in backend/lib/ira/procurement/respond.ts extracts that
 * block and discards everything else, deliberately: the column is a whole
 * persona and stacking it on top of Ira's hardcoded SYSTEM would install a
 * second, competing set of style rules. So an operator who types their new rule
 * into the persona body gets a prompt that saves cleanly, versions cleanly,
 * shows a clean diff — and changes nothing about what the agent does. That is
 * the failure this route is built to make impossible to hit by accident.
 *
 * CONTRACT KEPT IN STEP WITH: correctionsOnly() in
 * backend/lib/ira/procurement/respond.ts. splitPrompt() below is its exact
 * inverse-aware twin (same header literal, same `^== ` terminator, same trim).
 * It is mirrored rather than imported because that module pulls supabaseAdmin,
 * the Zoho mail client and the council LLM in at module scope, and a prompt
 * editor has no business dragging Ira's whole runtime into a request. The
 * duplication is guarded instead: every write below is re-parsed with the same
 * rules before it is committed (see assertParseable), so a divergence surfaces
 * as a refused save, not as a rule the agent silently never sees.
 *
 * The rule block ADDS rules and can never relax the hardcoded ones —
 * respond.ts's systemFor() appends "on any conflict the rules above it win" when it
 * installs the overlay. The UI says so too.
 */

export const dynamic = 'force-dynamic';

/* ==========================================================================
 * AUTHORIZATION — same shape as the sibling app/api/agents/registry/route.ts.
 *
 * Reading needs membership; writing needs an admin role. The system prompt is
 * exactly what registry `save_prompt` gates behind REGISTRY_WRITE_ROLES, and
 * this route is a second door onto the same column — a door with a weaker lock
 * is not a feature, it is the lock removed. supabaseAdmin resolves memberships
 * ONLY; every read and write of prompt data stays on the RLS-scoped user client.
 * ========================================================================== */

const PROMPT_WRITE_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

interface Access {
    /** A member of this org (or a master admin) — may read. */
    member: boolean;
    /** Holds an admin role in this org (or is a master admin) — may write. */
    admin: boolean;
}

async function accessFor(orgId: string, userId: string): Promise<Access> {
    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
    ]);

    const isMasterAdmin = !!profileRes.data?.is_master_admin;
    const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as {
        organization_id: string | null;
        role: string | null;
    }[];
    const inOrg = memberships.filter((m) => m.organization_id === orgId);
    const roles = [...new Set(inOrg.map((m) => m.role).filter(Boolean))] as string[];

    return {
        member: isMasterAdmin || inOrg.length > 0,
        admin: isMasterAdmin || roles.some((r) => PROMPT_WRITE_ROLES.includes(r)),
    };
}

/** Same message for "wrong org" and "no such org": never confirm an org exists. */
const NO_ORG = () =>
    NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });

const NOT_ADMIN = () =>
    NextResponse.json(
        {
            error:
                'Forbidden: editing an agent’s system prompt requires an organization admin role. '
                + 'The corrections block is read by the live agent on its next run, so it is not a member-level edit.',
        },
        { status: 403 },
    );

const NOT_PROVISIONED = (what: string) =>
    NextResponse.json({
        provisioned: false,
        migration: BASE_MIGRATION,
        prompt: null,
        note: `${what} is not provisioned yet — run migration ${BASE_MIGRATION}.`,
    });

/* ==========================================================================
 * THE PARSE CONTRACT
 *
 * KEPT IN STEP WITH correctionsOnly() — backend/lib/ira/procurement/respond.ts.
 * If that function changes, this must change with it in the same commit.
 * ========================================================================== */

// Not exported: Next only permits HTTP handlers and route config as exports from route.ts.
const CORRECTIONS_HEADER = '== OPERATOR CORRECTIONS (standing rules) ==';

interface PromptParts {
    /** Everything before the corrections header. The composer's persona. */
    body: string;
    /** The corrections block, trimmed — null when there is no block. */
    corrections: string | null;
    /**
     * Anything after the block that starts a new `== ` section.
     *
     * correctionsOnly() stops at the first such line, so text living there is
     * outside the overlay and must be preserved verbatim across an edit —
     * dropping it would delete persona content the operator never saw in the
     * corrections editor.
     */
    trailing: string;
}

function splitPrompt(prompt: string): PromptParts {
    const at = prompt.indexOf(CORRECTIONS_HEADER);
    if (at < 0) return { body: prompt.trimEnd(), corrections: null, trailing: '' };

    const rest = prompt.slice(at + CORRECTIONS_HEADER.length);
    const next = rest.search(/^== /m);
    const block = (next < 0 ? rest : rest.slice(0, next)).trim();

    return {
        body: prompt.slice(0, at).trimEnd(),
        corrections: block || null,
        trailing: next < 0 ? '' : rest.slice(next).trim(),
    };
}

/** Rebuild a whole prompt from its parts, in the layout correctionsOnly() reads. */
function joinPrompt(parts: PromptParts): string {
    const out: string[] = [parts.body.trimEnd()];
    const block = (parts.corrections ?? '').trim();
    if (block) out.push('', CORRECTIONS_HEADER, block);
    if (parts.trailing.trim()) out.push('', parts.trailing.trim());
    return out.join('\n').trim();
}

/**
 * The corrections block as a rule list.
 *
 * mockFold() (compose.ts) writes `- ` bullets and merges by exact string, so
 * this route writes the same shape — otherwise a later fold would stack a
 * duplicate of a rule the operator already typed by hand.
 */
function rulesOf(block: string | null): string[] {
    if (!block) return [];
    return block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '));
}

/**
 * THE GUARD THAT MAKES THE MIRRORED CONTRACT SAFE.
 *
 * Re-parse the text we are about to commit exactly the way respond.ts will, and
 * refuse the write if the rule the operator just typed is not inside the block
 * that comes back. Without this, the failure is silent and total: the save
 * succeeds, a new version appears in the history, the diff looks right, and the
 * agent never sees the rule because the header landed somewhere the extractor
 * does not look. A refused save is a bug report; a silent one is not.
 */
function assertParseable(nextPrompt: string, mustContain?: string): string | null {
    const at = nextPrompt.indexOf(CORRECTIONS_HEADER);
    if (at < 0) {
        return mustContain
            ? 'The rebuilt prompt has no corrections header, so the agent would read no standing rules at all.'
            : null; // A prompt with no block at all is legitimate.
    }

    const rest = nextPrompt.slice(at + CORRECTIONS_HEADER.length);
    const end = rest.search(/^== /m);
    const block = (end < 0 ? rest : rest.slice(0, end)).trim();

    if (!block) {
        return 'The corrections header is present but the block under it is empty, so the agent would read no standing rules.';
    }
    if (mustContain && !block.includes(mustContain)) {
        return 'The new standing rule did not land inside the block the agent reads. Nothing was saved.';
    }
    return null;
}

/**
 * Every place a second header would cost the operator a rule.
 *
 * correctionsOnly() takes the FIRST header and stops at the next `== ` line, so
 * a prompt with two blocks silently drops the second one. Hand-editing is the
 * only way to produce that, which is why it is checked on PUT and reported to
 * the editor rather than being quietly repaired.
 */
function headerCount(prompt: string): number {
    return prompt.split(CORRECTIONS_HEADER).length - 1;
}

/* ==========================================================================
 * VERSION HISTORY — reused, not invented.
 *
 * oem_council_log ALREADY IS the prompt-version store: registry `save_prompt`
 * writes review_type 'prompt_change' with details.previous_prompt on every
 * version bump (registry/route.ts, "the archive is written AFTER the swap").
 * oem_agents holds only the current text, so that log is the only place an
 * earlier prompt exists. A new prompt_versions table would fork the history in
 * two and leave whoever needs to roll back reading half of it.
 *
 * The archive write is best-effort and NEVER blocks the edit: if the log table
 * is missing or the insert fails, the response says history_recorded:false and
 * the GET reports history:null with a reason. Refusing to let an operator fix a
 * live agent's rule because an audit table is absent would be the worse bug.
 * ========================================================================== */

type EditKind = 'manual_edit' | 'append_rule';

async function archive(
    supabase: Db,
    row: {
        organization_id: string;
        agent_key: string;
        display_name: string;
        from_version: number;
        to_version: number;
        previous_prompt: string | null;
        new_prompt: string;
        kind: EditKind;
        note: string | null;
        appended_rule: string | null;
        created_by: string;
    },
): Promise<boolean> {
    try {
        const { error } = await supabase.from('oem_council_log').insert({
            organization_id: row.organization_id,
            agent_key: row.agent_key,
            review_type: 'prompt_change',
            decision: 'approved',
            decided_by: 'human',
            summary:
                `System prompt v${row.from_version} → v${row.to_version} for '${row.display_name}' — `
                + (row.kind === 'append_rule'
                    ? `operator added a standing rule${row.appended_rule ? `: ${row.appended_rule.slice(0, 120)}` : ''}`
                    : 'edited by hand in the prompt editor')
                + (row.note ? ` — ${row.note}` : '') + '.',
            details: {
                from_version: row.from_version,
                to_version: row.to_version,
                // The whole point of the archive. oem_agents keeps only the
                // current text; this field is the only copy of the outgoing one.
                previous_prompt: row.previous_prompt,
                new_prompt_chars: row.new_prompt.length,
                source: 'prompt_editor',
                edit_kind: row.kind,
                appended_rule: row.appended_rule,
                note: row.note,
            },
            created_by: row.created_by,
        });
        return !error;
    } catch {
        return false;
    }
}

/* ==========================================================================
 * Shapes
 * ========================================================================== */

const AgentKey = z.string().trim().toLowerCase().min(1).max(63);

const PutSchema = z.object({
    agent_key: AgentKey,
    system_prompt: z.string().min(1, 'The prompt cannot be emptied from here.').max(60_000),
    note: z.string().trim().max(300).optional(),
    /**
     * The version the editor was showing. Optional, but sending it turns a lost
     * update into a 409: two admins editing the same prompt in two tabs would
     * otherwise have the second save overwrite the first with text that never
     * contained the first one's rule.
     */
    expected_version: z.number().int().min(0).optional(),
});

const PostSchema = z.object({
    agent_key: AgentKey,
    append: z
        .string()
        .trim()
        .min(4, 'A standing rule needs to say something.')
        .max(2_000, 'One rule, not a policy document — keep it to a sentence or two.'),
    note: z.string().trim().max(300).optional(),
});

function zodMessage(err: z.ZodError): string {
    return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

interface AgentPromptRow {
    display_name: string | null;
    system_prompt: string | null;
    system_prompt_version: number | null;
    status: string | null;
}

async function loadAgent(
    supabase: Db,
    orgId: string,
    agentKey: string,
): Promise<{ row: AgentPromptRow } | { response: NextResponse }> {
    const res = await supabase
        .from('oem_agents')
        .select('display_name, system_prompt, system_prompt_version, status')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .maybeSingle();

    if (res.error) {
        if (isMissingSchema(res.error)) return { response: NOT_PROVISIONED('The agent registry') };
        return { response: NextResponse.json({ error: res.error.message }, { status: 400 }) };
    }
    if (!res.data) {
        return {
            response: NextResponse.json(
                { error: `No agent '${agentKey}' in this organization.` },
                { status: 404 },
            ),
        };
    }
    return { row: res.data as AgentPromptRow };
}

/* ==========================================================================
 * GET — the prompt, split
 * ========================================================================== */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const orgId = orgIdFrom(request, undefined);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        const url = new URL(request.url);
        const agentKey = (url.searchParams.get('agentKey') ?? url.searchParams.get('agent_key') ?? '')
            .trim()
            .toLowerCase();
        if (!agentKey) return NextResponse.json({ error: 'agentKey required' }, { status: 400 });

        const access = await accessFor(orgId, user.id);
        if (!access.member) return NO_ORG();

        const loaded = await loadAgent(supabase, orgId, agentKey);
        if ('response' in loaded) return loaded.response;
        const agent = loaded.row;

        const full = agent.system_prompt ?? '';
        const parts = splitPrompt(full);

        /* ---- version history, from the log that already holds it ---------- */
        let history: Array<{
            id: string;
            created_at: string;
            summary: string;
            from_version: number | null;
            to_version: number | null;
            source: string | null;
            edit_kind: string | null;
            previous_prompt: string | null;
        }> | null = null;
        let historyError: string | null = null;

        try {
            const hist = await supabase
                .from('oem_council_log')
                .select('id, created_at, summary, details')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .eq('review_type', 'prompt_change')
                .order('created_at', { ascending: false })
                .limit(25);

            if (hist.error) {
                historyError = isMissingSchema(hist.error)
                    ? `History unavailable — oem_council_log is not provisioned (migration ${BASE_MIGRATION}). Editing still works.`
                    : `History unavailable — ${hist.error.message}. Editing still works.`;
            } else {
                history = ((hist.data ?? []) as Array<{
                    id: string;
                    created_at: string;
                    summary: string;
                    details: Record<string, unknown> | null;
                }>).map((r) => {
                    const d = r.details ?? {};
                    return {
                        id: r.id,
                        created_at: r.created_at,
                        summary: r.summary,
                        from_version: typeof d.from_version === 'number' ? d.from_version : null,
                        to_version: typeof d.to_version === 'number' ? d.to_version : null,
                        source: typeof d.source === 'string' ? d.source : null,
                        edit_kind: typeof d.edit_kind === 'string' ? d.edit_kind : null,
                        previous_prompt:
                            typeof d.previous_prompt === 'string' ? d.previous_prompt : null,
                    };
                });
            }
        } catch (e) {
            historyError = `History unavailable — ${(e as Error).message}. Editing still works.`;
        }

        return NextResponse.json({
            provisioned: true,
            agent_key: agentKey,
            display_name: agent.display_name,
            status: agent.status,
            version: agent.system_prompt_version ?? 0,
            prompt: full,
            /** The composer's half. Not read by respond.ts. */
            body: parts.body,
            /** The operator's half. THE ONLY PART THE LIVE AGENT READS. */
            corrections: parts.corrections,
            corrections_rules: rulesOf(parts.corrections),
            trailing: parts.trailing || null,
            corrections_header: CORRECTIONS_HEADER,
            /** > 1 means the second block is dead text — correctionsOnly() reads the first. */
            header_count: headerCount(full),
            can_edit: access.admin,
            history,
            history_available: history !== null,
            history_error: historyError,
            reader: {
                consumer: 'backend/lib/ira/procurement/respond.ts correctionsOnly()',
                note:
                    'Only the corrections block crosses into the live agent. The body above it is the '
                    + 'composed persona and is ignored by the runtime. Standing rules ADD to the agent’s '
                    + 'hardcoded rules; they can never relax them, and on any conflict the hardcoded rules win.',
            },
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

/* ==========================================================================
 * The one write path, shared by PUT and POST
 * ========================================================================== */

async function commit(
    supabase: Db,
    args: {
        orgId: string;
        userId: string;
        agentKey: string;
        agent: AgentPromptRow;
        nextPrompt: string;
        kind: EditKind;
        note: string | null;
        appendedRule: string | null;
    },
): Promise<NextResponse> {
    const { orgId, userId, agentKey, agent, nextPrompt, kind, note, appendedRule } = args;

    const previousPrompt = agent.system_prompt ?? null;
    const prevVersion = agent.system_prompt_version ?? 0;
    const nextVersion = prevVersion + 1;

    if ((previousPrompt ?? '') === nextPrompt) {
        return NextResponse.json({
            provisioned: true,
            unchanged: true,
            agent_key: agentKey,
            version: prevVersion,
            note: 'The text is identical to the current version — no new version created.',
        });
    }

    /**
     * Compare-and-swap on the version column, the same mechanism registry
     * save_prompt uses and for the same reason: PostgREST gives each statement
     * its own transaction, so nothing can be held across a read-then-write. If
     * a fold or another admin moved the version between our read and this
     * update, zero rows match and the caller is told to reload — rather than a
     * second prompt claiming a version number that is already taken, which
     * corrupts the archive because the log keys transitions by version.
     */
    const casRes = await (prevVersion === 0 && agent.system_prompt_version === null
        ? supabase
              .from('oem_agents')
              .update({
                  system_prompt: nextPrompt,
                  system_prompt_version: nextVersion,
                  prompt_generated_at: new Date().toISOString(),
              })
              .eq('organization_id', orgId)
              .eq('agent_key', agentKey)
              .is('system_prompt_version', null)
        : supabase
              .from('oem_agents')
              .update({
                  system_prompt: nextPrompt,
                  system_prompt_version: nextVersion,
                  prompt_generated_at: new Date().toISOString(),
              })
              .eq('organization_id', orgId)
              .eq('agent_key', agentKey)
              .eq('system_prompt_version', prevVersion)
    )
        .select('agent_key, system_prompt_version')
        .maybeSingle();

    if (casRes.error) {
        if (isMissingSchema(casRes.error)) return NOT_PROVISIONED('The agent registry');
        return NextResponse.json({ error: casRes.error.message }, { status: 400 });
    }
    if (!casRes.data) {
        return NextResponse.json(
            {
                error:
                    `The prompt for '${agentKey}' moved to a new version while you were editing. `
                    + 'Nothing was saved and no version was consumed. Reload and re-apply your change.',
                contended: true,
            },
            { status: 409 },
        );
    }

    // AFTER the swap, never before — a log entry for a save that then lost the
    // CAS would claim a version that never existed. See registry/route.ts.
    const historyRecorded = await archive(supabase, {
        organization_id: orgId,
        agent_key: agentKey,
        display_name: agent.display_name ?? agentKey,
        from_version: prevVersion,
        to_version: nextVersion,
        previous_prompt: previousPrompt,
        new_prompt: nextPrompt,
        kind,
        note,
        appended_rule: appendedRule,
        created_by: userId,
    });

    const parts = splitPrompt(nextPrompt);

    return NextResponse.json({
        provisioned: true,
        saved: true,
        agent_key: agentKey,
        version: nextVersion,
        previous_version: prevVersion,
        prompt: nextPrompt,
        body: parts.body,
        corrections: parts.corrections,
        corrections_rules: rulesOf(parts.corrections),
        header_count: headerCount(nextPrompt),
        history_recorded: historyRecorded,
        ...(historyRecorded
            ? {}
            : {
                  history_note:
                      'Saved, but the previous text could not be archived to oem_council_log — '
                      + 'this version has no rollback copy.',
              }),
        /**
         * The live agent caches the overlay for a few minutes
         * (OVERLAY_TTL_MS in respond.ts), so a rule is not instant. Said here
         * so nobody re-saves three times thinking the write did not take.
         */
        effective_note:
            'The running agent re-reads its standing rules within about five minutes '
            + '(the overlay is cached per organization and agent).',
    });
}

/* ==========================================================================
 * PUT — save an edited prompt
 * ========================================================================== */

export async function PUT(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        const access = await accessFor(orgId, user.id);
        if (!access.member) return NO_ORG();
        if (!access.admin) return NOT_ADMIN();

        const parsed = PutSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
        const { agent_key: agentKey, note, expected_version } = parsed.data;

        // Normalise line endings before anything parses this. A CRLF prompt
        // pasted from a mail client defeats the `^== ` anchor by leaving a \r on
        // the line the extractor is trying to match.
        const nextPrompt = parsed.data.system_prompt.replace(/\r\n?/g, '\n').trim();

        const loaded = await loadAgent(supabase, orgId, agentKey);
        if ('response' in loaded) return loaded.response;
        const agent = loaded.row;

        if (expected_version !== undefined && (agent.system_prompt_version ?? 0) !== expected_version) {
            return NextResponse.json(
                {
                    error:
                        `You were editing v${expected_version} but the live prompt is now `
                        + `v${agent.system_prompt_version ?? 0}. Nothing was saved — reload so you do not `
                        + 'overwrite a rule someone else just added.',
                    contended: true,
                    current_version: agent.system_prompt_version ?? 0,
                },
                { status: 409 },
            );
        }

        const problem = assertParseable(nextPrompt);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });

        const response = await commit(supabase, {
            orgId,
            userId: user.id,
            agentKey,
            agent,
            nextPrompt,
            kind: 'manual_edit',
            note: note ?? null,
            appendedRule: null,
        });

        // Not fatal, but the operator has to be told: only the first block is
        // read, so every rule in the second one is dead text.
        if (headerCount(nextPrompt) > 1) {
            const payload = (await response.json()) as Record<string, unknown>;
            return NextResponse.json(
                {
                    ...payload,
                    warning:
                        `This prompt contains ${headerCount(nextPrompt)} corrections headers. The agent reads `
                        + 'the FIRST block only and stops at the next "== " line, so the rules in the others '
                        + 'will never be applied. Merge them into one block.',
                },
                { status: response.status },
            );
        }
        return response;
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

/* ==========================================================================
 * POST — add ONE standing rule
 * ========================================================================== */

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        const access = await accessFor(orgId, user.id);
        if (!access.member) return NO_ORG();
        if (!access.admin) return NOT_ADMIN();

        const parsed = PostSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
        const { agent_key: agentKey, note } = parsed.data;

        const loaded = await loadAgent(supabase, orgId, agentKey);
        if ('response' in loaded) return loaded.response;
        const agent = loaded.row;

        const current = (agent.system_prompt ?? '').replace(/\r\n?/g, '\n');
        if (!current.trim()) {
            return NextResponse.json(
                {
                    error:
                        `'${agentKey}' has no system prompt yet, so there is nothing to add a standing rule to. `
                        + 'Compose the agent first.',
                },
                { status: 409 },
            );
        }

        /**
         * One rule, one line, `- ` prefixed — the exact shape mockFold() writes
         * and merges on (compose.ts). Newlines are collapsed because the block
         * is parsed line by line: a two-line rule reads as one rule plus one
         * orphan line that no longer starts with "- ", and the fold's dedupe
         * would then re-add the whole thing next time it ran.
         */
        const rule = `- ${parsed.data.append.replace(/^[-*•]\s*/, '').replace(/\s+/g, ' ').trim()}`;

        const parts = splitPrompt(current);
        const existing = rulesOf(parts.corrections);

        if (existing.includes(rule)) {
            return NextResponse.json({
                provisioned: true,
                unchanged: true,
                agent_key: agentKey,
                version: agent.system_prompt_version ?? 0,
                corrections_rules: existing,
                note: 'That rule is already standing — no new version created.',
            });
        }

        const nextPrompt = joinPrompt({
            body: parts.body,
            // Appended, never prepended: rules are read in order and the newest
            // correction is the operator's latest word on the subject.
            corrections: [...existing, rule].join('\n'),
            trailing: parts.trailing,
        });

        // The guard. If the rule is not inside the block respond.ts will read,
        // nothing is written at all.
        const problem = assertParseable(nextPrompt, rule);
        if (problem) return NextResponse.json({ error: problem }, { status: 500 });

        return await commit(supabase, {
            orgId,
            userId: user.id,
            agentKey,
            agent,
            nextPrompt,
            kind: 'append_rule',
            note: note ?? null,
            appendedRule: rule,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

/* ==========================================================================
 * AGENT SPEC BLOCK — doctrine §3, docs/AGENT_DOCTRINE.md.
 *
 * Required because this route changes agent BEHAVIOUR: the corrections block it
 * writes is read by the live Ira runtime on its next scan (correctionsOnly →
 * operatorOverlay → systemFor, backend/lib/ira/procurement/respond.ts). It adds
 * no new agent, but it adds a second, human, non-LLM author to an existing
 * agent's prompt, and that is a behaviour change under any reading of §5.
 *
 * ## Agent Spec — operator prompt editor (an edit surface on the Ira agent)
 *
 * **1. Workflow or agent?**  workflow
 *    Justification `[BAA p.115]`: neither (a) nor (b) — this is deliberately NOT
 *    an agent. The pathway is fully known (read column, split on a literal
 *    header, splice one line, compare-and-swap, archive), there are no edge
 *    cases a model would judge better, and L1's own finding is that an agent on
 *    a known pathway is slower and dearer for identical accuracy `[BAA p.99]`.
 *    The LLM fold (foldGuidance) remains the agentic path and is untouched; this
 *    is the deterministic one beside it. Default-to-workflow, per L1 `[BAA p.104]`.
 *    Head-to-head vs. the deterministic path `[BAA pp.94–95, 99]`:
 *      no prior path exists — before this route the column had no human writer at all.
 *
 * **2. Context** `[BAA p.112]`
 *    What this surface knows that its neighbours don't: WHICH HALF OF THE COLUMN
 *    THE RUNTIME ACTUALLY READS. compose/route.ts and registry save_prompt treat
 *    system_prompt as one opaque string; only this route (and respond.ts) knows
 *    the corrections block is the sole part that crosses into the live agent, and
 *    it is the only writer that guarantees a human's rule lands inside it.
 *
 * **3. Cost of a false positive** `[BAA p.112]`
 *    high → model tier chosen: NONE (no model call) because a rule that reaches
 *    Ira's system prompt reaches every mail she sends. Where L10 says put the
 *    expensive model at the irreversible end of a funnel, the correct choice at
 *    an end this irreversible is no model: an operator's sentence is stored
 *    verbatim, and nothing paraphrases it into something they did not write.
 *
 * **4. Tools**
 *    | tool | when-not-to-use documented? `[BAA p.107]` | errors as text? `[BAA p.94]` | args validated? `[BAA p.93]` | MCP? `[BAA p.106]` |
 *    | GET  /api/agents/prompt | yes — read-only; not the way to change behaviour | yes, JSON `{error}` | orgId uuid-gated, agentKey required | no — an HTTP route the console calls, no model is choosing it |
 *    | PUT  /api/agents/prompt | yes — not for adding one rule; use POST | yes | zod PutSchema + expected_version | no |
 *    | POST /api/agents/prompt | yes — one rule, never a policy document (2k cap) | yes | zod PostSchema | no |
 *    L9 deviation (no MCP) is named in item 10.
 *
 * **5. Prompt** `[BAA pp.105, 114]`
 *    This route does not author a prompt; it edits one. What it enforces on the
 *    text it writes: one rule per line, `- ` prefixed, imperative, collapsed to a
 *    single line — the shape mockFold() already writes, so a later LLM fold
 *    dedupes against a hand-typed rule instead of stacking a paraphrase of it.
 *    Numbered ordered steps: N/A (not a task prompt).  No-skip clause: N/A.
 *    Single-shot tone example: yes — the editor's placeholder is the worked
 *    example ("Send the daily PO scan by mail instead of an in-app notification").
 *    Terminal state written to data `[BAA p.114]`: yes — system_prompt_version is
 *    incremented and an oem_council_log 'prompt_change' row is written, so the
 *    edit is auditable from the data, not from the logs.
 *
 * **6. Memory** `[BAA pp.100–103]`
 *    Does this workload repeat? yes — an operator adds rules to the same agent
 *    over months, which is precisely the repeating-workload condition L7 requires
 *    before memory earns its cost. The corrections block IS the write-side
 *    memory, and it is human-written rather than agent-written, so the book's
 *    accuracy caveat (evidence has to accumulate before it pays) does not apply.
 *    Scope-key rejection `[BAA p.101]`: yes, and stricter than the book's — writes
 *    are scoped by (organization_id, agent_key), refused for an unknown agent
 *    (404), refused for a caller without an org admin role (403), and refused if
 *    the rebuilt text does not re-parse under correctionsOnly (assertParseable).
 *
 * **7. Multi-agent?** `[BAA p.116]`
 *    Single surface. One prompt change here cannot regress another area because
 *    the blast radius is bounded by the extractor: everything this route writes
 *    outside the corrections block is invisible to the runtime, and everything
 *    inside it is appended under the hardcoded rules, which win on conflict.
 *
 * **8. Evaluation — all four axes** `[BAA pp.118–119]`
 *    System: no model call and no external service; failure modes are the CAS
 *      losing (409, nothing written) and the archive insert failing (saved, with
 *      history_recorded:false stated in the response rather than swallowed).
 *    Quality assurance (rubric: family N/A, tier N/A, scale N/A, manual audit N/A)
 *      `[BAA pp.96–98]`: NO RUBRIC, and none is applicable — there is no generated
 *      output to grade. The equivalent correctness check is mechanical and does
 *      run on every write: the committed text is re-parsed with correctionsOnly's
 *      own rules and the save is refused unless the operator's rule comes back
 *      inside the block. That is a hard assertion, not a graded opinion.
 *    Tool interaction (expected tool set + order; measured call count)
 *      `[BAA p.95]`: N/A — no model selects anything here, so the tool-selection
 *      gap the ledger records (§2) is not widened by this change.
 *    Agent efficiency `[BAA p.119]`: 0 tokens, ₹0 per edit. The point of the
 *      change is that adding one standing rule no longer costs a composer round
 *      trip over the whole persona — the token-vs-tool trade the book warns about
 *      is resolved here by removing the tokens entirely.
 *
 * **9. Trace** `[BAA pp.119–120]`
 *    Run/step telemetry wired: N/A (no agent run) — but every write lands in
 *    oem_council_log with from_version, to_version, previous_prompt, edit_kind
 *    and created_by, which is the audit record L14 asks for and the only copy of
 *    the outgoing text that exists.
 *    Ad-hoc single-surface testing done before scale `[BAA p.116]`: yes — the
 *    parse contract was exercised against the live Ira prompt (read-only) for
 *    both the no-block and block-plus-trailing-section cases before this shipped.
 *
 * **10. Laws knowingly violated, and why:**
 *    · **L9 (MCP is the tool-transport default)** `[BAA pp.106–107]`. This is an
 *      HTTP route called by the console, not an MCP tool. No model chooses it, so
 *      the discovery and description machinery MCP exists to provide would carry
 *      no weight — and exposing "rewrite an agent's system prompt" as a tool a
 *      model could call is a self-modification surface we are not opening. The
 *      doctrine's own escape hatch ("unless there's a reason to do otherwise —
 *      write it down") is taken here, deliberately.
 *    · **L6 (rubric)** `[BAA pp.96–98]`. No grader, because nothing is generated.
 *      Named rather than left blank, per §5.3.
 *    · **The migration's own comment** on oem_agents.system_prompt — "generated,
 *      never hand-edited" (20260825000001) — is now false, and this route is why.
 *      Not silently: the contradiction is stated at the top of this file. The
 *      column comment is left alone because editing an applied migration file
 *      changes nothing in the database; correcting it belongs in the next
 *      migration that touches this table.
 * ========================================================================== */
