import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Per-user dashboard layout.
 *
 *   GET  /api/dashboard/layout?org_id=&board=ops   -> { provisioned, items, ranking }
 *   PUT  /api/dashboard/layout                     -> persist the board
 *   POST /api/dashboard/layout                     -> record a widget open (usage ranking)
 *
 * A layout is private to its owner, so authentication is the only check needed — there is
 * no org-role gate here. What a user may actually SEE is enforced by each widget's own API,
 * which is the right place for it: a layout row naming a widget grants nothing.
 *
 * Every handler degrades to `provisioned: false` rather than 500 when the migration has not
 * been applied, so the board still works (falling back to browser-local storage) on an
 * environment where 20260802000004 has not run yet.
 */

export const dynamic = 'force-dynamic';

const BOARDS = new Set(['ops', 'procurement', 'property']);
const SIZES = new Set(['sm', 'md', 'lg', 'xl']);
const MAX_ITEMS = 64;

function isMissingRelation(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

async function currentUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

interface LayoutItem {
    widget_id: string;
    size: string;
    position: number;
    is_visible: boolean;
    is_pinned?: boolean;
}

/**
 * Never trust the client's blob. This is written straight to jsonb and read back into the
 * renderer, so an unvalidated write would let a compromised session store arbitrary
 * structures that every later read has to defend against.
 */
function sanitise(raw: unknown): LayoutItem[] | null {
    if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return null;
    const seen = new Set<string>();
    const out: LayoutItem[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const id = typeof e.widget_id === 'string' ? e.widget_id.slice(0, 64) : null;
        if (!id || !/^[a-z0-9_-]+$/i.test(id) || seen.has(id)) return null;
        seen.add(id);

        const size = typeof e.size === 'string' && SIZES.has(e.size) ? e.size : 'md';
        const position = Number.isFinite(e.position) ? Math.max(0, Math.min(999, Number(e.position))) : out.length;

        out.push({
            widget_id: id,
            size,
            position,
            is_visible: e.is_visible !== false,
            is_pinned: e.is_pinned === true,
        });
    }
    return out;
}

export async function GET(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const orgId = sp.get('org_id') || sp.get('organization_id');
    const board = sp.get('board') || 'ops';
    if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
    if (!BOARDS.has(board)) return NextResponse.json({ error: 'Unknown board' }, { status: 400 });

    const { data, error } = await supabaseAdmin
        .from('dashboard_widget_layouts')
        .select('items, updated_at')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .eq('board', board)
        .maybeSingle();

    if (error && !isMissingRelation(error)) {
        console.error('[dashboard layout] read', error.message);
        return NextResponse.json({ error: 'Could not load your layout' }, { status: 500 });
    }
    if (error) return NextResponse.json({ provisioned: false, items: null, ranking: [] });

    // Usage ranking, most-used first. Only ever applied to cards the user has not pinned.
    const { data: usage } = await supabaseAdmin
        .from('dashboard_widget_usage')
        .select('widget_id, opens, last_used_at')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .order('opens', { ascending: false })
        .limit(64);

    // Decay is computed here rather than in SQL so a stale plan or a missing function on an
    // older database cannot break the read path. Halves every 14 days.
    const now = Date.now();
    const ranking = (usage || [])
        .map(u => ({
            widget_id: u.widget_id,
            score: Math.max(0, u.opens) *
                Math.pow(0.5, (now - new Date(u.last_used_at).getTime()) / (14 * 86_400_000)),
        }))
        .sort((a, b) => b.score - a.score);

    return NextResponse.json({
        provisioned: true,
        items: (data?.items as LayoutItem[]) ?? null,
        updated_at: data?.updated_at ?? null,
        ranking,
    });
}

export async function PUT(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const orgId = body?.org_id || body?.organization_id;
    const board = body?.board || 'ops';
    if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
    if (!BOARDS.has(board)) return NextResponse.json({ error: 'Unknown board' }, { status: 400 });

    const items = sanitise(body?.items);
    if (!items) return NextResponse.json({ error: 'Invalid layout' }, { status: 400 });

    const { error } = await supabaseAdmin
        .from('dashboard_widget_layouts')
        .upsert({
            user_id: user.id,
            organization_id: orgId,
            board,
            items,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,organization_id,board' });

    if (error) {
        if (isMissingRelation(error)) return NextResponse.json({ provisioned: false, saved: false });
        console.error('[dashboard layout] write', error.message);
        return NextResponse.json({ error: 'Could not save your layout' }, { status: 500 });
    }
    return NextResponse.json({ provisioned: true, saved: true });
}

/** Record that a widget was opened. Fire-and-forget from the client. */
export async function POST(request: NextRequest) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null);
    const orgId = body?.org_id || body?.organization_id;
    const widgetId = typeof body?.widget_id === 'string' ? body.widget_id.slice(0, 64) : null;
    if (!orgId || !widgetId || !/^[a-z0-9_-]+$/i.test(widgetId)) {
        return NextResponse.json({ error: 'org_id and widget_id are required' }, { status: 400 });
    }

    const { data: existing, error: readErr } = await supabaseAdmin
        .from('dashboard_widget_usage')
        .select('id, opens')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .eq('widget_id', widgetId)
        .maybeSingle();

    if (readErr && isMissingRelation(readErr)) {
        return NextResponse.json({ provisioned: false });
    }

    const { error } = await supabaseAdmin
        .from('dashboard_widget_usage')
        .upsert({
            user_id: user.id,
            organization_id: orgId,
            widget_id: widgetId,
            opens: (existing?.opens ?? 0) + 1,
            last_used_at: new Date().toISOString(),
        }, { onConflict: 'user_id,organization_id,widget_id' });

    if (error && !isMissingRelation(error)) {
        // Usage tracking is best-effort. Never fail a user action over a ranking counter.
        console.error('[dashboard usage]', error.message);
    }
    return NextResponse.json({ ok: true });
}
