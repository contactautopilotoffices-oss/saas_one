import { NextRequest, NextResponse } from 'next/server';
import { VoiceCallingService } from '@/backend/services/VoiceCallingService';

/**
 * POST /api/voice/test-call
 * Triggers a live test phone call via Bolna AI + Plivo Virtual Number.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { phone, organizationId, userName, customScript, voiceId, speechSpeed } = body;

        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        const result = await VoiceCallingService.triggerTestCall({
            phone,
            organizationId: organizationId || '',
            userName: userName || 'Admin',
            customScript,
            voiceId,
            speechSpeed
        });

        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Failed to place test call' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: 'Test call initiated successfully!',
            callId: result.callId,
            spokenScript: result.spokenScript
        });
    } catch (err: any) {
        console.error('[Voice Test Call API] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
