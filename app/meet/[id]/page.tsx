import type { Metadata } from 'next';
import VideoCall from '@/frontend/components/task-manager/meetings/VideoCall';

/**
 * Owner 2026-11-18: the link to an online meeting of the Meeting Assistant. Sign-in is required (proxy.ts sends
 * anyone signed out to /login and back here); who may join is decided by the server.
 */
export const metadata: Metadata = { title: 'Online meeting | Autopilot' };

export default async function MeetPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <VideoCall meetingId={id} />;
}
