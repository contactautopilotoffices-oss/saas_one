import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_MODULE_DESCRIPTORS,
    BASE_MIGRATION,
    RUNTIME_MIGRATION,
    catalogEntry,
    discoverOrgTables,
    isDeniedTable,
    isMissingSchema,
    isUuid,
    orgIdFrom,
    type DiscoveredTable,
} from '../_shared';

/**
 * /api/agents/bundles — the containment list, and its history.
 *
 * A bundle is the ONLY set of tables an agent may touch. It is versioned and
 * append-only: saving never edits a version, it creates the next one. The old
 * versions stay readable so an operator can see exactly what an agent was
 * allowed to see on the day it did something.
 *
 * GET  ?orgId=&agentKey=   full version history, newest first, is_active flagged
 * GET  ?orgId=&discover=1  BUILD FROM REAL CONFIG — the tables this org actually
 *                          has data in, grouped by module, with suggested access
 * POST ?orgId=             { agentKey, tables[], notes } -> next version
 *
 * SECURITY: the deny list is enforced on the WRITE path, not only on the list
 * the UI renders. A hand-crafted POST naming oem_agent_credentials, anything
 * matching /credential|secret|token|key|password|session/, or any table in the
 * auth / storage / vault schemas is refused. Discovery can only ever surface a
 * table someone deliberately curated.
 *
 * AUTHORIZATION: reading is open to any member of the org. WRITING is not. The
 * bundle IS the containment boundary — it decides which tables an autonomous
 * agent may read and which it may write — so a rank-and-file member must not be
 * able to hand an agent write access to payments. POST requires an organization
 * admin role, resolved exactly the way app/api/agents/credentials/route.ts
 * resolves it. See BUNDLE_WRITE_ROLES below.
 *
 * CONCURRENCY: see the proof block in POST. The invariant is that this agent has
 * exactly one active bundle at every instant and never zero, because an agent
 * with no active bundle has no data access at all.
 */

export const dynamic = 'force-dynamic';

/* ==========================================================================
 * AUTHORIZATION
 *
 * Copied from the sibling app/api/agents/credentials/route.ts (same role set,
 * same membership sources, same 403 shapes) rather than invented here, so the
 * whole /api/agents surface answers one question one way. The duplication
 * between this file and registry/route.ts is deliberate for now — the natural
 * home is ../_shared.ts, which is out of scope for this change.
 *
 * supabaseAdmin is used ONLY to resolve the caller's memberships. Every read
 * and write of bundle data below stays on the RLS-scoped user client, so this
 * does not widen the data path — it only answers "who is asking".
 * ========================================================================== */

/** Roles that may CHANGE a bundle. Reading a bundle needs only membership. */
const BUNDLE_WRITE_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

/** Returns a 403 response to send, or null when the caller may write. */
async function requireOrgAdmin(orgId: string, userId: string): Promise<NextResponse | null> {
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

    if (!isMasterAdmin && inOrg.length === 0) {
        // Same message for "wrong org" and "no such org": do not confirm that an
        // organization id exists to someone who is not in it.
        return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    }

    const roles = [...new Set(inOrg.map((m) => m.role).filter(Boolean))] as string[];
    if (!isMasterAdmin && !roles.some((r) => BUNDLE_WRITE_ROLES.includes(r))) {
        return NextResponse.json(
            {
                error:
                    'Forbidden: changing an agent data bundle requires an organization admin role. ' +
                    'The bundle decides which tables this agent may read and write, so it is not a member-level edit.',
            },
            { status: 403 }
        );
    }

    return null;
}

/* ========================================================================== */
/* GET                                                                        */
/* ========================================================================== */

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        const agentKey = searchParams.get('agentKey');
        const discover = searchParams.get('discover');

        if (!isUuid(orgId)) {
            return NextResponse.json(
                { provisioned: false, error: 'orgId (uuid) required', versions: [], tables: [] },
                { status: 400 }
            );
        }

        const supabase = await createClient();

        // Same guard POST uses, and that every sibling GET under /api/agents uses.
        // Without it `?discover=1` hands an anonymous caller the whole curated
        // table catalog WITH live row estimates for the organization.
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        if (discover === '1' || discover === 'true') {
            return discoverResponse(supabase, orgId, searchParams.get('counts') !== '0');
        }

        if (!agentKey) {
            return NextResponse.json(
                {
                    provisioned: false,
                    error: "Pass either agentKey (version history) or discover=1 (available tables).",
                    versions: [],
                },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from('oem_agent_bundles')
            .select('id, agent_key, version, is_active, bundle, notes, created_by, created_at')
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .order('version', { ascending: false });

        if (error) {
            if (isMissingSchema(error)) {
                return NextResponse.json({
                    provisioned: false,
                    migration: BASE_MIGRATION,
                    missing: ['oem_agent_bundles'],
                    agent_key: agentKey,
                    versions: [],
                    active_version: null,
                    note: `Bundle store not provisioned yet — run migration ${BASE_MIGRATION}.`,
                });
            }
            return NextResponse.json({ provisioned: true, error: error.message, versions: [] });
        }

        type BundleRow = {
            version: number;
            is_active: boolean;
            bundle: { tables?: Array<{ name: string; access?: string }>; notes?: string } | null;
            created_at: string;
        };
        const rows = (data ?? []) as unknown as BundleRow[];

        const versions = rows.map((r) => {
            const tables = Array.isArray(r.bundle?.tables) ? r.bundle!.tables! : [];
            return {
                ...r,
                table_count: tables.length,
                table_names: tables.map((t) => t.name),
                write_count: tables.filter((t) => t.access === 'write').length,
            };
        });

        // The diff between consecutive versions is what an operator actually
        // reads — "v3 added electricity_disputes, dropped stock_movements".
        const diffs = versions.map((v, i) => {
            const prev = versions[i + 1];
            if (!prev) return { version: v.version, added: v.table_names, removed: [] as string[] };
            const prevSet = new Set(prev.table_names);
            const curSet = new Set(v.table_names);
            return {
                version: v.version,
                added: v.table_names.filter((n) => !prevSet.has(n)),
                removed: prev.table_names.filter((n) => !curSet.has(n)),
            };
        });

        return NextResponse.json({
            provisioned: true,
            agent_key: agentKey,
            versions,
            diffs,
            active_version: versions.find((v) => v.is_active)?.version ?? null,
        });
    } catch (e) {
        return NextResponse.json({ provisioned: false, error: (e as Error).message, versions: [], tables: [] });
    }
}

/* -------------------------------------------------------------------------- */
/* discover — "Generate the bundle this organization already has"             */
/* -------------------------------------------------------------------------- */

type Db = Awaited<ReturnType<typeof createClient>>;

async function discoverResponse(supabase: Db, orgId: string, withCounts: boolean) {
    let tables: DiscoveredTable[] = [];
    try {
        tables = await discoverOrgTables(supabase, orgId, { counts: withCounts });
    } catch {
        tables = [];
    }

    const byDomain = AGENT_MODULE_DESCRIPTORS.map((m) => {
        const inDomain = tables.filter((t) => t.domain === m.key);
        const live = inDomain.filter((t) => t.has_data);
        return {
            ...m,
            table_count: inDomain.length,
            populated_count: live.length,
            rows_estimate: inDomain.reduce((s, t) => s + (t.rows_estimate ?? 0), 0),
            tables: inDomain.map((t) => t.name),
            /** What "add this whole module" would bundle. */
            suggested_tables: live.map((t) => ({
                name: t.name,
                access: t.suggested_access,
                purpose: t.purpose,
            })),
        };
    }).filter((d) => d.table_count > 0);

    return NextResponse.json({
        provisioned: tables.length > 0,
        counts_included: withCounts,
        migration: RUNTIME_MIGRATION,
        // The exact shape the spec asks for, plus the context the UI needs.
        tables: tables.map((t) => ({
            name: t.name,
            domain: t.domain,
            rows_estimate: t.rows_estimate,
            suggested_access: t.suggested_access,
            org_scoped: t.org_scoped,
            has_data: t.has_data,
            purpose: t.purpose,
        })),
        modules: byDomain,
        summary: {
            tables_present: tables.length,
            tables_with_data: tables.filter((t) => t.has_data).length,
            modules_present: byDomain.length,
        },
        note:
            tables.length === 0
                ? 'No catalogued FMS tables were reachable for this organization. Either the schema is not provisioned or row-level security is hiding it from this account.'
                : undefined,
    });
}

/* ========================================================================== */
/* POST — save the next bundle version                                        */
/* ========================================================================== */

const TableInput = z.union([
    z.string().trim().toLowerCase().min(1).max(63),
    z.object({
        name: z.string().trim().toLowerCase().min(1).max(63),
        access: z.enum(['read', 'write']).optional(),
        columns: z.array(z.string().trim().max(63)).max(200).optional(),
        purpose: z.string().trim().max(400).optional(),
    }),
]);

const SaveBundleSchema = z.object({
    agentKey: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, 'agentKey must be lowercase letters, digits, _ or -'),
    tables: z.array(TableInput).max(120),
    notes: z.string().trim().max(2_000).nullish(),
});

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        // Accept agent_key as well as agentKey — the rest of the codebase uses snake_case.
        if (body.agent_key && !body.agentKey) body.agentKey = body.agent_key;

        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        // Authorization before validation: a member who may not rewrite this
        // agent's containment list should not learn, from the shape of the 400,
        // which tables the catalogue knows about.
        const forbidden = await requireOrgAdmin(orgId, user.id);
        if (forbidden) return forbidden;

        const parsed = SaveBundleSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
                { status: 400 }
            );
        }
        const { agentKey, notes } = parsed.data;

        // ---- normalise, dedupe, and apply the hard deny on the WRITE path.
        const seen = new Set<string>();
        const normalised: Array<{ name: string; access: 'read' | 'write'; columns?: string[]; purpose?: string }> = [];
        const denied: string[] = [];
        const uncatalogued: string[] = [];

        for (const raw of parsed.data.tables) {
            const entry = typeof raw === 'string' ? { name: raw } : raw;
            const name = entry.name.trim().toLowerCase();
            if (!name || seen.has(name)) continue;
            seen.add(name);

            if (isDeniedTable(name)) {
                denied.push(name);
                continue;
            }

            const cat = catalogEntry(name);
            if (!cat) uncatalogued.push(name);

            normalised.push({
                name,
                access: (entry as { access?: 'read' | 'write' }).access ?? cat?.suggested_access ?? 'read',
                ...((entry as { columns?: string[] }).columns?.length
                    ? { columns: (entry as { columns?: string[] }).columns }
                    : {}),
                ...(( entry as { purpose?: string }).purpose || cat?.purpose
                    ? { purpose: (entry as { purpose?: string }).purpose ?? cat?.purpose }
                    : {}),
            });
        }

        if (denied.length) {
            return NextResponse.json(
                {
                    error:
                        `Refused: [${denied.join(', ')}] may never be placed in an agent bundle. ` +
                        `Credential, secret, token, key, password and session stores, and the auth / storage / vault schemas, ` +
                        `are denied at the API regardless of who asks.`,
                    denied,
                },
                { status: 400 }
            );
        }

        // A table nobody curated is allowed only if it genuinely exists — this
        // stops a typo becoming a permanently broken bundle.
        const unknownMissing: string[] = [];
        for (const name of uncatalogued) {
            try {
                const probe = await supabase.from(name).select('*', { head: true, count: 'estimated' }).limit(1);
                if (probe.error && isMissingSchema(probe.error) && probe.error.code !== '42703') {
                    unknownMissing.push(name);
                }
            } catch {
                unknownMissing.push(name);
            }
        }
        if (unknownMissing.length) {
            return NextResponse.json(
                {
                    error: `These tables are not in the FMS catalogue and do not exist in the database: ${unknownMissing.join(', ')}.`,
                    missing_tables: unknownMissing,
                },
                { status: 400 }
            );
        }

        const bundle = {
            tables: normalised,
            ...(notes ? { notes } : {}),
        };

        /* ==================================================================
         * ATOMICITY — INVARIANT: at every instant this agent has at least one
         * active bundle, and once all in-flight saves settle, exactly one.
         * Zero active bundles is unreachable. An agent with no active bundle
         * has no data access at all, so zero is the failure that matters.
         *
         * WHAT THE SERIALIZATION POINT IS. There is no transaction to hold
         * here: PostgREST runs each statement below as its own transaction, so
         * SELECT ... FOR UPDATE and pg_advisory_xact_lock would both release
         * before the next statement ran, and a lock that does not span the
         * sequence protects nothing. The real serialization point is the
         * constraint the schema already carries:
         *
         *     UNIQUE (organization_id, agent_key, version)
         *       -- supabase/migrations/20260825000001_org_efficiency_meter.sql
         *
         * Exactly one writer can own a given version number. Losing the race is
         * a 23505, which is a claim failure, not an error: re-read the head and
         * claim again. Because no lock is held across statements, this route
         * cannot deadlock against registry/route.ts (which uses a single-
         * statement compare-and-swap for the same reason). Nothing waits on
         * anything, so there is no lock order to get wrong.
         *
         * TWO RULES MAKE THE INVARIANT HOLD:
         *   1. INSERT the new version already active, THEN retire old ones.
         *      Deactivating first opens a window with zero active bundles.
         *   2. Retire only versions STRICTLY BELOW the one just claimed (`lt`),
         *      never "every version except mine" (`neq`). Rule 2 is the actual
         *      bug fix; rule 1 was already here and was not sufficient alone.
         *
         * PROOF — two interleaved requests A and B on the same agent, head=v1.
         *
         *   The old code (neq) loses the agent's data access entirely:
         *     A: insert v2 active                    active = {v1, v2}
         *     B: insert v3 active                    active = {v1, v2, v3}
         *     A: deactivate where version != 2       active = {v2}      <- kills v3
         *     B: deactivate where version != 3       active = {}        <- ZERO
         *   Both saves reported success; the agent can now read nothing.
         *
         *   This code (lt), same interleaving:
         *     A: insert v2 active                    active = {v1, v2}
         *     B: insert v3 active                    active = {v1, v2, v3}
         *     A: deactivate where version < 2        active = {v2, v3}
         *     B: deactivate where version < 3        active = {v3}      <- exactly one
         *   Reordering the two deactivates changes nothing:
         *     B: deactivate where version < 3        active = {v3}
         *     A: deactivate where version < 2        active = {v3}      (no-op)
         *
         * GENERAL ARGUMENT (any number of concurrent savers):
         *   Let M be the highest version row that exists at some instant t. M is
         *   active at t. Suppose not: some request R retired it, and R only
         *   retires versions strictly below its own v_R, so v_R > M. But R
         *   inserts v_R before it deactivates anything, so row v_R existed at t
         *   and M was not the highest. Contradiction. So the highest existing
         *   version is always active => the active set is never empty.
         *   And a request only ever claims a version above every version it
         *   observed, so once every in-flight save has run its deactivate, only
         *   the highest version remains active => exactly one.
         *   The transient extra is a version that is about to be retired by a
         *   strictly newer one; readers order by version DESC, so they see the
         *   newest. That window is over-permissive by one superseded bundle for
         *   a few milliseconds, never under-permissive, and never empty.
         * ================================================================== */
        const MAX_CLAIM_ATTEMPTS = 6;
        let nextVersion = 0;
        let insertedRow: Record<string, unknown> | null = null;
        let claimContentions = 0;

        for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS && !insertedRow; attempt++) {
            const headRes = await supabase
                .from('oem_agent_bundles')
                .select('version')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (headRes.error && isMissingSchema(headRes.error)) {
                return NextResponse.json({
                    provisioned: false,
                    migration: BASE_MIGRATION,
                    missing: ['oem_agent_bundles'],
                    bundle: null,
                    note: `Bundle store not provisioned yet — run migration ${BASE_MIGRATION}.`,
                });
            }

            nextVersion = ((headRes.data as { version?: number } | null)?.version ?? 0) + 1;

            const attemptRes = await supabase
                .from('oem_agent_bundles')
                .insert({
                    organization_id: orgId,
                    agent_key: agentKey,
                    version: nextVersion,
                    is_active: true,
                    bundle,
                    created_by: user.id,
                })
                .select()
                .single();

            if (!attemptRes.error) {
                insertedRow = attemptRes.data as Record<string, unknown>;
                break;
            }

            // 23505 — a concurrent save owns this version number. Re-read the
            // head and claim the next one. Nothing has been written by us yet,
            // so retrying is safe and leaves no partial state behind.
            if (attemptRes.error.code === '23505') {
                claimContentions += 1;
                continue;
            }

            if (isMissingSchema(attemptRes.error)) {
                return NextResponse.json({
                    provisioned: false,
                    migration: BASE_MIGRATION,
                    missing: ['oem_agent_bundles'],
                    bundle: null,
                });
            }
            return NextResponse.json({ error: attemptRes.error.message }, { status: 400 });
        }

        if (!insertedRow) {
            // Every attempt lost the claim. Nothing was inserted and nothing was
            // deactivated, so the agent still has whatever active bundle it had.
            return NextResponse.json(
                {
                    error:
                        `Could not claim a bundle version for '${agentKey}' after ${MAX_CLAIM_ATTEMPTS} attempts — ` +
                        `too many saves landed at once. Nothing was changed; the agent still has its previous ` +
                        `active bundle. Reload the version history and save again.`,
                    contended: true,
                },
                { status: 409 }
            );
        }

        // Rule 2. `lt`, never `neq`: this can only ever retire a bundle that has
        // already been superseded by the version this request just activated.
        const deactivated = await supabase
            .from('oem_agent_bundles')
            .update({ is_active: false })
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .lt('version', nextVersion)
            .eq('is_active', true)
            .select('version');

        // ---- governance
        let logged = false;
        try {
            const { error: logErr } = await supabase.from('oem_council_log').insert({
                organization_id: orgId,
                agent_key: agentKey,
                review_type: 'bundle_change',
                summary:
                    `Data bundle v${nextVersion} activated: ` +
                    (normalised.length
                        ? `${normalised.length} table(s) — ${normalised.map((t) => `${t.name}[${t.access}]`).join(', ')}`
                        : 'empty (agent may read nothing)') +
                    '.',
                decision: 'approved',
                decided_by: 'human',
                details: {
                    version: nextVersion,
                    table_count: normalised.length,
                    write_tables: normalised.filter((t) => t.access === 'write').map((t) => t.name),
                    deactivated_versions: (deactivated.data ?? []).map((d: { version: number }) => d.version),
                    uncatalogued,
                },
                created_by: user.id,
            });
            logged = !logErr;
        } catch {
            logged = false;
        }

        return NextResponse.json(
            {
                provisioned: true,
                bundle: insertedRow,
                version: nextVersion,
                deactivated_versions: (deactivated.data ?? []).map((d: { version: number }) => d.version),
                table_count: normalised.length,
                uncatalogued,
                logged,
                claim_contentions: claimContentions,
                note: 'Saving always creates the next version. Earlier versions are untouched and remain readable; the new version starts active.',
            },
            { status: 201 }
        );
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}
