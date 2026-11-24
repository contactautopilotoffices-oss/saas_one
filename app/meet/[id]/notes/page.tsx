import type { Metadata } from 'next';
import MeetingNotesPage from '@/frontend/components/task-manager/meetings/MeetingNotesPage';

/**
 * Owner 2026-11-24: where an online meeting sends people after the call — that meeting's notes in the Meeting
 * Assistant. Sign-in is required like /meet/<id>; who may see the notes is decided by the server.
 */
export const metadata: Metadata = { title: 'Meeting notes | Autopilot' };

export default async function MeetingNotesRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <MeetingNotesPage meetingId={id} />;
}
