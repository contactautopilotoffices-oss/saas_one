'use client';

import React from 'react';
import Row1Grid from './Row1Grid';
import PriorityActions from './PriorityActions';
import IntelligenceRow from './IntelligenceRow';
import BottomRow from './BottomRow';
import MoreAtAGlance from './MoreAtAGlance';
import AgentActivityCard, { AgentDayRollup } from './AgentActivityCard';
import { useCommandCenterData } from './useCommandCenterData';

/**
 * Command Center — the full super-admin board.
 *
 * It is the CONTENT of the dashboard's Overview tab, nothing more: no rail, no header,
 * no chrome of its own. OrgAdminDashboard keeps its sidebar, header and ?tab= URLs and
 * drops this board into <main> when the overview tab is active, so the board is a
 * redesigned overview screen rather than a second dashboard on a second set of routes.
 * That is why this returns a bare column of rows and the host supplies the padding.
 *
 * THE THREE HORIZONS
 * =============================================================================
 * A super admin reading this board is asking three different questions at once, and they
 * used to be answered in one undifferentiated stack of rows. They are now three labelled
 * bands, in the order a cricket scorecard reads:
 *
 *   BALL BY BALL        right now      what needs a decision in the next hour
 *   OVER BY OVER        today          how this shift is actually going
 *   INNINGS BY INNINGS  week / month   where the season stands
 *
 * Row 1 (Health Score, AI Brief, Portfolio) sits ABOVE all three: it is the scoreboard,
 * not a horizon — it does not change meaning depending on how far back you look.
 *
 * This is composition. Every card below is the card that already existed; the only thing
 * that changed is which band it sits in and that the band says out loud what timescale it
 * is describing. Two exceptions, both in AgentActivityCard.tsx: the agent card was
 * repointed off a hardcoded seed onto oem_agent_runs, and its shift-level sibling
 * (AgentDayRollup) was added so the agentic workforce is visible at the over-by-over
 * resolution too, not only as a live feed.
 *
 * WHERE OrgProgressCard SITS. It is rendered by MoreAtAGlance, not here — mounting it in
 * this file as well would draw the org-progress dial twice on one screen. MoreAtAGlance is
 * therefore placed in the innings band (org progress, electricity bill deadlines and
 * vendor revenue are all month-scale) rather than the shift band.
 *
 * data-org. Five cards on this board (HealthScore, AiBrief, PortfolioOverview, BottomRow,
 * AgentActivity) resolve their scope through useCommandCenterOrgId(), which reads a
 * `[data-org]` attribute off the DOM. That attribute was only ever stamped by
 * CommandCenterShell — the dark-canvas variant this dashboard does not use — so in the
 * OrgAdminDashboard path it was never present, every one of those cards sat on a
 * permanent skeleton, and the board looked dead. The board root stamps it now, from the
 * same orgId the host already passes as a prop.
 */

/** Band label + one-line subtitle. Reads on the host's white <main>, not a dark canvas. */
function BandHead({ label, sub }: { label: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '4px 2px 0' }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--cc-ink-2)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span className="text-text-tertiary" style={{ fontSize: 11.5, fontWeight: 500, minWidth: 0 }}>
        {sub}
      </span>
      <span aria-hidden style={{ flex: 1, height: 1, alignSelf: 'center', background: 'var(--cc-hairline)' }} />
    </div>
  );
}

function Band({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <BandHead label={label} sub={sub} />
      {children}
    </section>
  );
}

export default function CommandCenter({
  orgId,
  propertyId,
}: {
  /** Accepted but unused: the host header already greets the user. Kept on the props so
   *  the call site stays put if a board-level greeting comes back. */
  userName?: string;
  userEmail?: string;
  orgId: string;
  /** 'all properties' when omitted. Scopes the cards that have a per-property breakdown
   *  to look up (tickets, budget, material requests); cards that are portfolio-level by
   *  nature (Health Score, AI Brief, Portfolio Overview, Agent Activity, Org Progress)
   *  stay org-wide regardless — see useCommandCenterData for which is which. */
  propertyId?: string;
}) {
  const data = useCommandCenterData(orgId || null, propertyId || null);
  const org = orgId || null;

  return (
    <div
      // See the data-org note in the header comment: this one attribute is what lets the
      // DOM-sniffing cards on this board find their scope.
      data-org={orgId || undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 22 }}
    >
      {/* SCOREBOARD — above the horizons, because it does not belong to one. */}
      <Row1Grid />

      <Band
        label="Ball by ball"
        sub="Right now — what is on fire and which agent is moving on it"
      >
        <PriorityActions
          tickets={data.tickets} ticketsState={data.ticketsState}
          mailbox={data.mailbox} mailboxState={data.mailboxState}
          budget={data.budget} aopState={data.aopState}
          orgId={org}
        />
        <AgentActivityCard orgId={org} />
      </Band>

      <Band
        label="Over by over"
        sub="Today and this shift — how the session is actually going"
      >
        <IntelligenceRow
          mr={data.mr} mrState={data.mrState}
          po={data.po} accountsState={data.accountsState}
          orgId={org}
        />
        <AgentDayRollup orgId={org} />
      </Band>

      <Band
        label="Innings by innings"
        sub="This week and this month — where the season stands"
      >
        {/* budget was already computed here and passed to Priority Actions, but never
            handed to BottomRow — so its "Projected Overspend" fell through to the mock
            figure even on a board tagged Live. Same source, both cards, one number. */}
        <BottomRow mailRows={data.mailRows} mailboxState={data.mailboxState} budget={data.budget} />
        {/* Carries OrgProgressCard — see the header note on why it is not mounted twice. */}
        <MoreAtAGlance orgId={org} />
      </Band>
    </div>
  );
}
