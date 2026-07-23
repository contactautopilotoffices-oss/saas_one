'use client';

import { useEffect } from 'react';
import { initIssueTracking } from '@/frontend/lib/errorTracking';

export default function ErrorTrackingProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize error tracking on app load
    initIssueTracking();
  }, []);

  return <>{children}</>;
}
