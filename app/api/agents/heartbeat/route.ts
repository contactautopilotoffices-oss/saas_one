import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AGENT_RUNTIME_MIGRATION, isNotProvisionedError } from '@/frontend/types/agentRuntime';
import { uptimeSeries, beatsUptimePct } from '@/backend/lib/agents/reliability';

/**
 * AGENT HEARTBEAT — liveness in, incidents out.
 *
 * POST /api/agents/heartbeat?orgId=
 *      body { agentKey, state, reason?, latency_ms?, detail?, beat_at? }
 *      or   { beats: [ {agentKey, state, ...}, ... ] }   (one scheduler tick, many agents)
 *      -> { provisioned, beats: [...], agents_updated: [...] }
 *
 * GET  /api/agents/heartbeat?orgId=&agentKey=&hours=24&buckets=60
 *      -> { provisioned, window, beats, uptime_pct, buckets, incidents, reasons, agents, current }
 *
 * WHY BOTH BUCKETS AND INCIDENTS. `buckets` is the status-page strip — 60 dots, worst state
 * wins per dot, the shape of the month at a glance. It is good at "is this agent generally
 * healthy" and useless at the actual question, which the user put plainly: "when they go
 * down, I know that when they went down and what was the reason." A wall of dots does not
 * answer that. `incidents` does: contiguous non-up beats collapsed into one row with a start,
 * an end, a duration and a cause slug, newest first.
 *
 * SILENCE IS AN INCIDENT TOO. A process that has crashed cannot POST state:'down' — it
 * simply stops beating, and a strip of green dots that just ends reads as healthy. So gaps
 * longer than 3x the agent's own heartbeat_interval_sec (oem_agents.runtime) are emitted as
 * incidents of `kind: 'silence'` with reason 'no_heartbeat'. Reported outages carry
 * `kind: 'reported'`. Colour them differently: silence means we do not know, not that we know
 * it was down.
 *
 * TENANCY. Browser callers use the RLS-scoped client (oem_select_org_member holds the line);
 * the CRON_SECRET path uses the service role because a scheduler has no session.
 *
 * NOT PROVISIONED. Degrades to { provisioned: false, beats: [] } with HTTP 200 when
 * 20260830000001_agent_runtime.sql has not been applied.
 */

export const dynamic = 'force-dynamic';

type Db = Awaited<ReturnType<typeof createClient>>;
type BeatState = 'up' | 'degraded' | 'down';

const isUnprovisioned = isNotProvisionedError;
const NOT_PROVISIONED_REASON =
    `Agent runtime is not set up yet — apply supabase/migrations/${AGENT_RUNTIME_MIGRATION}.sql.`;

const BEAT_STATES: readonly string[] = ['up', 'degraded', 'down'];

const DEFAULT_HOURS = 24;
const MAX_HOURS = 720; // 30 days — the window oem_agent_profile rolls up over
const DEFAULT_BUCKETS = 60;
const MAX_BUCKETS = 240;
/** Aggregates read this many beats; `beats` returns at most BEATS_RETURN_CAP of them. */
const BEAT_FETCH_CAP = 5000;
const BEATS_RETURN_CAP = 1000;
const MAX_BEATS_PER_POST = 100;
/** Used when the agent has no runtime.heartbeat_interval_sec configured. */
const DEFAULT_INTERVAL_SEC = 300;
/** How many missed intervals before silence becomes an incident. */
const SILENCE_FACTOR = 3;

const toInt = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : null;
};
const toText = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
};
const toIso = (v: unknown): string | null => {
    const s = toText(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const round = (n: number, dp: number) => Number(n.toFixed(dp));

function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('orgId') || sp.get('org_id') || sp.get('organization_id') ||
        (typeof body?.organization_id === 'string' ? body.organization_id : null) ||
        (typeof body?.orgId === 'string' ? body.orgId : null) ||
        null
    );
}

function isCron(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

async function resolveDb(request: NextRequest): Promise<{ db: Db; via: 'cron' | 'user' } | NextResponse> {
    if (isCron(request)) return { db: supabaseAdmin as unknown as Db, via: 'cron' };
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return { db, via: 'user' };
}

// ---------------------------------------------------------------------------
// POST — record a beat (or a whole scheduler tick)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
    try {
        let body: Record<string, unknown>;
        try {
            body = (await request.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
        }

        const resolved = await resolveDb(request);
        if (resolved instanceof NextResponse) return resolved;
        const { db } = resolved;

        const orgId = readOrgId(request, body);
        if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

        const incoming = Array.isArray(body.beats)
            ? (body.beats as Array<Record<string, unknown>>)
            : [body];
        if (!incoming.length) return NextResponse.json({ error: 'no beats supplied' }, { status: 400 });
        if (incoming.length > MAX_BEATS_PER_POST) {
            return NextResponse.json({ error: `at most ${MAX_BEATS_PER_POST} beats per call` }, { status: 400 });
        }

        const rows: Array<Record<string, unknown>> = [];
        for (const b of incoming) {
            const agentKey = toText(b.agentKey ?? b.agent_key);
            if (!agentKey) return NextResponse.json({ error: 'agentKey is required' }, { status: 400 });
            const state = toText(b.state) ?? 'up';
            if (!BEAT_STATES.includes(state)) {
                return NextResponse.json({ error: `state must be one of ${BEAT_STATES.join(', ')}` }, { status: 400 });
            }
            rows.push({
                organization_id: orgId,
                agent_key: agentKey,
                beat_at: toIso(b.beat_at) ?? new Date().toISOString(),
                state,
                // 'ok' when up and nothing was said: the reason column is what groups outages
                // by cause, and a null on a healthy beat makes that grouping lie about coverage.
                reason: toText(b.reason) ?? (state === 'up' ? 'ok' : null),
                latency_ms: toInt(b.latency_ms ?? b.latencyMs),
                detail: b.detail && typeof b.detail === 'object' ? b.detail : {},
            });
        }

        const { data, error } = await db.from('oem_agent_heartbeats').insert(rows).select('*');
        if (isUnprovisioned(error)) {
            return NextResponse.json({
                provisioned: false, migration: AGENT_RUNTIME_MIGRATION, reason: NOT_PROVISIONED_REASON,
                beats: [], agents_updated: [],
            });
        }
        // RLS refused the insert: the caller is not a member of this org. That is a 403, not
        // a server fault — a 500 here would send the console hunting for a bug that is a
        // permission.
        if (error?.code === '42501') {
            return NextResponse.json({ error: 'Forbidden: not a member of this organization' }, { status: 403 });
        }
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // trg_oem_heartbeat_apply already pushes health_state / last_heartbeat_at onto
        // oem_agents, and it does so with an ordering guard the API cannot express. This is a
        // belt-and-braces write for the case where the trigger is absent (a partially applied
        // migration); it is deliberately best-effort and never fails the beat.
        const latest = new Map<string, { state: string; beat_at: string }>();
        for (const r of rows) {
            const k = String(r.agent_key);
            const prev = latest.get(k);
            const at = String(r.beat_at);
            if (!prev || prev.beat_at <= at) latest.set(k, { state: String(r.state), beat_at: at });
        }
        const updated: string[] = [];
        await Promise.all(
            [...latest.entries()].map(async ([agentKey, v]) => {
                const { error: upErr } = await db
                    .from('oem_agents')
                    .update({ health_state: v.state, last_heartbeat_at: v.beat_at })
                    .eq('organization_id', orgId)
                    .eq('agent_key', agentKey);
                if (!upErr) updated.push(agentKey);
            }),
        );

        return NextResponse.json({ provisioned: true, beats: data ?? [], agents_updated: updated }, { status: 201 });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

// ---------------------------------------------------------------------------
// GET — uptime, the status strip, and the incident list
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
    try {
        const resolved = await resolveDb(request);
        if (resolved instanceof NextResponse) return resolved;
        const { db } = resolved;

        const orgId = readOrgId(request);
        if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

        const sp = new URL(request.url).searchParams;
        const agentKey = sp.get('agentKey') || sp.get('agent_key');
        const hours = Math.min(MAX_HOURS, Math.max(1, toInt(sp.get('hours')) ?? DEFAULT_HOURS));
        const bucketCount = Math.min(MAX_BUCKETS, Math.max(6, toInt(sp.get('buckets')) ?? DEFAULT_BUCKETS));

        const now = Date.now();
        const since = now - hours * 3600_000;

        let q = db
            .from('oem_agent_heartbeats')
            .select('agent_key, beat_at, state, reason, latency_ms')
            .eq('organization_id', orgId)
            .gte('beat_at', new Date(since).toISOString());
        if (agentKey) q = q.eq('agent_key', agentKey);
        const beatsRes = await q.order('beat_at', { ascending: false }).limit(BEAT_FETCH_CAP);

        if (isUnprovisioned(beatsRes.error)) return notProvisioned(hours, since, now);
        if (beatsRes.error) return NextResponse.json({ error: beatsRes.error.message }, { status: 500 });

        type Beat = {
            agent_key: string; beat_at: string; state: BeatState;
            reason: string | null; latency_ms: number | null;
        };
        // Fetched newest-first so a truncated window keeps the RECENT beats; everything below
        // reasons in chronological order, so flip it once here.
        const beats = ((beatsRes.data ?? []) as unknown as Beat[]).slice().reverse();
        const truncated = beats.length >= BEAT_FETCH_CAP;

        const intervals = await loadHeartbeatIntervals(db, orgId, agentKey);

        // Group by agent: contiguity across two different agents is not an outage, it is two
        // unrelated facts printed next to each other.
        const byAgent = new Map<string, Beat[]>();
        for (const b of beats) {
            const list = byAgent.get(b.agent_key);
            if (list) list.push(b);
            else byAgent.set(b.agent_key, [b]);
        }

        const incidents: Incident[] = [];
        const agents: AgentUptime[] = [];
        for (const [key, list] of byAgent) {
            const meta = intervals.get(key);
            const found = collectIncidents(key, meta?.display_name ?? key, list, meta?.interval_sec ?? DEFAULT_INTERVAL_SEC, now);
            incidents.push(...found);
            const last = list[list.length - 1];
            agents.push({
                agent_key: key,
                agent_name: meta?.display_name ?? key,
                department: meta?.department ?? null,
                beats: list.length,
                uptime_pct: beatsUptimePct(list),
                current_state: last?.state ?? 'unknown',
                current_reason: last?.reason ?? null,
                current_since: stateRunStart(list),
                last_beat_at: last?.beat_at ?? null,
                heartbeat_interval_sec: meta?.interval_sec ?? DEFAULT_INTERVAL_SEC,
                incidents: found.length,
                open_incident: found.some((i) => i.ongoing),
            });
        }

        // An agent that has been dead longer than the window files no beats at all, so the
        // loop above never sees it and the console would simply not list it — the worst
        // possible answer to "when did it go down". Anything the operator marked live or
        // shadow is EXPECTED to beat, so its silence is an open incident dated from the last
        // beat we ever had (oem_agents.last_heartbeat_at), not from the edge of the window.
        // Draft, paused and retired agents are silent on purpose and stay quiet here.
        for (const [key, meta] of intervals) {
            if (byAgent.has(key)) continue;
            if (meta.status !== 'live' && meta.status !== 'shadow') continue;
            const fromIso = meta.last_heartbeat_at ?? new Date(since).toISOString();
            incidents.push({
                agent_key: key, agent_name: meta.display_name, kind: 'silence',
                from: fromIso, to: null, state: 'unknown',
                reason: 'no_heartbeat', reasons: ['no_heartbeat'], beats: 0,
                duration_min: round(Math.max(0, now - new Date(fromIso).getTime()) / 60000, 1),
                ongoing: true,
            });
            agents.push({
                agent_key: key,
                agent_name: meta.display_name,
                department: meta.department,
                beats: 0,
                uptime_pct: null,
                current_state: 'unknown',
                current_reason: 'no_heartbeat',
                current_since: meta.last_heartbeat_at,
                last_beat_at: meta.last_heartbeat_at,
                heartbeat_interval_sec: meta.interval_sec,
                incidents: 1,
                open_incident: true,
            });
        }

        incidents.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
        agents.sort((a, b) => a.agent_key.localeCompare(b.agent_key));

        const totalUp = beats.filter((b) => b.state === 'up').length;
        const totalDegraded = beats.filter((b) => b.state === 'degraded').length;
        const totalDown = beats.filter((b) => b.state === 'down').length;

        return NextResponse.json({
            provisioned: true,
            window: {
                hours,
                from: new Date(since).toISOString(),
                to: new Date(now).toISOString(),
                bucket_count: bucketCount,
                bucket_minutes: round((hours * 60) / bucketCount, 1),
            },
            // Strict: only 'up' counts as up. Degraded is not uptime, it is a warning that was
            // acted on or ignored — the split below is there so the console can say which.
            uptime_pct: beatsUptimePct(beats),
            beats_total: beats.length,
            beats_up: totalUp,
            beats_degraded: totalDegraded,
            beats_down: totalDown,
            beats_truncated: truncated,
            buckets: uptimeSeries(beats, since, now, bucketCount),
            incidents,
            reasons: tallyReasons(incidents),
            agents,
            current: agentKey ? (agents[0] ?? null) : null,
            beats: beats.slice(-BEATS_RETURN_CAP),
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

function notProvisioned(hours: number, since: number, now: number) {
    return NextResponse.json({
        provisioned: false,
        migration: AGENT_RUNTIME_MIGRATION,
        reason: NOT_PROVISIONED_REASON,
        window: { hours, from: new Date(since).toISOString(), to: new Date(now).toISOString() },
        uptime_pct: null,
        beats_total: 0,
        buckets: [],
        incidents: [],
        reasons: [],
        agents: [],
        current: null,
        beats: [],
    });
}

interface AgentMeta {
    display_name: string;
    department: string | null;
    /** oem_agents.status — only 'live'/'shadow' agents are expected to be beating. */
    status: string | null;
    /** Cached on oem_agents by trg_oem_heartbeat_apply; may predate the window. */
    last_heartbeat_at: string | null;
    interval_sec: number;
}

interface AgentUptime {
    agent_key: string;
    agent_name: string;
    department: string | null;
    beats: number;
    uptime_pct: number | null;
    current_state: BeatState | 'unknown';
    current_reason: string | null;
    current_since: string | null;
    last_beat_at: string | null;
    heartbeat_interval_sec: number;
    incidents: number;
    open_incident: boolean;
}

interface Incident {
    agent_key: string;
    agent_name: string;
    /** 'reported' = the agent told us it was down/degraded. 'silence' = it stopped answering. */
    kind: 'reported' | 'silence';
    from: string;
    /** Recovery time; null while the incident is still open. */
    to: string | null;
    state: BeatState | 'unknown';
    reason: string | null;
    reasons: string[];
    beats: number;
    duration_min: number;
    ongoing: boolean;
}

/** Start of the contiguous run of the agent's CURRENT state — "down since 14:05". */
function stateRunStart(list: Array<{ beat_at: string; state: BeatState }>): string | null {
    if (!list.length) return null;
    const current = list[list.length - 1].state;
    let start = list[list.length - 1].beat_at;
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].state !== current) break;
        start = list[i].beat_at;
    }
    return start;
}

/**
 * Collapse a chronological beat list into incidents.
 *   reported — a contiguous run of non-'up' beats, closed by the first 'up' beat.
 *   silence  — a gap longer than SILENCE_FACTOR x the agent's heartbeat interval, including
 *              the gap between the last beat and now. A crashed agent files no beats at all,
 *              so without this the strip simply stops and the console reads it as healthy.
 */
function collectIncidents(
    agentKey: string,
    agentName: string,
    list: Array<{ beat_at: string; state: BeatState; reason: string | null }>,
    intervalSec: number,
    now: number,
): Incident[] {
    const out: Incident[] = [];
    const minutes = (fromMs: number, toMs: number) => round(Math.max(0, toMs - fromMs) / 60000, 1);

    let open: { from: string; states: BeatState[]; reasons: string[]; beats: number } | null = null;
    for (const b of list) {
        if (b.state === 'up') {
            if (open) {
                out.push(finishReported(agentKey, agentName, open, b.beat_at, now, minutes));
                open = null;
            }
            continue;
        }
        if (!open) open = { from: b.beat_at, states: [], reasons: [], beats: 0 };
        open.states.push(b.state);
        open.beats += 1;
        if (b.reason) open.reasons.push(b.reason);
    }
    if (open) out.push(finishReported(agentKey, agentName, open, null, now, minutes));

    const gapMs = Math.max(60, intervalSec * SILENCE_FACTOR) * 1000;
    for (let i = 1; i < list.length; i++) {
        const prev = new Date(list[i - 1].beat_at).getTime();
        const next = new Date(list[i].beat_at).getTime();
        if (next - prev <= gapMs) continue;
        out.push({
            agent_key: agentKey, agent_name: agentName, kind: 'silence',
            from: list[i - 1].beat_at, to: list[i].beat_at, state: 'unknown',
            reason: 'no_heartbeat', reasons: ['no_heartbeat'], beats: 0,
            duration_min: minutes(prev, next), ongoing: false,
        });
    }
    const last = list[list.length - 1];
    if (last) {
        const lastMs = new Date(last.beat_at).getTime();
        if (now - lastMs > gapMs) {
            out.push({
                agent_key: agentKey, agent_name: agentName, kind: 'silence',
                from: last.beat_at, to: null, state: 'unknown',
                reason: 'no_heartbeat', reasons: ['no_heartbeat'], beats: 0,
                duration_min: minutes(lastMs, now), ongoing: true,
            });
        }
    }
    return out;
}

function finishReported(
    agentKey: string,
    agentName: string,
    open: { from: string; states: BeatState[]; reasons: string[]; beats: number },
    recoveredAt: string | null,
    now: number,
    minutes: (a: number, b: number) => number,
): Incident {
    const fromMs = new Date(open.from).getTime();
    const toMs = recoveredAt ? new Date(recoveredAt).getTime() : now;
    // Worst state wins: an outage that flickered through 'degraded' is still an outage.
    const state: BeatState = open.states.includes('down') ? 'down' : 'degraded';
    return {
        agent_key: agentKey,
        agent_name: agentName,
        kind: 'reported',
        from: open.from,
        to: recoveredAt,
        state,
        reason: modeOf(open.reasons),
        reasons: [...new Set(open.reasons)],
        beats: open.beats,
        duration_min: minutes(fromMs, toMs),
        ongoing: !recoveredAt,
    };
}

/** The cause that dominated the outage, not merely the first one logged. */
function modeOf(values: string[]): string | null {
    if (!values.length) return null;
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Outages grouped by cause — which failure is actually costing the most availability. */
function tallyReasons(incidents: Incident[]) {
    const map = new Map<string, { reason: string; incidents: number; minutes: number; ongoing: number }>();
    for (const i of incidents) {
        const key = i.reason ?? 'unknown';
        const row = map.get(key) ?? { reason: key, incidents: 0, minutes: 0, ongoing: 0 };
        row.incidents += 1;
        row.minutes += i.duration_min;
        if (i.ongoing) row.ongoing += 1;
        map.set(key, row);
    }
    return [...map.values()]
        .map((r) => ({ ...r, minutes: round(r.minutes, 1) }))
        .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Per-agent heartbeat interval + display name. The interval is what makes silence
 * measurable, so it is read from the operator-editable oem_agents.runtime rather than
 * assumed. Falls back to a name-only read (and DEFAULT_INTERVAL_SEC) when the
 * 20260830000001 columns are not there yet.
 */
async function loadHeartbeatIntervals(
    db: Db,
    orgId: string,
    agentKey: string | null,
): Promise<Map<string, AgentMeta>> {
    type AgentRow = {
        agent_key: string; display_name: string; department: string | null; status: string | null;
        runtime?: { heartbeat_interval_sec?: unknown } | null;
        last_heartbeat_at?: string | null;
    };
    const map = new Map<string, AgentMeta>();

    const select = (columns: string) => {
        const q = db.from('oem_agents').select(columns).eq('organization_id', orgId);
        return agentKey ? q.eq('agent_key', agentKey) : q;
    };

    let rows: AgentRow[] = [];
    const primary = await select('agent_key, display_name, department, status, runtime, last_heartbeat_at');
    if (primary.error) {
        const fallback = await select('agent_key, display_name, department, status');
        if (fallback.error) return map;
        rows = (fallback.data ?? []) as unknown as AgentRow[];
    } else {
        rows = (primary.data ?? []) as unknown as AgentRow[];
    }

    for (const a of rows) {
        const configured = toInt(a.runtime?.heartbeat_interval_sec);
        map.set(a.agent_key, {
            display_name: a.display_name,
            department: a.department ?? null,
            status: a.status ?? null,
            last_heartbeat_at: a.last_heartbeat_at ?? null,
            interval_sec: configured && configured > 0 ? configured : DEFAULT_INTERVAL_SEC,
        });
    }
    return map;
}
