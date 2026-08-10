import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveMailboxAccess, isMailboxAccessError, readOrgId } from '@/backend/lib/mailbox/access';

/**
 * GET /api/procurement/mailbox/summary
 *
 * "Who is waiting on the purchase team, and how long have they been waiting."
 *
 * Reads through the service role behind resolveMailboxAccess rather than letting the
 * browser query mailbox_threads directly, so the procurement/super-admin restriction is
 * enforced in one place regardless of what the RLS policy happens to allow.
 *
 * ?from=<substring> filters to one counterparty, matching the sender AND the participant
 * list — a thread someone is on but did not send last is still theirs.
 */

export const dynamic = 'force-dynamic';

// Only these two are actionable; 'no_discovery' and 'other' are not chased.
const OPEN_CATEGORIES = ['awaiting_reply', 'unactioned_request'];

interface ThreadRow {
    id: string;
    subject: string | null;
    from_address: string | null;
    participants: string[] | null;
    last_message_at: string | null;
    category: string;
    is_resolved: boolean;
    waiting_on: string | null;
}

export async function GET(request: NextRequest) {
    const access = await resolveMailboxAccess(request, readOrgId(request));
    if (isMailboxAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const from = (sp.get('from') || '').trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '8')));

    // The digest is capped at 300 threads per org, so a single read is complete here.
    // Explicit range keeps it that way if MAX_THREADS is ever raised past PostgREST's
    // 1000-row default.
    const { data, error } = await supabaseAdmin
        .from('mailbox_threads')
        .select('id, subject, from_address, participants, last_message_at, category, is_resolved, waiting_on')
        .eq('organization_id', access.organizationId)
        .range(0, 999);

    if (error) {
        // Table absent = migration not applied yet. Report it as "not provisioned" rather
        // than a 500, so the dashboard tile can render a setup hint instead of an error.
        if (error.code === '42P01' || error.code === 'PGRST205') {
            return NextResponse.json({ provisioned: false, totals: null, people: [], oldest: [] });
        }
        console.error('[mailbox summary]', error.message);
        return NextResponse.json({ error: 'Could not load the mailbox summary' }, { status: 500 });
    }

    const all = (data || []) as ThreadRow[];
    const matches = (t: ThreadRow) => {
        if (!from) return true;
        if (t.from_address?.toLowerCase().includes(from)) return true;
        return (t.participants || []).some(p => p?.toLowerCase().includes(from));
    };

    const scoped = all.filter(matches);
    const open = scoped.filter(t => !t.is_resolved && OPEN_CATEGORIES.includes(t.category));
    const days = (iso: string | null) =>
        iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0;

    // Leaderboard: group the open queue by counterparty.
    const byPerson = new Map<string, { person: string; open: number; needs_reply: number; needs_action: number; waiting_days: number }>();
    for (const t of open) {
        const addr = (t.from_address || 'unknown').toLowerCase();
        const row = byPerson.get(addr) || { person: addr, open: 0, needs_reply: 0, needs_action: 0, waiting_days: 0 };
        row.open++;
        if (t.category === 'awaiting_reply') row.needs_reply++;
        else row.needs_action++;
        row.waiting_days = Math.max(row.waiting_days, days(t.last_message_at));
        byPerson.set(addr, row);
    }

    const people = [...byPerson.values()]
        .sort((a, b) => b.open - a.open || b.waiting_days - a.waiting_days)
        .slice(0, limit);

    // Oldest first — the queue that should actually be worked.
    const oldest = [...open]
        .sort((a, b) => new Date(a.last_message_at || 0).getTime() - new Date(b.last_message_at || 0).getTime())
        .slice(0, limit)
        .map(t => ({
            id: t.id,
            subject: t.subject,
            from_address: t.from_address,
            category: t.category,
            waiting_days: days(t.last_message_at),
        }));

    return NextResponse.json({
        provisioned: true,
        filtered_by: from || null,
        totals: {
            threads: scoped.length,
            open: open.length,
            awaiting_reply: open.filter(t => t.category === 'awaiting_reply').length,
            unactioned_request: open.filter(t => t.category === 'unactioned_request').length,
            resolved: scoped.filter(t => t.is_resolved).length,
            oldest_days: open.reduce((m, t) => Math.max(m, days(t.last_message_at)), 0),
        },
        people,
        oldest,
    });
}
