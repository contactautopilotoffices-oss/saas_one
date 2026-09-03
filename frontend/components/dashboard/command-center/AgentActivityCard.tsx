'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bot, Coins, ChevronRight, Radio, RefreshCw } from 'lucide-react';
import { useCommandCenterOrgId } from './mockData';
import { CardSkeleton, CardEmpty } from './CardStates';
import { useWidgetData, relativeTime } from '@/frontend/lib/dashboard/useWidgetData';
import {
  AGENT_MODULE_LABELS,
  AGENT_RUNTIME_MIGRATION,
  isAgentModule,
} from '@/frontend/types/agentRuntime';

/**
 * AGENT WORKFORCE — the two agent surfaces of the Command Center board.
 *
 *   <AgentActivityCard />  BALL BY BALL   the last executions, newest first.
 *   <AgentDayRollup />     OVER BY OVER   today's runs, rolled up by module.
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT WAS REPLACED
 * =============================================================================
 * The previous version read /api/agents/summary, which read backend/lib/ira/tasks.ts,
 * which returns a HARDCODED 26-row seed. The card then stamped a green "Live" tag over
 * those figures on the org head's dashboard. A fabricated number is bad; a fabricated
 * number wearing a provenance badge that says it is real is worse, because it is the one
 * a person will act on. Both components here read only oem_agent_runs / oem_agents, via:
 *
 *   /api/agents/pulse?orgId=   registry + liveness + today's counts, per agent and module
 *   /api/agents/runs?orgId=    the run log itself, newest first, for the ball-by-ball feed
 *
 * Both endpoints answer HTTP 200 { provisioned: false } until 20260830000001_agent_runtime
 * is applied, and both are cached/de-duplicated by useWidgetData — the two components on
 * this board asking for the same pulse URL share one request.
 *
 * THE EMPTY STATE IS THE POINT. An agent runtime with no rows yet says
 * "No agent runs recorded yet" and shows no counts at all. There is no seed, no fallback
 * and no demo path in this file: the only thing either card can render is live data or an
 * admission that there is none.
 *
 * THE HEADER BADGE DESCRIBES THIS FETCH, NOT THIS FILE  (defect #9)
 * =============================================================================
 * The badge used to be `<SourceTag live />` with `live` hardcoded true, on the reasoning
 * that a file with no mock path can only ever be showing live data. That reasoning is
 * wrong in exactly the two cases that matter. `provisioned: false` and a failed fetch both
 * render an empty body — and both still wore a green "Live" dot, so the org head saw a
 * card that had loaded nothing while being told its contents were current. A green badge
 * over an empty card is a stronger claim than a number: it says "the workforce did nothing"
 * when the truth was "we could not ask".
 *
 * So the badge is now derived from the payload in hand, and green is reachable from one
 * branch only — `runs.length > 0`, i.e. rows actually came back in THIS fetch:
 *
 *   rows returned          Live             green
 *   provisioned, 0 rows    No runs yet      muted
 *   provisioned: false     Not provisioned  muted  + the migration named in the body
 *   fetch failed           Couldn't load    amber  + the status code and a Retry button
 *
 * The freshness stamp is bound to the same rule: an errored or unprovisioned card shows no
 * "synced 2m ago", because a timestamp beside data that never arrived dates the failure and
 * reads as the data.
 */

/* ==========================================================================
 * Shapes — mirror app/api/agents/pulse and app/api/agents/runs.
 * Kept beside the reader (the convention IntelligenceRow set); change together.
 * ========================================================================== */

export interface PulseAgent {
  agent_key: string;
  display_name: string;
  department: string | null;
  status: string;
  module: string;
  health_state: string;
  heartbeat_stale: boolean;
  last_run_at: string | null;
  last_outcome: string | null;
  last_status: string | null;
  runs_today: number;
  runs_window: number;
  failures_today: number;
  coins_balance: number;
}

export interface PulseModule {
  module: string;
  label: string;
  agent_count: number;
  runs_today: number;
  runs_window: number;
  failures_today: number;
  last_activity_at: string | null;
  needs_attention: boolean;
}

export interface AgentPulsePayload {
  provisioned: boolean;
  reason?: string;
  migration?: string;
  agents?: PulseAgent[];
  modules?: Record<string, PulseModule>;
  runs_today?: number;
  last_activity_at?: string | null;
  totals?: {
    agents: number;
    live_agents: number;
    runs_today: number;
    failures_today: number;
    modules_with_movement: number;
    needs_attention: string[];
    last_activity_at: string | null;
  };
}

export interface AgentRunRow {
  id: string;
  started_at: string;
  agent_key: string;
  agent_name?: string;
  module: string | null;
  trigger: string | null;
  status: string;
  outcome_summary: string | null;
  error: string | null;
  duration_ms: number | null;
  steps_count?: number;
}

export interface AgentRunsPayload {
  provisioned: boolean;
  reason?: string;
  runs?: AgentRunRow[];
}

/* ==========================================================================
 * Scale + tone. Local copies of the Priority Actions figure scale — those
 * consts are module-local there, and these cards sit at the same weight.
 * ========================================================================== */

const figure: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: '-0.3px',
  lineHeight: 1.15,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cc-ink)',
};

const statLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--cc-ink-3)',
  lineHeight: 1.3,
};

/** Run outcome → colour. Only three outcomes carry a colour; the rest stay ink. */
const RUN_TONE: Record<string, string> = {
  running: 'var(--cc-blue)',
  succeeded: 'var(--cc-green)',
  failed: 'var(--cc-red)',
  timeout: 'var(--cc-red)',
  skipped: 'var(--cc-ink-3)',
};

const RUN_LABEL: Record<string, string> = {
  running: 'running',
  succeeded: 'ok',
  failed: 'failed',
  timeout: 'timed out',
  skipped: 'skipped',
};

/** Rows shown in the ball-by-ball feed before it starts scrolling into "+N more". */
const FEED_ROWS = 6;
/** Module chips shown in the over-by-over roll-up. */
const ROLLUP_CHIPS = 8;

const NOT_PROVISIONED = `Agent runtime is not set up yet — run migration ${AGENT_RUNTIME_MIGRATION}.`;

function moduleLabel(module: string | null | undefined): string {
  if (!module) return 'Unassigned';
  if (isAgentModule(module)) return AGENT_MODULE_LABELS[module];
  return module.replace(/_/g, ' ');
}

/** ISO timestamp → "4m ago". relativeTime() in useWidgetData takes epoch ms; run rows
 *  carry ISO strings, so this is the string-shaped sibling rather than a second clock. */
function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function duration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

/**
 * The one line a run gets. `outcome_summary` is what the agent said it did; `error` is
 * what stopped it. A failed run with neither is reported as such rather than as a blank —
 * a silent row in an execution log reads as a successful one.
 */
function runLine(r: AgentRunRow): string {
  if (r.outcome_summary) return r.outcome_summary;
  if (r.error) return r.error;
  if (r.status === 'running') return 'Working…';
  if (r.status === 'failed' || r.status === 'timeout') return 'Failed without an outcome line';
  return 'Completed with no outcome recorded';
}

/* ==========================================================================
 * Provenance — the four states a card can actually be in, and the badge for each
 * ========================================================================== */

/** What the last fetch produced. `loading` is a fifth state with no badge at all. */
export type CardDataState = 'loading' | 'live' | 'empty' | 'unprovisioned' | 'error';

/**
 * Badge presentation per state.
 *
 * INK vs DOT. The dot carries the raw severity hue; the label does not. globals.css
 * measures --cc-green at 2.5:1 and --cc-amber at 2.07:1 on this card surface — fine for a
 * 6px dot (non-text), a fail for an 8.5px uppercase label. So each label uses the same
 * hue driven toward --cc-ink until it clears AA, the construction --council-p1-ink already
 * uses (those tokens are scoped to the council surface, hence the inline color-mix):
 *   green 55% + ink   #177961   5.36:1 on white, 4.73:1 on the card glass
 *   amber 44% + ink   #7d5d20   5.46:1 / 4.96:1  (the value globals.css documents)
 *   muted --cc-ink-2  #5b6b73   4.98:1
 */
const STATE_TAG: Record<
  Exclude<CardDataState, 'loading'>,
  { label: string; dot: string; ink: string; title: string }
> = {
  live: {
    label: 'Live',
    dot: 'var(--cc-green)',
    ink: 'color-mix(in srgb, var(--cc-green) 55%, var(--cc-ink))',
    title: 'Rows came back from oem_agent_runs in this fetch.',
  },
  empty: {
    label: 'No runs yet',
    dot: 'var(--cc-ink-3)',
    ink: 'var(--cc-ink-2)',
    title: 'The agent runtime answered, and it has no rows to show yet.',
  },
  unprovisioned: {
    label: 'Not provisioned',
    dot: 'var(--cc-ink-3)',
    ink: 'var(--cc-ink-2)',
    title: `The agent runtime tables do not exist yet — migration ${AGENT_RUNTIME_MIGRATION} has not been applied.`,
  },
  error: {
    label: "Couldn't load",
    dot: 'var(--cc-amber)',
    ink: 'color-mix(in srgb, var(--cc-amber) 44%, var(--cc-ink))',
    title: 'This card’s request failed. Nothing shown here is current.',
  },
};

/** Header provenance tag. Replaces SourceTag on these two cards: SourceTag only knows
 *  "live or demo", and three of the four states here are neither. */
function DataStateTag({
  state,
  label,
}: {
  state: Exclude<CardDataState, 'loading'>;
  label?: string;
}) {
  const t = STATE_TAG[state];
  return (
    <span
      title={t.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: t.ink,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className="cc-dot"
        style={{ ['--cc-dot-c' as string]: t.dot, background: t.dot, width: 6, height: 6, boxShadow: 'none', flex: 'none' }}
      />
      {label ?? t.label}
    </span>
  );
}

/**
 * Fetch-failure body. Distinct from CardEmpty on purpose: CardEmpty's headline is
 * "No data", which on a failed request is a claim about the organization rather than
 * about the request. This one says the request failed, quotes what came back, and offers
 * the retry — the state is recoverable and the card should say so.
 */
function CardFetchError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div
      role="status"
      style={{
        flex: 1,
        minHeight: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        textAlign: 'center',
        padding: '16px 10px',
        borderRadius: 10,
        border: '1px dashed color-mix(in srgb, var(--cc-amber) 40%, transparent)',
        background: 'color-mix(in srgb, var(--cc-amber) 5%, transparent)',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: 'color-mix(in srgb, var(--cc-amber) 44%, var(--cc-ink))' }}>
        Couldn&apos;t load
      </span>
      <span className="cc-sub" style={{ maxWidth: 250 }}>{reason}</span>
      <button type="button" onClick={onRetry} className="cc-btn-ghost" style={{ marginTop: 6, padding: '5px 12px', fontSize: 10.5 }}>
        <RefreshCw />
        Retry
      </button>
    </div>
  );
}

/**
 * Failure copy. useWidgetData stores `HTTP <status>` / `forbidden` / the network message,
 * so the status code reaches the user rather than being flattened into "something went
 * wrong" — a 403 and a 500 are different problems with different next steps.
 */
function errorReason(error: string | null, subject: string): string {
  if (error === 'forbidden') return `You don’t have access to ${subject}.`;
  if (error) return `${subject} could not be loaded (${error}).`;
  return `${subject} returned no payload.`;
}

/* ==========================================================================
 * Shared chrome
 * ========================================================================== */

function CountCell({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...figure, color: tone ?? figure.color }}>{value}</div>
      <div style={statLabel}>{label}</div>
    </div>
  );
}

/** Deep link into the console tab of OrgAdminDashboard. Same tab, same URL, no new route. */
function useOpenConsole() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (agentKey?: string) => {
      const base = pathname || '';
      const agent = agentKey ? `&agent=${encodeURIComponent(agentKey)}` : '';
      router.push(`${base}?tab=agent_console${agent}`);
    },
    [router, pathname],
  );
}

function ConsoleButton({ onClick, label = 'Open agent console' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="cc-btn-ghost" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', padding: '6px 12px', fontSize: 10.5 }}>
      {label}
      <ChevronRight />
    </button>
  );
}

/* ==========================================================================
 * BALL BY BALL — Agent Activity
 * ========================================================================== */

function FeedRow({ run, onOpen }: { run: AgentRunRow; onOpen: (k: string) => void }) {
  const tone = RUN_TONE[run.status] ?? 'var(--cc-ink-3)';
  const live = run.status === 'running';
  const dur = duration(run.duration_ms);

  return (
    <button
      type="button"
      onClick={() => onOpen(run.agent_key)}
      className="cc-listrow"
      style={{ padding: '7px 0', gap: 8, width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--cc-hairline)', textAlign: 'left', cursor: 'pointer' }}
      title={`${run.agent_name || run.agent_key} · ${RUN_LABEL[run.status] ?? run.status}`}
    >
      <span
        className={`cc-dot${live ? ' animate-pulse motion-reduce:animate-none' : ''}`}
        style={{ ['--cc-dot-c' as string]: tone, background: tone, boxShadow: live ? `0 0 0 3px color-mix(in srgb, ${tone} 18%, transparent)` : 'none' }}
      />
      <span className="cc-listrow-main">
        <span className="cc-listrow-name" style={{ display: 'block' }}>{runLine(run)}</span>
        <span className="cc-listrow-sub" style={{ display: 'block' }}>
          {run.agent_name || run.agent_key} · {moduleLabel(run.module)}
          {run.trigger ? ` · ${run.trigger}` : ''}
          {dur ? ` · ${dur}` : ''}
        </span>
      </span>
      <span className="cc-listrow-right" style={{ fontSize: 10, fontWeight: 600, color: live ? tone : 'var(--cc-ink-3)' }}>
        {live ? 'running' : ago(run.started_at)}
      </span>
    </button>
  );
}

export default function AgentActivityCard({ orgId: orgIdProp }: { orgId?: string | null } = {}) {
  // The prop is the truth when the host has it; the DOM sniff is the fallback for a mount
  // that predates CommandCenter passing it down.
  const sniffed = useCommandCenterOrgId();
  const orgId = orgIdProp || sniffed || null;
  const openConsole = useOpenConsole();

  const pulseQ = useWidgetData<AgentPulsePayload>(
    orgId ? `/api/agents/pulse?orgId=${orgId}` : null, 60_000);
  const runsQ = useWidgetData<AgentRunsPayload>(
    orgId ? `/api/agents/runs?orgId=${orgId}&limit=12` : null, 60_000);

  const pulse = pulseQ.data;
  const runsPayload = runsQ.data;
  const agents = useMemo(() => pulse?.agents ?? [], [pulse]);
  const runs = useMemo(() => runsQ.data?.runs ?? [], [runsQ.data]);

  // orgId resolves asynchronously in the host, so "scope not known yet" is loading —
  // not an empty card, and never a fetch error for a request that was never issued.
  const loading = !orgId || pulseQ.loading || runsQ.loading;

  const retry = useCallback(() => { pulseQ.refresh(); runsQ.refresh(); }, [pulseQ, runsQ]);

  /**
   * The one place the card's provenance is decided. Every branch below is reachable, and
   * `live` is reachable ONLY with rows in hand — that is the whole fix for defect #9.
   * The two requests are judged separately so a working pulse is never described by a
   * broken run log, or the reverse.
   */
  const state: CardDataState =
    loading ? 'loading'
      : pulseQ.error || runsQ.error ? 'error'
      : !pulse || !runsPayload ? 'error'
      : pulse.provisioned === false || runsPayload.provisioned === false ? 'unprovisioned'
      : runs.length > 0 ? 'live'
      : 'empty';

  // Which request to name in the failure copy — the pulse first, since a dead pulse means
  // the counts are missing too and it is the more complete failure.
  const errorText =
    pulseQ.error || !pulse
      ? errorReason(pulseQ.error, 'The agent pulse')
      : errorReason(runsQ.error, 'The agent run log');

  const totals = pulse?.totals;
  const coins = agents.reduce((n, a) => n + (a.coins_balance || 0), 0);
  const shown = runs.slice(0, FEED_ROWS);
  const anyRunning = runs.some((r) => r.status === 'running');

  const body = (() => {
    if (state === 'loading') return <CardSkeleton hero lines={1} rows={3} />;
    if (state === 'error') return <CardFetchError reason={errorText} onRetry={retry} />;
    if (state === 'unprovisioned') {
      return <CardEmpty reason={pulse?.reason || runsPayload?.reason || NOT_PROVISIONED} />;
    }
    if (agents.length === 0) {
      return <CardEmpty reason="No agentic employees are registered for this organization yet. Compose one in the Agent Console." />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
            paddingBottom: 12,
            borderBottom: '1px solid var(--cc-hairline)',
          }}
        >
          <CountCell label="Agents live" value={totals?.live_agents ?? 0} tone={(totals?.live_agents ?? 0) > 0 ? 'var(--cc-green)' : undefined} />
          <CountCell label="Runs today" value={totals?.runs_today ?? 0} />
          <CountCell label="Failed today" value={totals?.failures_today ?? 0} tone={(totals?.failures_today ?? 0) > 0 ? 'var(--cc-red)' : undefined} />
          <CountCell label="Modules moved" value={totals?.modules_with_movement ?? 0} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 2px' }}>
          <Radio size={12} strokeWidth={2.2} color={anyRunning ? 'var(--cc-blue)' : 'var(--cc-ink-3)'} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--cc-ink-2)' }}>
            Last executions
          </span>
          <span className="cc-sub" style={{ fontSize: 10, color: 'var(--cc-ink-3)' }}>newest first</span>
        </div>

        {shown.length === 0 ? (
          // The honest state the old card could not reach: the runtime is provisioned,
          // agents exist, and none of them has executed. No counts, no seed, no "Live".
          <div className="cc-sub" style={{ padding: '10px 0' }}>
            No agent runs recorded yet. {agents.length} agent{agents.length === 1 ? '' : 's'} registered
            {' '}— they will appear here the first time one executes.
          </div>
        ) : (
          <div>
            {shown.map((r) => (
              <FeedRow key={r.id} run={r} onOpen={openConsole} />
            ))}
            {runs.length > shown.length ? (
              <div className="cc-sub" style={{ paddingTop: 8, color: 'var(--cc-ink-3)' }}>
                +{runs.length - shown.length} more in the run log
              </div>
            ) : null}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 'auto',
            paddingTop: 12,
            borderTop: '1px solid var(--cc-hairline)',
          }}
        >
          <span className="cc-sub" style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--cc-ink-3)' }}>
            <Coins size={11} strokeWidth={2.2} />
            {coins.toLocaleString('en-IN')} Autopilot coins across the workforce
          </span>
          <ConsoleButton onClick={() => openConsole()} />
        </div>
      </div>
    );
  })();

  return (
    <section className="cc-card">
      <div className="cc-card-head">
        <span className="cc-chip cc-chip--purple">
          <Bot />
        </span>
        <span className="cc-title">Agent Activity</span>
        <span className="cc-head-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {state !== 'loading' && <DataStateTag state={state} />}
          {/* The stamp belongs only to states where something actually arrived. Beside
              "Couldn't load" it would be dating the failure while reading as the data. */}
          {(state === 'live' || state === 'empty') && pulseQ.fetchedAt
            ? relativeTime(pulseQ.fetchedAt)
            : null}
        </span>
      </div>
      {body}
    </section>
  );
}

/* ==========================================================================
 * OVER BY OVER — today's runs, by module
 * ========================================================================== */

function ModuleChip({ m, onOpen }: { m: PulseModule; onOpen: () => void }) {
  const tone = m.needs_attention ? 'var(--cc-amber)' : m.runs_today > 0 ? 'var(--cc-green)' : 'var(--cc-ink-3)';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${m.agent_count} agent${m.agent_count === 1 ? '' : 's'} · ${m.runs_window} runs in the last 7 days · last movement ${ago(m.last_activity_at)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid var(--cc-hairline)',
        background: 'transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <span className="cc-dot" style={{ ['--cc-dot-c' as string]: tone, background: tone, boxShadow: 'none' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cc-ink-2)', whiteSpace: 'nowrap' }}>{m.label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cc-ink)', fontVariantNumeric: 'tabular-nums' }}>{m.runs_today}</span>
      {m.failures_today > 0 ? (
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cc-red)' }}>{m.failures_today} failed</span>
      ) : null}
    </button>
  );
}

/**
 * The shift view. Same pulse payload as the card above (useWidgetData de-duplicates the
 * request), read at a different resolution: not which run happened last, but which parts
 * of the business the workforce actually touched today.
 */
export function AgentDayRollup({ orgId: orgIdProp }: { orgId?: string | null } = {}) {
  const sniffed = useCommandCenterOrgId();
  const orgId = orgIdProp || sniffed || null;
  const openConsole = useOpenConsole();

  const q = useWidgetData<AgentPulsePayload>(orgId ? `/api/agents/pulse?orgId=${orgId}` : null, 60_000);
  const pulse = q.data;
  const loading = !orgId || q.loading;

  const modules = useMemo(() => {
    const all = Object.values(pulse?.modules ?? {});
    // Loudest first: attention, then movement, then name. A module that needs a look must
    // not fall below one that merely ran a lot.
    return all.sort((a, b) =>
      Number(b.needs_attention) - Number(a.needs_attention) ||
      b.runs_today - a.runs_today ||
      a.label.localeCompare(b.label),
    );
  }, [pulse]);

  const totals = pulse?.totals;
  const moved = modules.filter((m) => m.runs_today > 0);

  // Same rule as the card above: green only with real registry rows in hand. The
  // roll-up's rows are the modules the pulse returned, so an empty registry is `empty`,
  // a missing table is `unprovisioned`, and a failed request is never either of those.
  const state: CardDataState =
    loading ? 'loading'
      : q.error || !pulse ? 'error'
      : pulse.provisioned === false ? 'unprovisioned'
      : modules.length > 0 ? 'live'
      : 'empty';

  const body = (() => {
    if (state === 'loading') return <CardSkeleton hero lines={2} />;
    if (state === 'error') {
      return <CardFetchError reason={errorReason(q.error, 'The agent pulse')} onRetry={q.refresh} />;
    }
    if (state === 'unprovisioned') return <CardEmpty reason={pulse?.reason || NOT_PROVISIONED} />;
    if (modules.length === 0) {
      return <CardEmpty reason="No agentic employees are registered for this organization yet." />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <CountCell label="Runs today" value={totals?.runs_today ?? 0} />
          <CountCell label="Modules moved" value={moved.length} tone={moved.length > 0 ? 'var(--cc-green)' : undefined} />
          <CountCell
            label="Need a look"
            value={totals?.needs_attention?.length ?? 0}
            tone={(totals?.needs_attention?.length ?? 0) > 0 ? 'var(--cc-amber)' : undefined}
          />
        </div>

        {totals?.runs_today === 0 ? (
          <div className="cc-sub">
            No agent runs recorded yet today. The workforce is registered but has not executed
            this shift.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {modules.slice(0, ROLLUP_CHIPS).map((m) => (
              <ModuleChip key={m.module} m={m} onOpen={() => openConsole()} />
            ))}
            {modules.length > ROLLUP_CHIPS ? (
              <span className="cc-sub" style={{ alignSelf: 'center' }}>+{modules.length - ROLLUP_CHIPS} more</span>
            ) : null}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--cc-hairline)' }}>
          <span className="cc-sub" style={{ minWidth: 0, color: 'var(--cc-ink-3)' }}>
            Last movement {ago(totals?.last_activity_at ?? pulse?.last_activity_at)}
          </span>
          <ConsoleButton onClick={() => openConsole()} label="Configure agents" />
        </div>
      </div>
    );
  })();

  return (
    <section className="cc-card">
      <div className="cc-card-head">
        <span className="cc-chip cc-chip--teal">
          <Bot />
        </span>
        <span className="cc-title">Agent Workforce Today</span>
        <span className="cc-head-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {state !== 'loading' && <DataStateTag state={state} />}
          {/* Stamp only where data actually arrived — beside "Couldn't load" it
              would date the failure while reading as the data. */}
          {(state === 'live' || state === 'empty') && q.fetchedAt ? relativeTime(q.fetchedAt) : null}
        </span>
      </div>
      {body}
    </section>
  );
}
