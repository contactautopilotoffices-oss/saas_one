import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';

/**
 * POST /api/admin/whatsapp/broadcast
 * Broadcasts an FMS Welcome & Onboarding message to all users or scoped property members,
 * explaining all the FMS features available in the platform (Tickets, Meeting Rooms, SOPs, Utilities, Materials).
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { organizationId, propertyId, targetRoles, targetUserIds: explicitUserIds, helpdeskContact, customPropertyName, templateName } = body;

        if (!organizationId) {
            return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
        }

        // Verify Org Super Admin / Owner / Admin permissions
        const { data: membership } = await supabaseAdmin
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', organizationId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();

        const isSuperAdmin = membership && ['org_super_admin', 'owner', 'master_admin', 'admin', 'org_admin'].includes(membership.role);
        if (!isSuperAdmin) {
            return NextResponse.json({ error: 'Forbidden. Only organization admins can broadcast welcome messages.' }, { status: 403 });
        }

        // Fetch organization or property name
        let entityName = customPropertyName || '';
        if (!entityName) {
            if (propertyId && propertyId !== 'global') {
                const { data: prop } = await supabaseAdmin
                    .from('properties')
                    .select('name')
                    .eq('id', propertyId)
                    .maybeSingle();
                entityName = prop?.name || 'Facility Property';
            } else {
                const { data: org } = await supabaseAdmin
                    .from('organizations')
                    .select('name')
                    .eq('id', organizationId)
                    .maybeSingle();
                entityName = org?.name || 'AutoPilot Facility';
            }
        }

        // Resolve target user IDs
        let targetUserIds: string[] = [];

        if (explicitUserIds && Array.isArray(explicitUserIds) && explicitUserIds.length > 0) {
            // Direct individual user selection
            targetUserIds = Array.from(new Set(explicitUserIds.filter(Boolean)));
        } else if (propertyId && propertyId !== 'global') {
            // Scoped to specific property
            let query = supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('property_id', propertyId)
                .eq('is_active', true);

            if (targetRoles && Array.isArray(targetRoles) && targetRoles.length > 0) {
                query = query.in('role', targetRoles);
            }

            const { data: propMems } = await query;
            targetUserIds = Array.from(new Set((propMems || []).map(m => m.user_id).filter(Boolean)));
        } else {
            // All organization members
            let query = supabaseAdmin
                .from('organization_memberships')
                .select('user_id, role')
                .eq('organization_id', organizationId)
                .eq('is_active', true);

            if (targetRoles && Array.isArray(targetRoles) && targetRoles.length > 0) {
                query = query.in('role', targetRoles);
            }

            const { data: orgMems } = await query;
            targetUserIds = Array.from(new Set((orgMems || []).map(m => m.user_id).filter(Boolean)));
        }


        if (targetUserIds.length === 0) {
            return NextResponse.json({ error: 'No recipients found for the selected scope.' }, { status: 400 });
        }

        // Fetch user profiles to personalize greeting: Hello {{2}} (full_name)
        const { data: userProfiles } = await supabaseAdmin
            .from('users')
            .select('id, full_name, phone')
            .in('id', targetUserIds);

        const usersList = (userProfiles || []).filter(u => u.phone || u.id);
        const effectiveTemplate = templateName || 'fms_welcome_onboarding_v1';
        const contactInfo = helpdeskContact || 'contact.autopilotoffices@gmail.com';

        // Enqueue individual greetings per user
        let enqueuedCount = 0;

        for (const u of usersList) {
            const userName = u.full_name || 'Member';
            const orderedParams = [
                userName,       // {{1}} User Full Name
                contactInfo     // {{2}} Helpdesk Email / Contact
            ];

            const summaryMessage = `🏢 *Welcome to AutoPilot FMS powered by AutoPilot Offices!*\n\nHello ${userName},\nYour complete Facility Management System (FMS) is now active:\n• 🎫 Service Tickets & Maintenance Requests\n• 📅 Meeting Room & Amenity Reservations\n• 📋 SOP Checklists & Inspection Audits\n• ⚡ Energy & Utility Consumption Logs\n• 📦 Material Requests & Stock Tracking\n\nNeed support? Contact helpdesk at ${contactInfo} for prompt assistance.`;



            await WhatsAppQueueService.enqueue({
                userIds: [u.id],
                message: summaryMessage,
                eventType: 'FMS_WELCOME_BROADCAST',
                organizationId,
                templateName: effectiveTemplate,
                templateParams: orderedParams
            });

            enqueuedCount++;
        }

        return NextResponse.json({
            success: true,
            message: `FMS Welcome & Onboarding message queued successfully for ${enqueuedCount} user(s).`,
            recipientsCount: enqueuedCount
        });

    } catch (err: any) {
        console.error('[BroadcastWelcome] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
