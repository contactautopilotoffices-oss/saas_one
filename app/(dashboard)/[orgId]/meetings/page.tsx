'use client';

import { useParams } from 'next/navigation';
import MeetingsHome from '@/frontend/components/meetings/MeetingsHome';

export default function MeetingsPage() {
    const params = useParams<{ orgId: string }>();
    return <MeetingsHome orgId={params.orgId} />;
}
