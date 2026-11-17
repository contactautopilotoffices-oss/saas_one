import { NextResponse } from 'next/server';
import { TaskManagerAuth } from '../_shared/adminGuard';
import { ZohoTaskSync } from '@/task-manager/ZohoTaskSync';

export const dynamic = 'force-dynamic';

/**
 * The signed-in person's own Zoho Tasks connection. Every method acts on the caller only — never on anyone else.
 *   GET    → connection status (never the token)
 *   POST   → import now (at most once a minute)
 *   DELETE → disconnect (already-imported tasks stay)
 */

const MIN_MANUAL_SYNC_MS = 60_000;

export async function GET() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: true, status: await ZohoTaskSync.getStatus(user.id) });
}

export async function POST() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const status = await ZohoTaskSync.getStatus(user.id);
    if (!status.connected) return NextResponse.json({ success: false, error: 'Zoho Tasks is not connected.' }, { status: 400 });
    if (status.lastSyncAt && Date.now() - Date.parse(status.lastSyncAt) < MIN_MANUAL_SYNC_MS) {
        return NextResponse.json({ success: false, error: 'Synced less than a minute ago — try again shortly.' }, { status: 429 });
    }

    const result = await ZohoTaskSync.syncUser(user.id);
    return NextResponse.json({ success: result.ok, result, error: result.error }, { status: result.ok ? 200 : 502 });
}

export async function DELETE() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const r = await ZohoTaskSync.disconnect(user.id);
    return NextResponse.json({ success: r.ok, error: r.error }, { status: r.ok ? 200 : 500 });
}
