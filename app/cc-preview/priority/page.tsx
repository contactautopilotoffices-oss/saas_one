'use client';

import { Suspense } from 'react';

import CommandCenterShell from '@/frontend/components/dashboard/command-center/CommandCenterShell';
import PriorityActions from '@/frontend/components/dashboard/command-center/PriorityActions';


export default function PriorityPreview() {
  return (
    <Suspense fallback={<div style={{padding:24,fontFamily:'system-ui'}}>Loading preview…</div>}>
      <CommandCenterShell userName="Saniel Golechha" userEmail="superadmin@aop.com">
        <PriorityActions />
      </CommandCenterShell>
    </Suspense>
  );
}
