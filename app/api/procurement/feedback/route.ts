import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const {
            organization_id,
            property_id,
            month,
            year,
            hk_received_as_approved,
            hk_received_remark,
            hk_material_quality,
            hk_quality_remark,
            manpower_quality_satisfaction,
            manpower_quality_remark,
            manpower_reliever_on_time,
            manpower_reliever_remark,
            amc_service_report_on_time,
            amc_report_remark,
            amc_services_on_schedule,
            amc_schedule_remark,
            remarks
        } = body;

        if (!property_id || !month || !year) {
            return NextResponse.json({ error: 'Property, Month, and Year are required.' }, { status: 400 });
        }

        if (!['Yes', 'No'].includes(hk_received_as_approved) ||
            !['High', 'Medium', 'Low'].includes(hk_material_quality) ||
            !['Good', 'Average', 'Poor'].includes(manpower_quality_satisfaction) ||
            !['Yes', 'No'].includes(manpower_reliever_on_time) ||
            !['Yes', 'No'].includes(amc_service_report_on_time) ||
            !['Yes', 'No'].includes(amc_services_on_schedule)) {
            return NextResponse.json({ error: 'Invalid response option selected.' }, { status: 400 });
        }

        const has_negative_issues = (
            hk_received_as_approved === 'No' ||
            hk_material_quality === 'Low' ||
            manpower_quality_satisfaction === 'Poor' ||
            manpower_reliever_on_time === 'No' ||
            amc_service_report_on_time === 'No' ||
            amc_services_on_schedule === 'No'
        );

        // Fetch organization_id from property if not explicitly provided
        let targetOrgId = organization_id;
        if (!targetOrgId) {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('organization_id')
                .eq('id', property_id)
                .single();
            targetOrgId = prop?.organization_id || null;
        }

        const payload: Record<string, any> = {
            organization_id: targetOrgId,
            property_id,
            month: Number(month),
            year: Number(year),
            submitted_by: user.id,
            hk_received_as_approved,
            hk_material_quality,
            manpower_quality_satisfaction,
            manpower_reliever_on_time,
            amc_service_report_on_time,
            amc_services_on_schedule,
            hk_received_remark: hk_received_remark ? String(hk_received_remark).trim() : null,
            hk_quality_remark: hk_quality_remark ? String(hk_quality_remark).trim() : null,
            manpower_quality_remark: manpower_quality_remark ? String(manpower_quality_remark).trim() : null,
            manpower_reliever_remark: manpower_reliever_remark ? String(manpower_reliever_remark).trim() : null,
            amc_report_remark: amc_report_remark ? String(amc_report_remark).trim() : null,
            amc_schedule_remark: amc_schedule_remark ? String(amc_schedule_remark).trim() : null,
            has_negative_issues,
            remarks: remarks ? String(remarks).trim() : null,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabaseAdmin
            .from('monthly_requisition_feedback')
            .insert(payload)
            .select('*, properties(name), submitter:users!submitted_by(full_name, email)')
            .single();

        if (error) {
            if (error.code === '23505') {
                return NextResponse.json({
                    error: `Monthly feedback for this property has already been submitted for ${month}/${year}.`
                }, { status: 409 });
            }
            console.error('[API procurement/feedback] Insert error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Trigger Omnichannel notifications asynchronously
        if (data?.id) {
            NotificationService.afterMonthlyFeedbackSubmitted(data.id).catch((err: any) => {
                console.error('[API procurement/feedback] Notification trigger error:', err);
            });
        }

        return NextResponse.json({ success: true, data }, { status: 201 });
    } catch (err: any) {
        console.error('[API procurement/feedback POST] Internal error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const propertyId = searchParams.get('propertyId') || searchParams.get('property_id');
        const month = searchParams.get('month');
        const year = searchParams.get('year');
        const hasIssues = searchParams.get('hasIssues') || searchParams.get('has_issues');
        const orgId = searchParams.get('organizationId') || searchParams.get('organization_id');

        let query = supabaseAdmin
            .from('monthly_requisition_feedback')
            .select(`
                *,
                properties (id, name),
                submitter:users!submitted_by (id, full_name, email)
            `)
            .order('created_at', { ascending: false });

        if (propertyId) {
            query = query.eq('property_id', propertyId);
        }
        if (orgId) {
            query = query.eq('organization_id', orgId);
        }
        if (month) {
            query = query.eq('month', Number(month));
        }
        if (year) {
            query = query.eq('year', Number(year));
        }
        if (hasIssues === 'true') {
            query = query.eq('has_negative_issues', true);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[API procurement/feedback GET] Query error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const items: any[] = data || [];
        const total = items.length;
        const negativeCount = items.filter(i => i.has_negative_issues).length;
        const hkOkCount = items.filter(i => i.hk_received_as_approved === 'Yes' && i.hk_material_quality !== 'Low').length;
        const manpowerOkCount = items.filter(i => i.manpower_quality_satisfaction !== 'Poor' && i.manpower_reliever_on_time === 'Yes').length;
        const amcOkCount = items.filter(i => i.amc_service_report_on_time === 'Yes' && i.amc_services_on_schedule === 'Yes').length;

        const hkOkPercent = total > 0 ? Math.round((hkOkCount / total) * 100) : 100;
        const manpowerOkPercent = total > 0 ? Math.round((manpowerOkCount / total) * 100) : 100;
        const amcOkPercent = total > 0 ? Math.round((amcOkCount / total) * 100) : 100;

        const stats = {
            total,
            negativeCount,
            hkOkPercent,
            manpowerOkPercent,
            amcOkPercent,
        };

        return NextResponse.json({ success: true, data: items, stats });
    } catch (err: any) {
        console.error('[API procurement/feedback GET] Internal error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
