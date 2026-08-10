'use client';

import { Suspense } from 'react';

import CommandCenter from '@/frontend/components/dashboard/command-center/CommandCenter';


export default function FullCommandCenterPreview() {
  return (
    <Suspense fallback={<div style={{padding:24,fontFamily:'system-ui'}}>Loading preview…</div>}>
      <CommandCenter
        userName="Saniel Golechha"
        userEmail="superadmin@aop.com"
        orgId="211e1330-ad83-446d-941f-dcea48396798"
      />
    </Suspense>
  );
}
