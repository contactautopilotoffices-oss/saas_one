'use client';

import { useParams } from 'next/navigation';
import MeetingRoom from '@/frontend/components/meetings/MeetingRoom';

export default function MeetingRoomPage() {
    const params = useParams<{ orgId: string; meetingId: string }>();
    return <MeetingRoom orgId={params.orgId} meetingId={params.meetingId} />;
}
