import { NextRequest, NextResponse } from 'next/server';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * POST /api/admin/whatsapp/test-send
 * Direct test dispatch to verify AiSensy live connectivity.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { phone, campaignName, templateParams, userName, mediaUrl } = body;

        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        console.log(`[AiSensy Test] Sending test campaign "${campaignName || 'fms_welcome_onboarding_v1'}" to ${phone}`);

        const result = await AiSensyService.sendTemplate({
            phone,
            campaignName: campaignName || 'fms_welcome_onboarding_v1',
            templateParams: templateParams || [
                userName || 'Property Team',
                'contact.autopilotoffices@gmail.com'
            ],
            userName: userName || 'Admin',
            mediaUrl: mediaUrl || undefined,
        });

        console.log('[AiSensy Test] Result:', result);

        return NextResponse.json(result);
    } catch (err: any) {
        console.error('[AiSensy Test] Error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
