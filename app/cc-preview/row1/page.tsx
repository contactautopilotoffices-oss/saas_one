'use client';

import React, { Suspense } from 'react';
import CommandCenterShell from '@/frontend/components/dashboard/command-center/CommandCenterShell';
import Row1Grid from '@/frontend/components/dashboard/command-center/Row1Grid';


export default function Row1Preview() {
  return (
    <Suspense fallback={<div style={{padding:24,fontFamily:'system-ui'}}>Loading preview…</div>}>
      <CommandCenterShell userName="Saniel Golechha" userEmail="superadmin@aop.com">
        <Row1Grid />
      </CommandCenterShell>
    </Suspense>
  );
}
