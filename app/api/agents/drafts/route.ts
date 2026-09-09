import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchema, isUuid, orgIdFrom } from '../_shared';

/**
 * /api/agents/drafts — a composition in progress, kept.
 *
 * GET    ?orgId=            this user's resumable drafts, newest first
 * GET    ?orgId=&id=        one draft in full, for resume
 * POST   ?orgId=            upsert one draft (autosaved by the composer)
 * DELETE ?orgId=&id=        discard one
 *
 * WHY THIS EXISTS
 * The composer is a one-shot form. You describe an agent, wait for a model
 * round-trip, answer its open questions — and if you close the tab or navigate
 * away, all of it is gone, with no list of work in progress and no way back.
 * See supabase/migrations/20260910000001_agent_drafts.sql for the full argument.
 *
 * THREE RULES THIS ROUTE ENFORCES
 *
 *  1. NEVER 500, AND NEVER LOSE THE TYPED WORK. Migration 20260910000001 has not
 *     been applied yet. Every handler answers 200 with { ok:true,
 *     provisioned:false } and a sentence saying drafts are not provisioned, so
 *     the composer keeps working EXACTLY as it does today — a missing migration
 *     degrades saving, it does not break the console.
 *
 *     A missing table and a failed query are still different answers, the same
 *     way registry/route.ts distinguishes them:
 *       (i)   table absent (42P01 / PGRST205 / …) -> ok:true, provisioned:false,
 *             drafts: []. A known state: nothing was ever saved.
 *       (ii)  a GENUINE failure on a table that IS there -> ok:false, an error,
 *             and `drafts: null`. `[]` there would read as "you have no saved
 *             work", which is precisely the lie this feature must not tell.
 *       (iii) the read worked and matched nothing -> `drafts: []`. An answer.
 *
 *     On POST, (i) and (ii) both mean THE SAVE DID NOT HAPPEN, and the response
 *     says so plainly (`saved:false` + a reason) so the client can keep the
 *     local copy and show the error instead of clearing its dirty flag.
 *
 *  2. AN ORG ID IN A URL IS NOT AUTHORISATION. Every handler requires a
 *     signed-in user AND an active membership in that org, resolved the way
 *     registry/route.ts resolves it. RLS would already hide the rows, but
 *     without this the endpoint still answers 200 and confirms an org's
 *     provisioning state to anyone who guesses a uuid.
 *
 *  3. A DRAFT IS ONE PERSON'S. Reads and writes are filtered to
 *     created_by = the caller, on top of the RLS write policies that enforce
 *     the same thing in the database. Two people autosaving the same row every
 *     two seconds would overwrite each other's typing with no error at all.
 *
 * AGENT DOCTRINE (docs/AGENT_DOCTRINE.md): no §3 Agent Spec Block ships with
 * this change, and that is a deliberate, stated deviation rather than a silent
 * one. This route creates and modifies no agent — it persists the operator's
 * half-finished description of one. The law that does bind here is L3
 * `[BAA pp.91-92, 94]`: a failure is returned as readable text, never thrown
 * past the runtime, because a traceback escaping into the console is
 * indistinguishable to the operator from having lost their work.
 */

export const dynamic = 'force-dynamic';

/** The migration the UI should tell the operator to run. */
const DRAFTS_MIGRATION = '20260910000001_agent_drafts';

const NOT_PROVISIONED_NOTE =
    `Drafts are not provisioned — run migration ${DRAFTS_MIGRATION}. `
    + 'The composer still works; nothing is being saved between sessions yet.';

/* ==========================================================================
 * AUTHORIZATION
 *
 * Modelled on requireOrgAdmin() in the sibling registry/route.ts — same
 * membership sources, same 403 shape — with the role check dropped. Saving your
 * own unfinished sentence is not an administrative act, and requiring an admin
 * role would mean the people who actually compose agents cannot keep their
 * work. Membership is the whole bar.
 *
 * supabaseAdmin is used ONLY to answer "who is asking". Every read and write of
 * draft data below stays on the RLS-scoped user client.
 * ========================================================================== */

/** Returns a 403 response to send, or null when the caller is a member. */
async function requireOrgMember(orgId: string, userId: string): Promise<NextResponse | null> {
    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', userId)
            .eq('is_active', true),
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id')
            .eq('user_id', userId)
            .eq('is_active', true),
    ]);

    if (profileRes.data?.is_master_admin) return null;

    const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as {
        organization_id: string | null;
    }[];
    if (memberships.some((m) => m.organization_id === orgId)) return null;

    // Same message for "wrong org" and "no such org": do not confirm that an
    // organization id exists to someone who is not in it.
    return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
}

/** Resolves the caller once for all three verbs. */
async function authorize(
    request: NextRequest,
    body?: Record<string, unknown>,
): Promise<
    | { ok: false; response: NextResponse }
    | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; orgId: string; userId: string }
> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const orgId = orgIdFrom(request, body);
    if (!isUuid(orgId)) {
        return { ok: false, response: NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 }) };
    }

    const forbidden = await requireOrgMember(orgId, user.id);
    if (forbidden) return { ok: false, response: forbidden };

    return { ok: true, supabase, orgId, userId: user.id };
}

/* ========================================================================== */
/* Shapes                                                                     */
/* ========================================================================== */

const DRAFT_STATUSES = ['describing', 'proposed', 'applied', 'abandoned'] as const;

/**
 * Everything except the id is optional: the composer autosaves partial state
 * constantly, and the FIRST save usually carries nothing but a half-typed
 * description. A schema that demanded a complete draft would reject exactly the
 * saves that matter most — the ones made before the operator has finished.
 *
 * `description` has no min length for the same reason. /api/agents/compose
 * enforces its own 12-character floor when the operator actually composes.
 */
const UpsertSchema = z.object({
    /** Client-generated, stable for the life of one composing session. */
    id: z.string().uuid().optional(),
    agent_key: z.string().trim().toLowerCase().max(63).nullish(),
    title: z.string().trim().max(160).nullish(),
    description: z.string().max(8_000).optional(),
    answers: z.record(z.string(), z.unknown()).nullish(),
    proposal: z.unknown().optional(),
    plan: z.unknown().optional(),
    status: z.enum(DRAFT_STATUSES).optional(),
});

interface DraftRow {
    id: string;
    organization_id: string;
    created_by: string;
    agent_key: string | null;
    title: string | null;
    description: string | null;
    answers: Record<string, unknown> | null;
    proposal: unknown;
    plan: unknown;
    status: string;
    created_at: string;
    updated_at: string;
}

/** The columns a list row needs. `proposal`/`plan` are omitted — they are large. */
const LIST_COLUMNS = 'id, agent_key, title, description, answers, status, created_at, updated_at';

/**
 * A list row: enough to render "what is this, when, how far through" without
 * shipping the proposal blob for every draft in the list. The full row is
 * fetched by id when the operator actually resumes one.
 */
function toListRow(row: DraftRow) {
    const description = row.description ?? '';
    const answers = row.answers ?? {};
    const answered = Object.values(answers).filter(
        (v) => typeof v === 'string' && v.trim().length > 0,
    ).length;

    return {
        id: row.id,
        agent_key: row.agent_key,
        // The list label. Falls back to the description because a draft saved
        // before the first compose() has no proposed display_name yet, and an
        // untitled row in a list of untitled rows cannot be resumed on purpose.
        title: row.title || description.slice(0, 60).trim() || 'Untitled draft',
        snippet: description.slice(0, 180).trim(),
        status: row.status,
        /** New agent or an edit of an existing one — a different diff on accept. */
        is_new_agent: !row.agent_key,
        answered_count: answered,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/* ========================================================================== */
/* GET                                                                        */
/* ========================================================================== */

export async function GET(request: NextRequest) {
    try {
        const auth = await authorize(request);
        if (!auth.ok) return auth.response;
        const { supabase, orgId, userId } = auth;

        const id = new URL(request.url).searchParams.get('id');

        /* ---- one draft, in full: the resume path ------------------------- */
        if (id) {
            if (!isUuid(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 });

            const res = await supabase
                .from('oem_agent_drafts')
                .select('*')
                .eq('organization_id', orgId)
                .eq('created_by', userId)
                .eq('id', id)
                .maybeSingle();

            if (res.error) {
                if (isMissingSchema(res.error)) {
                    return NextResponse.json({
                        ok: true,
                        provisioned: false,
                        migration: DRAFTS_MIGRATION,
                        draft: null,
                        note: NOT_PROVISIONED_NOTE,
                    });
                }
                // The table is there and the read failed. `draft: null` beside
                // ok:false means UNKNOWN, not "that draft does not exist" — the
                // caller must not delete its local copy on the strength of this.
                return NextResponse.json(
                    { ok: false, provisioned: true, draft: null, error: res.error.message },
                    { status: 200 },
                );
            }

            return NextResponse.json({ ok: true, provisioned: true, draft: res.data ?? null });
        }

        /* ---- the list ---------------------------------------------------- */
        const res = await supabase
            .from('oem_agent_drafts')
            .select(LIST_COLUMNS)
            .eq('organization_id', orgId)
            .eq('created_by', userId)
            // Terminal states are history, not work in progress. Kept in the
            // table (see the migration) but never offered as something to resume.
            .in('status', ['describing', 'proposed'])
            .order('updated_at', { ascending: false })
            .limit(50);

        if (res.error) {
            if (isMissingSchema(res.error)) {
                return NextResponse.json({
                    ok: true,
                    provisioned: false,
                    migration: DRAFTS_MIGRATION,
                    drafts: [],
                    note: NOT_PROVISIONED_NOTE,
                });
            }
            return NextResponse.json(
                {
                    ok: false,
                    provisioned: true,
                    // NOT `[]`. An empty list here would tell an operator whose
                    // read merely failed that the work they saved is gone.
                    drafts: null,
                    error: res.error.message,
                },
                { status: 200 },
            );
        }

        const rows = (res.data ?? []) as unknown as DraftRow[];
        return NextResponse.json({
            ok: true,
            provisioned: true,
            drafts: rows.map(toListRow),
        });
    } catch (e) {
        // L3 [BAA pp.91-92]: the failure comes back as readable text. A thrown
        // request here reads to the operator as lost work.
        return NextResponse.json(
            { ok: false, provisioned: null, drafts: null, error: (e as Error).message },
            { status: 200 },
        );
    }
}

/* ========================================================================== */
/* POST — upsert                                                              */
/* ========================================================================== */

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const auth = await authorize(request, body);
        if (!auth.ok) return auth.response;
        const { supabase, orgId, userId } = auth;

        const parsed = UpsertSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    ok: false,
                    saved: false,
                    error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
                },
                { status: 400 },
            );
        }
        const input = parsed.data;

        // organization_id and created_by are taken from the resolved session,
        // never from the body. A client that posts someone else's created_by is
        // writing a row it can then neither read nor update.
        const row: Record<string, unknown> = {
            organization_id: orgId,
            created_by: userId,
            updated_at: new Date().toISOString(),
        };
        if (input.id) row.id = input.id;
        if (input.agent_key !== undefined) row.agent_key = input.agent_key || null;
        if (input.title !== undefined) row.title = input.title || null;
        if (input.description !== undefined) row.description = input.description;
        if (input.answers !== undefined) row.answers = input.answers ?? {};
        if (input.proposal !== undefined) row.proposal = input.proposal ?? null;
        if (input.plan !== undefined) row.plan = input.plan ?? null;
        if (input.status !== undefined) row.status = input.status;

        // Upsert on the primary key. An id the caller does not own cannot be
        // hijacked: the RLS update policy requires created_by = auth.uid(), so
        // the write is refused rather than silently overwriting a colleague.
        const res = await supabase
            .from('oem_agent_drafts')
            .upsert(row, { onConflict: 'id' })
            .select(LIST_COLUMNS)
            .maybeSingle();

        if (res.error) {
            if (isMissingSchema(res.error)) {
                // NOT AN ERROR THE CLIENT SHOULD TREAT AS DATA LOSS, and not a
                // success either. saved:false is what stops the hook clearing
                // its dirty flag, so the typed work stays in memory.
                return NextResponse.json({
                    ok: true,
                    provisioned: false,
                    saved: false,
                    migration: DRAFTS_MIGRATION,
                    draft: null,
                    note: NOT_PROVISIONED_NOTE,
                });
            }
            return NextResponse.json(
                { ok: false, provisioned: true, saved: false, draft: null, error: res.error.message },
                { status: 200 },
            );
        }

        const saved = res.data ? toListRow(res.data as unknown as DraftRow) : null;
        return NextResponse.json({ ok: true, provisioned: true, saved: true, draft: saved });
    } catch (e) {
        return NextResponse.json(
            { ok: false, provisioned: null, saved: false, draft: null, error: (e as Error).message },
            { status: 200 },
        );
    }
}

/* ========================================================================== */
/* DELETE — discard                                                           */
/* ========================================================================== */

export async function DELETE(request: NextRequest) {
    try {
        const auth = await authorize(request);
        if (!auth.ok) return auth.response;
        const { supabase, orgId, userId } = auth;

        const id = new URL(request.url).searchParams.get('id');
        if (!isUuid(id)) return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 });

        const res = await supabase
            .from('oem_agent_drafts')
            .delete()
            .eq('organization_id', orgId)
            .eq('created_by', userId)
            .eq('id', id);

        if (res.error) {
            if (isMissingSchema(res.error)) {
                // Nothing was ever stored, so there is nothing to discard. The
                // operator's intent is satisfied; say so rather than erroring.
                return NextResponse.json({
                    ok: true,
                    provisioned: false,
                    deleted: false,
                    migration: DRAFTS_MIGRATION,
                    note: NOT_PROVISIONED_NOTE,
                });
            }
            return NextResponse.json(
                { ok: false, provisioned: true, deleted: false, error: res.error.message },
                { status: 200 },
            );
        }

        return NextResponse.json({ ok: true, provisioned: true, deleted: true, id });
    } catch (e) {
        return NextResponse.json(
            { ok: false, provisioned: null, deleted: false, error: (e as Error).message },
            { status: 200 },
        );
    }
}
