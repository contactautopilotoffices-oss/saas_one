import { NextRequest, NextResponse } from 'next/server';
import { releaseDue } from '@/task-manager/heldMessages';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/task-held-messages: every minute (vercel.json). Sends the WhatsApp messages and app bells that a WhatsApp
 * task-assistant change parked for 1 minute (owner 2026-11-21, "undo" before then means they are never sent).
 * Same sending code as before; nothing here decides who is told. Before migration 20261121000001 there is nothing to send.
 */
export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        return NextResponse.json(await releaseDue());
    } catch (error) {
        console.error('[TaskHeldMessages] Cron failed', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'Sending held messages failed' }, { status: 500 });
    }
}
