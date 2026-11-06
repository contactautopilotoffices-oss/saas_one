'use client';

import { use } from 'react';
import ProctorRunner from '@/frontend/components/proctor/ProctorRunner';

/**
 * The public test link: /t/<token>. No sign-in and no account — the link is
 * the credential, and the taker identifies themselves with a name and email.
 * Listed in proxy.ts as a public route.
 */
export default function PublicTestPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    return <ProctorRunner mode="public" token={token} />;
}
