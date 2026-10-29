import { NextResponse } from 'next/server';
import { MeetingError } from '@/task-manager/meetings/MeetingService';

/** Meeting Notes routes: a MeetingError is a message written for people; anything else becomes a plain 500. */
export function meetingFail(err: unknown, label: string) {
    if (err instanceof MeetingError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    console.error(`[${label}] error:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}
