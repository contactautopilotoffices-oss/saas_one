'use client';

/**
 * /cc-preview/council — fixture-driven preview of the Agent Council.
 * Renders without auth (path whitelisted in proxy.ts). All data comes from
 * the recorded session in frontend/components/master-council/fixtures.ts.
 * Pane is selectable via ?pane=chamber|transcript|findings|inbox or the
 * in-app switcher.
 */

import React, { useEffect, useState } from 'react';
import CouncilChamber, { type CouncilPane } from '@/frontend/components/master-council/CouncilChamber';
import { COUNCIL_FIXTURES } from '@/frontend/components/master-council/fixtures';



const PANES: CouncilPane[] = ['brief', 'chamber', 'transcript', 'findings', 'inbox'];

export default function CouncilPreview() {
  const [pane, setPane] = useState<CouncilPane>('brief');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('pane') as CouncilPane | null;
    if (p && PANES.includes(p)) setPane(p);
  }, []);

  return <CouncilChamber key={pane} preview={COUNCIL_FIXTURES} initialPane={pane} />;
}
