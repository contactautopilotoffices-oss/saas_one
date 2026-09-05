/**
 * POST /api/agents/plan?orgId=<uuid>   body { description, agentKey? }
 *
 * Returns the WORKFLOW PLAN for a described agent: the context it must resolve
 * first, the ordered steps, the tools each step needs (with connected/missing
 * resolved against this deployment's env), and the human roles involved.
 *
 * Distinct from /api/agents/compose, which returns identity + system prompt +
 * table bundle. This one answers "what would it do", not "who is it".
 *
 * NO DATABASE DEPENDENCY for the plan itself — composePlan() is pure. The org's
 * table list is fetched only to ground table references, and its absence
 * degrades to a plan without grounding notes rather than to an error. That is
 * deliberate: this must work while oem_agent_bundles is still unprovisioned.
 *
 * AUTH — same gate as every other /api/agents/* route: a signed-in Supabase
 * session, 401 otherwise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { composePlan, ALL_SCOPE_OPTION, type AgentPlan, type PlanSlot } from '@/backend/lib/agents/plan';
import { AGENT_TABLE_CATALOG } from '@/app/api/agents/_shared';

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * SLOT HYDRATION — turning "looked up from properties" into a real dropdown.
 *
 * composePlan() stays pure and database-free (that is what lets it work on an
 * unprovisioned schema), so the options are filled in HERE, where a client and
 * an org id already exist.
 *
 * CLOSED SET, NOT A QUERY BUILDER. `lookup` is a key into this map, never a
 * table name interpolated into a query. A slot naming a table nobody wrote a
 * resolver for simply stays a free-text box — it can never become an arbitrary
 * read of the database.
 */
const MAX_OPTIONS = 200;

const SLOT_RESOLVERS: Record<
    string,
    (db: Db, orgId: string) => Promise<string[]>
> = {
    properties: async (db, orgId) => {
        const { data, error } = await db
            .from('properties')
            .select('id, name, code')
            .eq('organization_id', orgId)
            .order('name')
            .limit(MAX_OPTIONS);
        if (error || !data) return [];
        return data.map((r) => {
            const row = r as { name?: string | null; code?: string | null };
            return row.code ? `${row.name ?? 'Unnamed'} · ${row.code}` : (row.name ?? 'Unnamed');
        });
    },
    procurement_catalog: async (db, orgId) => {
        const { data, error } = await db
            .from('procurement_catalog')
            .select('name, unit, category')
            .eq('organization_id', orgId)
            .order('name')
            .limit(MAX_OPTIONS);
        if (error || !data) return [];
        return data.map((r) => {
            const row = r as { name?: string | null; unit?: string | null };
            return row.unit ? `${row.name ?? 'Item'} (${row.unit})` : (row.name ?? 'Item');
        });
    },
};

/**
 * Fill `options` on every slot whose `lookup` has a resolver. Best-effort by
 * design: a failed lookup (missing table, RLS, empty org) leaves the slot as a
 * text input rather than failing the whole plan.
 */
async function hydrateSlots(plan: AgentPlan, db: Db, orgId: string): Promise<AgentPlan> {
    const slots: PlanSlot[] = await Promise.all(
        plan.slots.map(async (slot) => {
            if (slot.options?.length) return slot;
            const resolver = slot.lookup ? SLOT_RESOLVERS[slot.lookup] : undefined;
            if (!resolver) return slot;
            try {
                const options = await resolver(db, orgId);
                if (!options.length) return slot;
                // "All properties" is prepended, never returned by the resolver —
                // it is a scope choice, not a row, and must not look like one.
                const withAll = slot.allowAll
                    ? [`${ALL_SCOPE_OPTION} (${options.length})`, ...options]
                    : options;
                return { ...slot, options: withAll };
            } catch {
                return slot;
            }
        }),
    );

    const empty = slots.filter(
        (s) => s.lookup && SLOT_RESOLVERS[s.lookup] && !s.options?.length,
    );
    const notes = empty.length
        ? [
              ...plan.notes,
              `No rows found for ${empty.map((s) => s.lookup).join(', ')} in this org, ` +
                  'so those stay free-text. Seed the table and they become dropdowns.',
          ]
        : plan.notes;

    return { ...plan, slots, notes };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const orgId = new URL(request.url).searchParams.get('orgId');
        if (!orgId || !UUID_RE.test(orgId)) {
            return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
        }

        const body = (await request.json().catch(() => ({}))) as { description?: string };
        const description = (body.description ?? '').trim();
        if (description.length < 8) {
            return NextResponse.json(
                { error: 'Describe the task in a sentence before planning it.' },
                { status: 400 },
            );
        }

        // Grounding is best-effort. A missing catalog must not fail the plan.
        let availableTables: string[] = [];
        try {
            availableTables = AGENT_TABLE_CATALOG.map((c) => c.name);
        } catch {
            availableTables = [];
        }

        const plan = composePlan({ description, availableTables });
        const hydrated = await hydrateSlots(plan, supabase, orgId);

        return NextResponse.json({ ok: true, plan: hydrated });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
