'use client';

import React from 'react';
import Link from 'next/link';
import { Zap, UserCheck, Store } from 'lucide-react';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import { buildNavMap } from './navMap';
import OrgProgressCard from './OrgProgressCard';
import SourceTag from './SourceTag';
import { CardSkeleton, CardEmpty, fetchErrorReason } from './CardStates';

/**
 * MORE AT A GLANCE — modules that already had a working org-wide endpoint but no surface
 * on this board. Each card reads one existing route and reduces it to the single figure
 * that would make someone open the module; none of them introduces a new API, a new page,
 * or a number the backend did not already compute.
 *
 *   Organization Progress   /api/org-efficiency/meter        (its own file — it carries a dial)
 *   Electricity Bills       /api/electricity/tracker         deadlines + money at risk
 *   Visitors                /api/organizations/{id}/vms-summary?period=today
 *   Vendor Revenue          /api/organizations/{id}/vendor-summary?period=month
 *
 * No card here has a mock fallback. Where a feed is missing, unprovisioned or empty, the
 * card says so. That is also why these cards carry no amber "Demo" tag: a provenance badge
 * over an empty state describes nothing, and amber specifically claims invented numbers are
 * on screen. The tag appears only when a real figure sits beside it, and then it is green.
 *
 * orgId arrives as a prop from CommandCenter rather than being sniffed off `data-org`,
 * which is why these cards cannot repeat the Row-1 race where a card rendered a fetch
 * error for a request that was never issued.
 */

const figure: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.3px',
  lineHeight: 1.15,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cc-ink)',
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--cc-ink-3)',
};

const metaVal: React.CSSProperties = {
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cc-ink-2)',
};

/** One glance tile. Same proportions as the Priority Actions cards it sits under. */
function GlanceCard({
  chipClass,
  icon,
  title,
  tag,
  children,
  footer,
}: {
  chipClass: string;
  icon: React.ReactNode;
  title: string;
  tag?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="cc-card" style={{ padding: '14px 16px' }}>
      <div className="cc-card-head" style={{ marginBottom: 10, gap: 8 }}>
        <span className={`cc-chip ${chipClass}`}>{icon}</span>
        <span className="cc-title" style={{ whiteSpace: 'nowrap' }}>{title}</span>
        <span className="cc-head-meta">{tag}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div>
      {footer ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            borderTop: '1px solid var(--cc-hairline)',
            marginTop: 12,
            paddingTop: 10,
          }}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/* ---- Electricity bills at risk -------------------------------------------------- */

interface DeadlineRow {
  site_label: string;
  money_at_risk: number;
}

interface ElecTrackerPayload {
  provisioned: boolean;
  reason?: string;
  deadlines?: {
    overdue: DeadlineRow[];
    due_soon: DeadlineRow[];
    discount_expiring: DeadlineRow[];
    money_at_risk: { discount_at_risk: number; penalty_exposure: number };
    open_value: number;
  };
}

/**
 * The tracker already computes every bucket and both exposure figures (see
 * computeDeadlines in backend/lib/electricity/tracker.ts); this card only counts the
 * buckets. "At risk" is the discount you still lose plus the penalty you still incur if
 * nothing is paid — not the open value, which is money owed either way.
 */
function ElectricityBillsCard({ orgId }: { orgId: string | null }) {
  const q = useWidgetData<ElecTrackerPayload>(
    orgId ? `/api/electricity/tracker?org_id=${orgId}` : null, 5 * 60_000);

  const loading = !orgId || q.loading;
  const d = q.data?.provisioned ? q.data.deadlines ?? null : null;
  const live = !!d;
  const href = orgId ? buildNavMap(orgId).cardLinks.viewElectricityBills : null;

  const atRisk = d ? d.money_at_risk.discount_at_risk + d.money_at_risk.penalty_exposure : 0;

  return (
    <GlanceCard
      chipClass="cc-chip--amber"
      icon={<Zap />}
      title="Bills at Risk"
      tag={!loading && live ? <SourceTag live /> : undefined}
      footer={
        d && href ? (
          <>
            <span className="cc-sub" style={{ color: 'var(--cc-ink-3)' }}>
              {inr(d.open_value, { compact: true })} open
            </span>
            <Link href={href} className="cc-btn" style={{ whiteSpace: 'nowrap' }}>
              Payment queue
            </Link>
          </>
        ) : undefined
      }
    >
      {loading ? (
        <CardSkeleton hero lines={2} />
      ) : !d ? (
        <CardEmpty
          reason={
            q.data && !q.data.provisioned
              // The route's own `reason` is a paragraph of migration instructions — right
              // for the tracker page, too long for a tile. The tracker still shows it.
              ? 'The electricity bill register is not set up for this organisation yet.'
              : fetchErrorReason(q.error)
          }
        />
      ) : (
        <>
          <div style={{ ...figure, color: atRisk > 0 ? 'var(--cc-red)' : 'var(--cc-ink)' }}>
            {inr(atRisk, { compact: true })}
          </div>
          <div className="cc-sub" style={{ marginTop: 2, marginBottom: 10, color: 'var(--cc-ink-3)' }}>
            Lost discount + penalty if unpaid
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={metaRow}>
              <span>Overdue</span>
              <span style={{ ...metaVal, color: d.overdue.length ? 'var(--cc-red)' : undefined }}>
                {d.overdue.length}
              </span>
            </div>
            <div style={metaRow}>
              <span>Due soon</span>
              <span style={metaVal}>{d.due_soon.length}</span>
            </div>
            <div style={metaRow}>
              <span>Discount closing</span>
              <span style={{ ...metaVal, color: d.discount_expiring.length ? 'var(--cc-amber)' : undefined }}>
                {d.discount_expiring.length}
              </span>
            </div>
          </div>
        </>
      )}
    </GlanceCard>
  );
}

/* ---- Visitors today ------------------------------------------------------------- */

interface VmsSummaryPayload {
  total_visitors: number;
  total_checked_in: number;
  total_checked_out: number;
  properties: Array<{ property_id: string; property_name?: string; today: number }>;
}

/**
 * period=today, so `total_visitors` is today's check-ins and `total_checked_in` is who is
 * still inside. A genuine zero is shown as 0 — the empty state is reserved for an org with
 * no properties, where the number would mean nothing at all.
 */
function VisitorsCard({ orgId }: { orgId: string | null }) {
  const q = useWidgetData<VmsSummaryPayload>(
    orgId ? `/api/organizations/${orgId}/vms-summary?period=today` : null, 5 * 60_000);

  const loading = !orgId || q.loading;
  const v = q.data && Array.isArray(q.data.properties) ? q.data : null;
  const live = !!v;
  const href = orgId ? buildNavMap(orgId).cardLinks.viewVisitors : null;
  const reporting = v ? v.properties.filter((p) => p.today > 0).length : 0;

  return (
    <GlanceCard
      chipClass="cc-chip--blue"
      icon={<UserCheck />}
      title="Visitors Today"
      tag={!loading && live ? <SourceTag live /> : undefined}
      footer={
        v && href ? (
          <>
            <span className="cc-sub" style={{ color: 'var(--cc-ink-3)' }}>
              {reporting} of {v.properties.length} sites
            </span>
            <Link href={href} className="cc-btn" style={{ whiteSpace: 'nowrap' }}>
              Visitor log
            </Link>
          </>
        ) : undefined
      }
    >
      {loading ? (
        <CardSkeleton hero lines={2} />
      ) : !v ? (
        <CardEmpty reason={fetchErrorReason(q.error)} />
      ) : v.properties.length === 0 ? (
        <CardEmpty reason="No properties in this organisation yet." />
      ) : (
        <>
          <div style={figure}>{v.total_visitors.toLocaleString('en-IN')}</div>
          <div className="cc-sub" style={{ marginTop: 2, marginBottom: 10, color: 'var(--cc-ink-3)' }}>
            Checked in since midnight
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={metaRow}>
              <span>On site now</span>
              <span style={{ ...metaVal, color: v.total_checked_in > 0 ? 'var(--cc-teal)' : undefined }}>
                {v.total_checked_in}
              </span>
            </div>
            <div style={metaRow}>
              <span>Checked out</span>
              <span style={metaVal}>{v.total_checked_out}</span>
            </div>
          </div>
        </>
      )}
    </GlanceCard>
  );
}

/* ---- Vendor revenue ------------------------------------------------------------- */

interface VendorSummaryPayload {
  total_revenue: number;
  total_commission: number;
  total_vendors: number;
  properties: Array<{ property_id: string; property_name: string; total_revenue: number }>;
}

/**
 * period=month — revenue booked since the 1st. The route already sorts `properties` by
 * revenue, so the leader is properties[0]; it is only named when it actually billed
 * something, because "top site: ₹0" is noise dressed as a ranking.
 */
function VendorRevenueCard({ orgId }: { orgId: string | null }) {
  const q = useWidgetData<VendorSummaryPayload>(
    orgId ? `/api/organizations/${orgId}/vendor-summary?period=month` : null, 5 * 60_000);

  const loading = !orgId || q.loading;
  const v = q.data && Array.isArray(q.data.properties) ? q.data : null;
  const live = !!v;
  const href = orgId ? buildNavMap(orgId).cardLinks.viewVendors : null;
  const leader = v?.properties.find((p) => p.total_revenue > 0) ?? null;

  return (
    <GlanceCard
      chipClass="cc-chip--green"
      icon={<Store />}
      title="Vendor Revenue"
      tag={!loading && live ? <SourceTag live /> : undefined}
      footer={
        v && href ? (
          <>
            <span
              className="cc-sub"
              style={{ color: 'var(--cc-ink-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {leader ? leader.property_name : 'No site has billed yet'}
            </span>
            <Link href={href} className="cc-btn" style={{ whiteSpace: 'nowrap' }}>
              Vendors
            </Link>
          </>
        ) : undefined
      }
    >
      {loading ? (
        <CardSkeleton hero lines={2} />
      ) : !v ? (
        <CardEmpty reason={fetchErrorReason(q.error)} />
      ) : v.total_vendors === 0 ? (
        <CardEmpty reason="No vendors are registered in this organisation yet." />
      ) : (
        <>
          <div style={figure}>{inr(v.total_revenue, { compact: true })}</div>
          <div className="cc-sub" style={{ marginTop: 2, marginBottom: 10, color: 'var(--cc-ink-3)' }}>
            Booked this month
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={metaRow}>
              <span>Commission</span>
              <span style={metaVal}>{inr(v.total_commission, { compact: true })}</span>
            </div>
            <div style={metaRow}>
              <span>Active vendors</span>
              <span style={metaVal}>{v.total_vendors}</span>
            </div>
          </div>
        </>
      )}
    </GlanceCard>
  );
}

/* ---- Row --------------------------------------------------------------------- */

export default function MoreAtAGlance({ orgId }: { orgId: string | null }) {
  return (
    <section>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 'var(--cc-gap, 16px)',
          alignItems: 'stretch',
        }}
      >
        {/* Two columns: it carries a dial and a five-row legend, the rest carry one figure. */}
        <OrgProgressCard orgId={orgId} />
        <ElectricityBillsCard orgId={orgId} />
        <VisitorsCard orgId={orgId} />
        <VendorRevenueCard orgId={orgId} />
      </div>
    </section>
  );
}
