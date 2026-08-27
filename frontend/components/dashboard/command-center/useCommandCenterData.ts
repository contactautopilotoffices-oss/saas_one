'use client';

import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';

/**
 * Command Center data layer.
 *
 * Reuses the EXISTING widget endpoints (same URLs as frontend/components/dashboard/widgets/*,
 * so the shared useWidgetData cache dedupes with the legacy grid). Every mapper returns null
 * until the fetch lands. Unlike the old version of this file, that is NOT treated as "render
 * the mock" — every mapped value ships alongside a `*State` sibling ({ loading, error }) so
 * the consuming card can tell "still loading" apart from "loaded and genuinely empty/errored"
 * and render a skeleton or an honest message instead of ever inventing a number.
 */

/* ---------- payload shapes (copied from the widgets that own these routes) ---------- */

interface TicketsPayload {
  open_tickets: number;
  in_progress: number;
  pending_validation: number;
  sla_breached: number;
  urgent_open: number;
}

interface MailboxPayload {
  provisioned: boolean;
  totals: {
    threads: number; open: number; awaiting_reply: number;
    unactioned_request: number; resolved: number; oldest_days: number;
  } | null;
  oldest: Array<{
    id: string; subject: string | null; from_address: string | null;
    category: string; waiting_days: number;
  }>;
}

interface AccountsPayload {
  totals: { po_count: number; po_value: number };
  buckets: { to_align: { count: number; value: number }; aligned: { count: number; value: number }; completed: { count: number; value: number } };
  queue: {
    align: { total_count: number; total_value: number; critical_count: number };
    complete: { total_count: number; total_value: number };
  };
}

interface MrPayload {
  provisioned: boolean;
  totals: {
    requests: number; open: number; needs_quote: number; needs_decision: number;
    in_flight: number; closed: number; oldest_days: number; median_wait_days: number;
  } | null;
}

interface AopPayload {
  provisioned: boolean;
  current: { month: string; budget: number; actual: number; saving: number; utilisation_pct: number | null } | null;
}

/* ---------- view shapes consumed by the cards ---------- */

export interface TicketsRisk {
  /** Urgent open tickets — closest honest proxy for "at risk of breach". */
  atRisk: number;
  breached: number;
  withinSla: number;
}

export interface MailboxStats {
  total: number;
  needAction: number;
  waitingVendors: number;
  oldestDays: number;
}

export interface MailRow {
  vendor: string;
  issue: string;
  time: string;
  severity: 'High' | 'Medium' | 'Low';
  pill: 'cc-pill--high' | 'cc-pill--medium' | 'cc-pill--low';
}

export interface PoStats {
  total: number;
  awaitingApproval: number;
  awaitingVendor: number;
  pipelineValue: string;
  pipelinePct: number;
  completedThisMonth: number;
}

export interface MrStats {
  total: number;
  delayed: number;
  critical: number;
  avgWait: string;
}

export interface BudgetStats {
  utilizedPct: number;
  overspendRisk: string;
}

/** Loading/error for one underlying feed, so a card can tell "still loading" apart from
 *  "loaded, but genuinely nothing to show" — see CardStates.tsx. */
export interface QueryState {
  loading: boolean;
  error: string | null;
}

const shortAddress = (a: string | null) => (a || 'unknown').split('@')[0];

export function useCommandCenterData(orgId: string | null) {
  const ticketsQ = useWidgetData<TicketsPayload>(
    orgId ? `/api/organizations/${orgId}/tickets-summary?period=all` : null, 5 * 60_000);
  const mailboxQ = useWidgetData<MailboxPayload>(
    orgId ? `/api/procurement/mailbox/summary?org_id=${orgId}&limit=10` : null);
  const accountsQ = useWidgetData<AccountsPayload>(
    orgId ? `/api/accounts/summary?org_id=${orgId}&period=month` : null, 5 * 60_000);
  const mrQ = useWidgetData<MrPayload>(
    orgId ? `/api/organizations/${orgId}/material-requests-summary` : null, 2 * 60_000);
  const aopQ = useWidgetData<AopPayload>(
    orgId ? `/api/aop/summary?org_id=${orgId}` : null, 5 * 60_000);

  /* Tickets at Risk (PriorityActions) */
  let tickets: TicketsRisk | null = null;
  if (ticketsQ.data) {
    const d = ticketsQ.data;
    const active = d.open_tickets + d.in_progress + d.pending_validation;
    tickets = {
      atRisk: d.urgent_open,
      breached: d.sla_breached,
      withinSla: Math.max(0, active - d.sla_breached),
    };
  }

  /* Purchase Mailbox (PriorityActions) + Mail Digest (BottomRow) — one endpoint, shared cache */
  let mailbox: MailboxStats | null = null;
  let mailRows: MailRow[] | null = null;
  const mt = mailboxQ.data?.provisioned ? mailboxQ.data.totals : null;
  if (mt) {
    mailbox = {
      total: mt.threads,
      needAction: mt.unactioned_request,
      waitingVendors: mt.awaiting_reply,
      oldestDays: mt.oldest_days,
    };
    const rows = (mailboxQ.data?.oldest ?? []).slice(0, 4);
    if (rows.length) {
      mailRows = rows.map((t) => {
        const severity: MailRow['severity'] = t.waiting_days >= 14 ? 'High' : t.waiting_days >= 7 ? 'Medium' : 'Low';
        return {
          vendor: shortAddress(t.from_address),
          issue: t.subject || (t.category === 'awaiting_reply' ? 'Needs a reply' : 'Nobody acted'),
          time: t.waiting_days > 0 ? `${t.waiting_days}d waiting` : 'today',
          severity,
          pill: severity === 'High' ? 'cc-pill--high' : severity === 'Medium' ? 'cc-pill--medium' : 'cc-pill--low',
        };
      });
    }
  }

  /* Purchase Orders (IntelligenceRow) */
  let po: PoStats | null = null;
  if (accountsQ.data) {
    const d = accountsQ.data;
    const valueSum = d.buckets.to_align.value + d.buckets.aligned.value + d.buckets.completed.value;
    po = {
      total: d.totals.po_count,
      awaitingApproval: d.queue.align.total_count,
      awaitingVendor: d.queue.complete.total_count,
      pipelineValue: inr(d.totals.po_value, { compact: true }),
      pipelinePct: valueSum > 0 ? Math.round((d.buckets.completed.value / valueSum) * 100) : 0,
      completedThisMonth: d.buckets.completed.count,
    };
  }

  /* Material Requests (IntelligenceRow) */
  let mr: MrStats | null = null;
  const mrt = mrQ.data?.provisioned ? mrQ.data.totals : null;
  if (mrt) {
    mr = {
      total: mrt.requests,
      delayed: mrt.needs_quote,
      critical: mrt.needs_decision,
      avgWait: `${mrt.median_wait_days} days`,
    };
  }

  /* Budget Health (PriorityActions) + Budget vs Actual side column (BottomRow) */
  let budget: BudgetStats | null = null;
  const cur = aopQ.data?.provisioned ? aopQ.data.current : null;
  if (cur) {
    budget = {
      utilizedPct: Math.round(cur.utilisation_pct ?? 0),
      overspendRisk: inr(Math.max(0, -cur.saving), { compact: true }),
    };
  }

  return {
    tickets, ticketsState: { loading: ticketsQ.loading, error: ticketsQ.error },
    mailbox, mailRows, mailboxState: { loading: mailboxQ.loading, error: mailboxQ.error },
    po, accountsState: { loading: accountsQ.loading, error: accountsQ.error },
    mr, mrState: { loading: mrQ.loading, error: mrQ.error },
    budget, aopState: { loading: aopQ.loading, error: aopQ.error },
  };
}
