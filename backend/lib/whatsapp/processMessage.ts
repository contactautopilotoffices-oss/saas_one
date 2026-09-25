import { hkdfSync, createDecipheriv } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveClassification, logClassification } from '@/backend/lib/ticketing';
import { classifyTicketEnhanced } from '@/backend/lib/ticketing/classifyTicket';
import { WhatsAppService } from '@/backend/services/WhatsAppService';

const BUCKET_NAME = 'ticket_photos';
const VIDEO_BUCKET = 'ticket_videos';
const SESSION_TTL_MINUTES = 10;

function extractFloorNumber(text: string): number | null {
    const lower = text.toLowerCase();
    if (lower.includes('ground floor') || lower.includes('floor 0') || lower.includes('level 0')) return 0;
    if (lower.includes('basement') || lower.includes('b1')) return -1;
    const patterns = [
        /(\d+)(?:st|nd|rd|th)\s*floor/i,
        /floor\s*(\d+)/i,
        /level\s*(\d+)/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return parseInt(m[1], 10);
    }
    return null;
}

function extractLocation(text: string): string | null {
    const locations: Record<string, string[]> = {
        'Cafeteria': ['cafeteria', 'canteen', 'pantry', 'kitchen'],
        'Reception': ['lobby', 'reception', 'entrance'],
        'Parking': ['parking', 'basement', 'garage'],
        'Washroom': ['washroom', 'restroom', 'toilet', 'bathroom'],
        'Conference Room': ['conference', 'meeting room'],
        'Server Room': ['server room', 'data center'],
    };
    const lower = text.toLowerCase();
    for (const [loc, keywords] of Object.entries(locations)) {
        for (const kw of keywords) {
            if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) return loc;
        }
    }
    return null;
}

function decryptWhatsAppMedia(encryptedBuffer: Buffer, mediaKeyBase64: string, mediaType: 'image' | 'video' = 'image'): Buffer {
    const mediaKey = Buffer.from(mediaKeyBase64, 'base64');
    const salt = Buffer.alloc(32);
    const infoStr = mediaType === 'video' ? 'WhatsApp Video Keys' : 'WhatsApp Image Keys';
    const keyMaterial = Buffer.from(hkdfSync('sha256', mediaKey, salt, Buffer.from(infoStr), 112));
    const iv = keyMaterial.subarray(0, 16);
    const cipherKey = keyMaterial.subarray(16, 48);
    const encData = encryptedBuffer.subarray(0, -10);
    const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
}

async function uploadMediaToStorage(mediaUrl: string, ticketId: string, mediaKeyBase64?: string): Promise<string | null> {
    try {
        const res = await fetch(mediaUrl);
        if (!res.ok) {
            console.error('[WA WEBHOOK] Failed to download media:', res.status);
            return null;
        }

        const encryptedBuffer = Buffer.from(await res.arrayBuffer());
        let rawBuffer: Buffer;
        if (mediaKeyBase64) {
            rawBuffer = decryptWhatsAppMedia(encryptedBuffer, mediaKeyBase64);
        } else {
            rawBuffer = encryptedBuffer;
        }

        const compressed = await sharp(rawBuffer)
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();

        const fileName = `${ticketId}/before_${Date.now()}.jpg`;
        const { error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: true });

        if (error) {
            console.error('[WA WEBHOOK] Storage upload failed:', error.message);
            return null;
        }

        const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(fileName);
        return publicUrl;
    } catch (err) {
        console.error('[WA WEBHOOK] Media upload error:', err);
        return null;
    }
}

async function compressVideo(inputBuffer: Buffer): Promise<Buffer> {
    const id = `wa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputPath = join(tmpdir(), `${id}_in.mp4`);
    const outputPath = join(tmpdir(), `${id}_out.mp4`);
    await writeFile(inputPath, inputBuffer);
    try {
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-crf 28',
                    '-preset fast',
                    '-vf scale=\'trunc(min(1280\\,iw)/2)*2\':\'trunc(min(720\\,ih)/2)*2\'',
                    '-movflags +faststart',
                    '-b:a 64k',
                ])
                .on('end', () => resolve())
                .on('error', (err: Error) => reject(err))
                .save(outputPath);
        });
        return await readFile(outputPath);
    } finally {
        await Promise.all([unlink(inputPath), unlink(outputPath)]).catch(() => {});
    }
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': '*/*',
                },
            });
            if (res.ok) return res;
            console.warn(`[WA WEBHOOK] Fetch attempt ${i + 1} failed: HTTP ${res.status}`);
        } catch (err) {
            console.warn(`[WA WEBHOOK] Fetch attempt ${i + 1} error:`, (err as Error).message);
            if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw new Error('All fetch attempts failed');
}

async function uploadVideoToStorage(videoUrl: string, ticketId: string, mediaKeyBase64?: string): Promise<string | null> {
    try {
        const res = await fetchWithRetry(videoUrl);
        const encryptedBuffer = Buffer.from(await res.arrayBuffer());

        let videoBuffer: Buffer;
        if (mediaKeyBase64) {
            videoBuffer = decryptWhatsAppMedia(encryptedBuffer, mediaKeyBase64, 'video');
        } else {
            videoBuffer = encryptedBuffer;
        }

        const compressed = await compressVideo(videoBuffer);

        const fileName = `${ticketId}/before_${Date.now()}.mp4`;
        const { error } = await supabaseAdmin.storage
            .from(VIDEO_BUCKET)
            .upload(fileName, compressed, { contentType: 'video/mp4', upsert: true });

        if (error) {
            console.error('[WA WEBHOOK] Video storage upload failed:', error.message);
            return null;
        }

        const { data: { publicUrl } } = supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(fileName);
        return publicUrl;
    } catch (err) {
        console.error('[WA WEBHOOK] Video upload error:', err);
        return null;
    }
}

export async function processIncomingMessage(
    senderPhone: string,
    messageText: string,
    mediaUrl: string | null,
    mediaKey: string | null,
    isImage: boolean,
    videoUrl: string | null = null,
    videoKey: string | null = null,
    isVideo = false,
    forcedPropertyId: string | null = null,
    waMessageId: string | null = null,
) {
    try {
        const mediaType = isImage ? 'image' : isVideo ? 'video' : 'text';

        // ── Look up user by phone ─────────────────────────────────────────────
        const last10 = senderPhone.slice(-10);
        const { data: usersFound } = await supabaseAdmin
            .from('users')
            .select('id, full_name, phone')
            .or(`phone.eq.${last10},phone.ilike.%${last10}`)
            .limit(1);
        const userRow = usersFound?.[0] || null;

        if (!userRow) {
            console.warn('[WA WEBHOOK] No user found for phone:', senderPhone);
            WhatsAppService.send(senderPhone, {
                message: `❌ Your number is not registered in our system. Please contact your property manager.`,
            });
            return;
        }

        // ── Resolve all properties available to this user ────────────────────
        type PropOption = { id: string; name: string; organization_id: string };
        let propertyOptions: PropOption[] = [];

        const { data: orgAdminRecord } = await supabaseAdmin
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', userRow.id)
            .eq('role', 'org_super_admin')
            .maybeSingle();

        if (orgAdminRecord) {
            const { data: allProps } = await supabaseAdmin
                .from('properties')
                .select('id, name, organization_id')
                .eq('organization_id', orgAdminRecord.organization_id)
                .limit(12);
            propertyOptions = (allProps || []).map(p => ({
                id: p.id, name: p.name, organization_id: p.organization_id,
            }));
        } else {
            const { data: memberships } = await supabaseAdmin
                .from('property_memberships')
                .select('property_id, properties(id, name, organization_id)')
                .eq('user_id', userRow.id)
                .limit(12);
            propertyOptions = (memberships || []).map((m: any) => ({
                id: m.property_id,
                name: m.properties?.name || m.property_id,
                organization_id: m.properties?.organization_id,
            }));
        }

        if (propertyOptions.length === 0) {
            console.warn('[WA WEBHOOK] User has no accessible properties:', userRow.id);
            WhatsAppService.send(senderPhone, {
                message: `❌ You are not assigned to any property. Please contact your property manager.`,
            });
            return;
        }

        // ── Multi-property: send a poll to let the user choose ────────────────
        if (!forcedPropertyId && propertyOptions.length > 1) {
            const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

            const { error: sessionError } = await supabaseAdmin.from('whatsapp_sessions').upsert({
                phone: senderPhone,
                state: 'awaiting_property',
                user_id: userRow.id,
                pending_text: messageText,
                pending_media_url: mediaUrl,
                pending_media_key: mediaKey,
                pending_video_url: videoUrl,
                pending_video_key: videoKey,
                pending_is_image: isImage,
                pending_is_video: isVideo,
                property_options: propertyOptions,
                expires_at: expiresAt,
            }, { onConflict: 'phone' });

            if (sessionError) {
                console.error('[WA WEBHOOK] Session upsert failed:', sessionError.message);
                WhatsAppService.send(senderPhone, {
                    message: `❌ Could not start property selection. Please try again.`,
                });
                return;
            }

            const pollSent = await WhatsAppService.sendPoll(
                senderPhone,
                '🏢 Which property is this request for?',
                propertyOptions.map(p => p.name),
            );
            if (!pollSent) {
                console.error('[WA WEBHOOK] sendPoll failed for:', senderPhone);
                WhatsAppService.send(senderPhone, { message: `❌ Could not send property selection. Please try again.` });
            }
            return;
        }

        // ── Single or pre-selected property ──────────────────────────────────
        let selectedProp = forcedPropertyId
            ? propertyOptions.find(p => p.id === forcedPropertyId)
            : propertyOptions[0];

        if (!selectedProp && forcedPropertyId) {
            const { data: directProp } = await supabaseAdmin
                .from('properties')
                .select('id, name, organization_id')
                .eq('id', forcedPropertyId)
                .single();
            if (directProp) selectedProp = { id: directProp.id, name: directProp.name, organization_id: directProp.organization_id };
        }

        if (!selectedProp) {
            console.error('[WA WEBHOOK] Could not resolve property');
            WhatsAppService.send(senderPhone, {
                message: `❌ Could not identify your property. Please contact your property manager.`,
            });
            return;
        }

        const propertyId: string = selectedProp.id;
        const organizationId: string = selectedProp.organization_id;
        const propertyName: string = selectedProp.name || 'your property';

        if (!organizationId) {
            console.error('[WA WEBHOOK] Property has no organization_id:', propertyId);
            WhatsAppService.send(senderPhone, {
                message: `❌ Property configuration error. Please contact your administrator.`,
            });
            return;
        }

        // ── Run Groq classification ───────────────────────────────────────────
        const ticketText = messageText || 'Maintenance request via WhatsApp';

        const preClassification = classifyTicketEnhanced(ticketText);
        let categoryId: string | null = null;
        let skillGroupId: string | null = null;
        let priority = 'medium';
        let slaHours = 24;

        if (preClassification.issue_code) {
            const { data: catData } = await supabaseAdmin
                .from('issue_categories')
                .select('id, skill_group_id, priority, sla_hours')
                .eq('code', preClassification.issue_code)
                .limit(1)
                .maybeSingle();
            if (catData) {
                categoryId = catData.id;
                skillGroupId = catData.skill_group_id;
                priority = catData.priority || 'medium';
                slaHours = catData.sla_hours || 24;
            }
        }

        const resolution = await resolveClassification(ticketText, priority);
        const { issue_code, skill_group, confidence, decisionSource } = resolution;
        const isVague = confidence === 'low';

        if (issue_code && issue_code !== preClassification.issue_code) {
            const { data: catData } = await supabaseAdmin
                .from('issue_categories')
                .select('id, skill_group_id, priority, sla_hours')
                .eq('code', issue_code)
                .limit(1)
                .maybeSingle();
            if (catData) {
                categoryId = catData.id;
                skillGroupId = catData.skill_group_id;
                const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
                if ((priorityRank[catData.priority] ?? 0) > (priorityRank[priority] ?? 0)) {
                    priority = catData.priority;
                }
                slaHours = catData.sla_hours || slaHours;
            }
        }

        if (!skillGroupId) {
            const { data: defaultSkill } = await supabaseAdmin
                .from('skill_groups')
                .select('id')
                .eq('code', skill_group)
                .limit(1)
                .maybeSingle();
            if (defaultSkill) skillGroupId = defaultSkill.id;
        }

        // ── Create ticket ─────────────────────────────────────────────────────
        const ticketNumber = `TKT-${Date.now()}`;
        const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
        const groqPriority = resolution.priority?.toLowerCase() || '';
        const dbPriority = priority;
        const finalPriority = (priorityRank[groqPriority] ?? -1) > (priorityRank[dbPriority] ?? -1)
            ? groqPriority
            : dbPriority;
        const titleText = ticketText.slice(0, 100);

        const { data: ticket, error: insertError } = await supabaseAdmin
            .from('tickets')
            .insert({
                ticket_number: ticketNumber,
                property_id: propertyId,
                organization_id: organizationId,
                title: titleText,
                description: ticketText,
                category: issue_code,
                category_id: categoryId,
                skill_group_id: skillGroupId,
                department: skill_group,
                priority: finalPriority,
                status: 'open',
                raised_by: userRow.id,
                raised_by_name: userRow.full_name || null,
                internal: false,
                is_vague: isVague,
                sla_hours: slaHours,
                floor_number: extractFloorNumber(ticketText) ?? undefined,
                location: extractLocation(ticketText) ?? undefined,
                issue_code,
                skill_group_code: skill_group,
                confidence,
                secondary_category_code: resolution.secondary_category_code,
                risk_flag: resolution.risk_flag,
                llm_reasoning: resolution.llm_reasoning,
                classification_source: decisionSource,
                confidence_score: resolution.llmResult ? 90 : 100,
                wa_message_id: waMessageId,
            })
            .select('*')
            .single();

        if (insertError || !ticket) {
            console.error('[WA WEBHOOK] Ticket insert error:', insertError?.message);
            WhatsAppService.send(senderPhone, {
                message: `❌ Failed to create your request. Please try again or contact the front desk.`,
            });
            return;
        }

        let photoUrl: string | null = null;
        if (mediaUrl && isImage) {
            photoUrl = await uploadMediaToStorage(mediaUrl, ticket.id, mediaKey ?? undefined);
            if (photoUrl) {
                await supabaseAdmin
                    .from('tickets')
                    .update({ photo_before_url: photoUrl })
                    .eq('id', ticket.id);
            }
        }

        let storedVideoUrl: string | null = null;
        if (videoUrl && isVideo) {
            storedVideoUrl = await uploadVideoToStorage(videoUrl, ticket.id, videoKey ?? undefined);
            if (storedVideoUrl) {
                await supabaseAdmin
                    .from('tickets')
                    .update({ video_before_url: storedVideoUrl })
                    .eq('id', ticket.id);
            }
        }

        let { data: defaultHierarchy } = await supabaseAdmin
            .from('escalation_hierarchies')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('property_id', propertyId)
            .eq('is_default', true)
            .eq('is_active', true)
            .maybeSingle();

        if (!defaultHierarchy) {
            const { data: orgWide } = await supabaseAdmin
                .from('escalation_hierarchies')
                .select('id')
                .eq('organization_id', organizationId)
                .is('property_id', null)
                .eq('is_default', true)
                .eq('is_active', true)
                .maybeSingle();
            defaultHierarchy = orgWide;
        }

        if (defaultHierarchy) {
            await supabaseAdmin
                .from('tickets')
                .update({
                    hierarchy_id: defaultHierarchy.id,
                    current_escalation_level: 0,
                    escalation_last_action_at: new Date().toISOString(),
                })
                .eq('id', ticket.id);
        }

        try {
            const { processIntelligentAssignment } = await import('@/backend/lib/ticketing/assignment');
            await processIntelligentAssignment(
                supabaseAdmin,
                [{ 
                    id: ticket.id, 
                    property_id: propertyId, 
                    skill_group_code: skill_group,
                    title: ticket.title,
                    description: ticket.description
                }],
                propertyId
            );

            const { data: assignedTicket } = await supabaseAdmin
                .from('tickets')
                .select('status, assigned_to, assignee:users!assigned_to(full_name)')
                .eq('id', ticket.id)
                .single();

            if (assignedTicket) {
                ticket.status = assignedTicket.status;
                ticket.assigned_to = assignedTicket.assigned_to;
            }
        } catch (assignErr) {
            console.error('[WA WEBHOOK] Auto-assignment error:', assignErr);
        }

        logClassification(ticket.id, resolution).catch(err => {
            console.error('[WA WEBHOOK] Classification log error:', err);
        });

        try {
            const { NotificationService } = await import('@/backend/services/NotificationService');
            await NotificationService.afterTicketCreated(ticket.id);
            if (finalPriority === 'critical') {
                await NotificationService.afterCriticalTicketCreated(ticket.id);
            }
        } catch (err) {
            console.error('[WA WEBHOOK] NotificationService import error:', err);
        }

        const priorityEmoji: Record<string, string> = {
            critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
        };
        const pEmoji = priorityEmoji[finalPriority] || '⚪';
        const categoryLabel = issue_code?.replace(/_/g, ' ') || skill_group?.replace(/_/g, ' ') || 'General';

        const replyMessage = [
            `✅ *Request Created Successfully!*`,
            ``,
            `🎫 *${ticketNumber}*`,
            `📋 ${titleText}`,
            `🏢 ${propertyName}`,
            `🔧 Category: *${categoryLabel.toUpperCase()}*`,
            `${pEmoji} Priority: *${finalPriority.toUpperCase()}*`,
            photoUrl ? `📷 Photo attached` : '',
            storedVideoUrl ? `🎥 Video attached` : '',
            ``,
            `Our team will look into it shortly.`,
        ].filter(Boolean).join('\n');

        WhatsAppService.send(senderPhone, {
            message: replyMessage,
            deepLink: `/tickets/${ticket.id}?from=requests`,
        });

    } catch (err: any) {
        console.error('[WA WEBHOOK] processIncomingMessage error:', err);
    }
}
