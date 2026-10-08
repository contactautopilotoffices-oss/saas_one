import { NextRequest, NextResponse } from 'next/server';
import { retryWhatsAppAssistant } from '@/backend/lib/whatsapp/assistant/runtime';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.AISENSY_ASSISTANT_ENABLED !== 'true') return NextResponse.json({ enabled: false });
    try { return NextResponse.json(await retryWhatsAppAssistant()); }
    catch (error) {
        console.error('[WhatsAppAssistant] Cron failed', error);
        return NextResponse.json({ error: 'Retry processing failed' }, { status: 500 });
    }
}
