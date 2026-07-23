'use client';

import { CrmOnboardingGate } from '@/frontend/components/crm/onboarding';

// SoundProvider lives at the app root (app/layout.tsx) so the sound toggle —
// which also appears on the non-CRM settings page — always has its context.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
    return <CrmOnboardingGate>{children}</CrmOnboardingGate>;
}
