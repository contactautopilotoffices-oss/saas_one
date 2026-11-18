import type { Metadata } from 'next';
import GuestCall from '@/frontend/components/task-manager/meetings/GuestCall';

/**
 * Stage 2 (owner 2026-11-18): the Meeting Assistant's guest link, for people without a login. Public by design
 * (proxy.ts lists '/guest/'): the secret in the link is the only key, and nobody gets into the call until someone from
 * the team lets them in.
 */
export const metadata: Metadata = { title: 'Join meeting | Autopilot', robots: { index: false, follow: false } };

export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <GuestCall token={token} />;
}
