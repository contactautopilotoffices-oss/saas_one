'use client';

import { Suspense } from 'react';

import CommandCenterShell from '@/frontend/components/dashboard/command-center/CommandCenterShell';
import IntelligenceRow from '@/frontend/components/dashboard/command-center/IntelligenceRow';
import BottomRow from '@/frontend/components/dashboard/command-center/BottomRow';


export default function IntelPreview() {
  return (
    <Suspense fallback={<div style={{padding:24,fontFamily:'system-ui'}}>Loading preview…</div>}>
      <CommandCenterShell userName="Saniel Golechha" userEmail="superadmin@aop.com">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <IntelligenceRow />
          <BottomRow />
        </div>
      </CommandCenterShell>
    </Suspense>
  );
}
