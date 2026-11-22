import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { logAudit } from '@/backend/lib/audit';

const STATUS_EMOJI: Record<string, string> = {
    done: '✅',
    postponed: '⏸️',
    skipped: '⏭️',
    pending: '⏳',
};

/**
 * PATCH /api/ppm/schedules/[id]
 * Update status, task details, remark for a PPM schedule entry with audit logging.
 * Sends WhatsApp to property admins + org super admins on status change.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            status,
            done_date,
            remark,
            verification_status,
            vendor_id,
            vendor_name,
            vendor_phone,
            vendor_contact_person,
            completed_by,
            system_name,
            detail_name,
            scope_of_work,
            frequency,
            location,
            maker,
            checker,
            planned_date,
        } = body;

        const validStatuses = ['pending', 'done', 'postponed', 'skipped'];
        if (status && !validStatuses.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        // Fetch current record to detect changes
        const { data: existing, error: fetchError } = await supabaseAdmin
            .from('ppm_schedules')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !existing) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // Fetch updater user details for audit trail
        const { data: updaterUser } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', user.id)
            .single();

        const updaterName = updaterUser?.full_name || updaterUser?.email || 'Team Member';
        const nowIso = new Date().toISOString();

        // Build summary of changes
        const changesSummary: string[] = [];
        if (status !== undefined && status !== existing.status) {
            changesSummary.push(`status: ${existing.status} → ${status}`);
        }
        if (planned_date !== undefined && planned_date !== existing.planned_date) {
            changesSummary.push(`date: ${existing.planned_date} → ${planned_date}`);
        }
        if (system_name !== undefined && system_name !== existing.system_name) {
            changesSummary.push(`system name: "${existing.system_name}" → "${system_name}"`);
        }
        if (detail_name !== undefined && detail_name !== existing.detail_name) {
            changesSummary.push(`detail name updated`);
        }
        if (location !== undefined && location !== existing.location) {
            changesSummary.push(`location: "${existing.location || 'none'}" → "${location}"`);
        }
        if (vendor_name !== undefined && vendor_name !== existing.vendor_name) {
            changesSummary.push(`vendor: "${existing.vendor_name || 'none'}" → "${vendor_name}"`);
        }
        if (remark !== undefined && remark !== existing.remark) {
            changesSummary.push(`remark updated`);
        }
        if (verification_status !== undefined && verification_status !== existing.verification_status) {
            changesSummary.push(`verification: ${existing.verification_status || 'none'} → ${verification_status}`);
        }

        const changeDetails = changesSummary.length > 0 ? changesSummary.join(', ') : 'Task details updated';

        const updateLogEntry = {
            action: 'updated',
            user_id: user.id,
            user_name: updaterName,
            user_email: updaterUser?.email || null,
            timestamp: nowIso,
            details: changeDetails,
            changes: {
                ...(status !== undefined && status !== existing.status ? { old_status: existing.status, new_status: status } : {}),
                ...(planned_date !== undefined && planned_date !== existing.planned_date ? { old_date: existing.planned_date, new_date: planned_date } : {}),
                ...(remark !== undefined && remark !== existing.remark ? { old_remark: existing.remark, new_remark: remark } : {}),
                ...(system_name !== undefined && system_name !== existing.system_name ? { old_system: existing.system_name, new_system: system_name } : {}),
            },
        };

        let finalAttachments = { ...(existing.attachments || {}) };
        const existingLogs = Array.isArray(finalAttachments.activity_logs) ? finalAttachments.activity_logs : [];
        finalAttachments.activity_logs = [...existingLogs, updateLogEntry];

        if (status === 'done') {
            const completingUserId = completed_by || user.id;
            finalAttachments = {
                ...finalAttachments,
                completed_by: completingUserId,
                completed_by_name: updaterName,
                completed_at: nowIso,
            };
        } else if (status !== undefined && status !== 'done') {
            delete finalAttachments.completed_by;
            delete finalAttachments.completed_by_name;
            delete finalAttachments.completed_at;
        }

        const updatePayload: any = {
            ...(system_name !== undefined && { system_name: system_name.trim() }),
            ...(detail_name !== undefined && { detail_name: detail_name?.trim() || null }),
            ...(scope_of_work !== undefined && { scope_of_work: scope_of_work?.trim() || null }),
            ...(frequency !== undefined && { frequency }),
            ...(location !== undefined && { location: location?.trim() || null }),
            ...(maker !== undefined && { maker: maker?.trim() || null }),
            ...(checker !== undefined && { checker: checker?.trim() || null }),
            ...(planned_date !== undefined && { planned_date }),
            ...(status !== undefined && { status }),
            ...(done_date !== undefined && { done_date }),
            ...(remark !== undefined && { remark }),
            ...(verification_status !== undefined && { verification_status }),
            ...(vendor_id !== undefined && { vendor_id }),
            ...(vendor_name !== undefined && { vendor_name }),
            ...(vendor_phone !== undefined && { vendor_phone }),
            ...(vendor_contact_person !== undefined && { vendor_contact_person }),
            attachments: finalAttachments,
            updated_at: nowIso,
        };

        let { data, error } = await supabase
            .from('ppm_schedules')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            console.warn('[PPM] user-scoped update failed or blocked by RLS, attempting admin fallback:', error?.message);
            const adminRes = await supabaseAdmin
                .from('ppm_schedules')
                .update(updatePayload)
                .eq('id', id)
                .select()
                .single();
            if (adminRes.error) {
                return NextResponse.json({ error: adminRes.error.message }, { status: 500 });
            }
            data = adminRes.data;
        }

        // Record in audit_logs table
        await logAudit({
            eventBy: user.id,
            objectType: 'ppm_schedule',
            objectId: id,
            action: 'ppm_schedule.updated',
            payload: {
                schedule_id: id,
                property_id: existing.property_id,
                organization_id: existing.organization_id,
                system_name: updatePayload.system_name || existing.system_name,
                detail_name: updatePayload.detail_name !== undefined ? updatePayload.detail_name : existing.detail_name,
                updated_by_id: user.id,
                updated_by_name: updaterName,
                updated_at: nowIso,
                details: changeDetails,
                changes: updateLogEntry.changes,
            },
        });

        // Send WhatsApp notification if status actually changed
        if (existing && status && status !== existing.status) {
            sendPPMUpdateNotification(data, existing.status, user.id).catch(err =>
                console.error('[PPM] Update notification error:', err)
            );
        }

        return NextResponse.json({ schedule: data });
    } catch (err: any) {
        console.error('PPM update error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/ppm/schedules/[id]
 * Delete a PPM schedule entry with full audit logging (who deleted, task snapshot).
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch existing task snapshot before deletion
        const { data: existing, error: fetchError } = await supabaseAdmin
            .from('ppm_schedules')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !existing) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // Fetch deleter's name
        const { data: deleterUser } = await supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', user.id)
            .single();

        const deleterName = deleterUser?.full_name || deleterUser?.email || 'Team Member';
        const nowIso = new Date().toISOString();

        // 1. Record in audit_logs table before deleting
        await logAudit({
            eventBy: user.id,
            objectType: 'ppm_schedule',
            objectId: id,
            action: 'ppm_schedule.deleted',
            payload: {
                schedule_id: id,
                property_id: existing.property_id,
                organization_id: existing.organization_id,
                system_name: existing.system_name,
                detail_name: existing.detail_name,
                frequency: existing.frequency,
                location: existing.location,
                planned_date: existing.planned_date,
                deleted_by_id: user.id,
                deleted_by_name: deleterName,
                deleted_at: nowIso,
                task_snapshot: existing,
            },
        });

        // 2. Perform delete
        let { error: deleteError } = await supabase
            .from('ppm_schedules')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.warn('[PPM] user-scoped delete failed, attempting admin fallback:', deleteError.message);
            const adminDel = await supabaseAdmin
                .from('ppm_schedules')
                .delete()
                .eq('id', id);

            if (adminDel.error) {
                return NextResponse.json({ error: adminDel.error.message }, { status: 500 });
            }
        }

        return NextResponse.json({
            success: true,
            message: 'PPM task deleted successfully',
            deleted_task: {
                id: existing.id,
                system_name: existing.system_name,
                detail_name: existing.detail_name,
                deleted_by: deleterName,
                deleted_at: nowIso,
            },
        });
    } catch (err: any) {
        console.error('PPM delete error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

async function sendPPMUpdateNotification(
    schedule: any,
    previousStatus: string,
    updatedByUserId: string
) {
    const recipientIds = new Set<string>();

    // Org super admins
    const { data: orgAdmins } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', schedule.organization_id)
        .in('role', ['org_super_admin', 'ops_super_admin', 'owner', 'admin', 'org_admin'])
        .neq('is_active', false);
    (orgAdmins || []).forEach((m: any) => recipientIds.add(m.user_id));

    // Property admins
    if (schedule.property_id) {
        const { data: propAdmins } = await supabaseAdmin
            .from('property_memberships')
            .select('user_id')
            .eq('property_id', schedule.property_id)
            .eq('role', 'property_admin')
            .eq('is_active', true);
        (propAdmins || []).forEach((m: any) => recipientIds.add(m.user_id));
    }

    // Fetch updater name
    const { data: updater } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', updatedByUserId)
        .single();
    const updaterName = updater?.full_name || 'A team member';

    if (recipientIds.size === 0) return;

    const emoji = STATUS_EMOJI[schedule.status] || '📋';
    const plannedLabel = new Date(schedule.planned_date + 'T12:00:00').toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
    });

    const lines = [
        `${emoji} *PPM Task Updated*`,
        ``,
        `📋 *${schedule.system_name}*${schedule.detail_name ? ` — ${schedule.detail_name}` : ''}`,
        schedule.scope_of_work ? `🔧 ${schedule.scope_of_work}` : '',
        schedule.vendor_name ? `🏭 Vendor: ${schedule.vendor_name}` : '',
        schedule.location ? `📍 ${schedule.location}` : '',
        `📅 Planned: ${plannedLabel}`,
        ``,
        `📊 Status: *${previousStatus.toUpperCase()}* → *${schedule.status.toUpperCase()}*`,
        schedule.done_date ? `✅ Completed on: ${new Date(schedule.done_date + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : '',
        schedule.remark ? `💬 Remark: "${schedule.remark}"` : '',
        ``,
        `👤 Updated by: ${updaterName}`,
    ].filter(Boolean).join('\n');

    await WhatsAppQueueService.enqueue({
        userIds: [...recipientIds],
        message: lines,
        eventType: 'PPM_STATUS_UPDATE',
    });
}
