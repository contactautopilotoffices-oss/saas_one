'use client';

import React from 'react';
import CommandCenterShell from './CommandCenterShell';
import Row1Grid from './Row1Grid';
import PriorityActions from './PriorityActions';
import IntelligenceRow from './IntelligenceRow';
import BottomRow from './BottomRow';
import { useCommandCenterData } from './useCommandCenterData';

/**
 * Command Center — the full super-admin board.
 * Shell (rail + header) wraps the four rows in the mock's vertical rhythm:
 * Row 1 hero trio → Priority Actions → Intelligence 5-up → Bottom 3-up.
 * Rows keep ~14–16px gaps; .cc-main already supplies the outer padding.
 */
export default function CommandCenter({
  userName,
  userEmail,
  orgId,
}: {
  userName: string;
  userEmail: string;
  orgId: string;
}) {
  const data = useCommandCenterData(orgId || null);

  return (
    <CommandCenterShell userName={userName} userEmail={userEmail} orgId={orgId}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Row1Grid />
        <PriorityActions
          tickets={data.tickets} ticketsState={data.ticketsState}
          mailbox={data.mailbox} mailboxState={data.mailboxState}
          budget={data.budget} aopState={data.aopState}
          orgId={orgId || null}
        />
        <IntelligenceRow
          mr={data.mr} mrState={data.mrState}
          po={data.po} accountsState={data.accountsState}
          orgId={orgId || null}
        />
        <BottomRow mailRows={data.mailRows} mailboxState={data.mailboxState} />
      </div>
    </CommandCenterShell>
  );
}
