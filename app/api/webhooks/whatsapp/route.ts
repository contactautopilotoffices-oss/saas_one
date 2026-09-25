import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { processIncomingMessage } from '@/backend/lib/whatsapp/processMessage';

const WEBHOOK_SECRET = process.env.WASENDER_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const secret = url.searchParams.get('secret') || req.headers.get('x-webhook-secret');
        if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
            console.warn('[WA WEBHOOK] Invalid webhook secret attempt');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();

        if (body.event && body.event !== 'message') {
            return NextResponse.json({ ok: true });
        }

        const msgData = body.data || body;
        if (!msgData || typeof msgData !== 'object') {
            return NextResponse.json({ ok: true });
        }

        if (msgData.key?.fromMe) {
            return NextResponse.json({ ok: true });
        }

        const msgKey = msgData.key || {};
        const msgContent = msgData.message || {};

        if (msgContent.pollUpdateMessage) {
            const pollUpdate = msgContent.pollUpdateMessage;
            const pollCreationKey = pollUpdate.pollCreationMessageKey;
            const pollMsgId = pollCreationKey?.id;
            const selectedOptionName = pollUpdate.vote?.selectedOptions?.[0]?.name || pollUpdate.selectedOption;

            const senderPn: string = msgKey.cleanedSenderPn || msgKey.senderPn || msgData.from || '';
            const senderPhone = senderPn.replace('@s.whatsapp.net', '').replace(/\D/g, '');

            if (senderPhone && (pollMsgId || selectedOptionName)) {
                const { data: session } = await supabaseAdmin
                    .from('whatsapp_sessions')
                    .select('*')
                    .eq('phone', senderPhone)
                    .eq('state', 'awaiting_property')
                    .single();

                if (session && session.property_options) {
                    const selectedProp = (session.property_options as any[]).find(
                        (p: any) => p.name.trim().toLowerCase() === (selectedOptionName || '').trim().toLowerCase()
                    );

                    if (selectedProp) {
                        await supabaseAdmin
                            .from('whatsapp_sessions')
                            .delete()
                            .eq('phone', senderPhone);

                        await processIncomingMessage(
                            senderPhone,
                            session.pending_text || '',
                            session.pending_media_url,
                            session.pending_media_key,
                            session.pending_is_image,
                            session.pending_video_url,
                            session.pending_video_key,
                            session.pending_is_video,
                            selectedProp.id
                        );
                    }
                }
            }
            return NextResponse.json({ ok: true });
        }

        const senderPn: string = msgKey.cleanedSenderPn || msgKey.senderPn || msgData.from || '';
        const senderPhone = senderPn.replace('@s.whatsapp.net', '').replace(/\D/g, '');

        if (!senderPhone || senderPhone.length < 10) return NextResponse.json({ ok: true });

        const imageMsg = msgContent.imageMessage;
        const videoMsg = msgContent.videoMessage;
        const textMsg = msgContent.conversation || msgContent.extendedTextMessage?.text || '';
        const messageText: string = imageMsg?.caption || videoMsg?.caption || textMsg || '';
        const mediaUrl: string | null = imageMsg?.url || null;
        const mediaKey: string | null = imageMsg?.mediaKey || null;
        const videoUrl: string | null = videoMsg?.url || null;
        const videoKey: string | null = videoMsg?.mediaKey || null;
        const isImage = !!imageMsg;
        const isVideo = !!videoMsg;
        const msgId = msgKey.id || null;

        if (!messageText && !mediaUrl && !videoUrl) return NextResponse.json({ ok: true });

        await processIncomingMessage(
            senderPhone, 
            messageText, 
            mediaUrl, 
            mediaKey, 
            isImage, 
            videoUrl, 
            videoKey, 
            isVideo,
            null, 
            msgId
        );

        return NextResponse.json({ ok: true });

    } catch (err) {
        console.error('[WA WEBHOOK] Unhandled error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
