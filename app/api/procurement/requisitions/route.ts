import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { EventProcessor } from '@/backend/services/EventProcessor';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organization_id');
        const propertyId = searchParams.get('property_id');
        const requisitionMonth = searchParams.get('requisition_month');
        const requisitionYear = searchParams.get('requisition_year');
        const status = searchParams.get('status');

        const adminSupabase = createAdminClient();

        let query = adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .order('created_at', { ascending: false });

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }
        if (propertyId && propertyId !== 'all') {
            query = query.eq('property_id', propertyId);
        }
        if (requisitionMonth && requisitionMonth !== 'all') {
            query = query.eq('requisition_month', parseInt(requisitionMonth));
        }
        if (requisitionYear && requisitionYear !== 'all') {
            query = query.eq('requisition_year', parseInt(requisitionYear));
        }
        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[Requisitions GET Error]:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ requisitions: data || [] });
    } catch (err: any) {
        console.error('[Requisitions GET Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const adminSupabase = createAdminClient();

        // Ensure bucket exists
        const { data: bucket, error: bucketErr } = await adminSupabase.storage.getBucket('procurement_requisitions');
        if (bucketErr) {
            const { error: createErr } = await adminSupabase.storage.createBucket('procurement_requisitions', {
                public: true,
                allowedMimeTypes: [
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'text/csv',
                    'application/csv',
                    'application/octet-stream',
                    'text/plain'
                ],
            });
            if (createErr && !createErr.message?.includes('already exists')) {
                console.error('[Requisitions Storage Bucket Create Error]:', createErr);
            }
        }

        const form = await request.formData();
        const file = form.get('file') as File | null;
        const organizationId = form.get('organization_id') as string;
        const propertyId = form.get('property_id') as string;
        const requisitionMonth = parseInt(form.get('requisition_month') as string || '0');
        const requisitionYear = parseInt(form.get('requisition_year') as string || '0');
        const notes = form.get('notes') as string || '';
        const userId = form.get('user_id') as string;

        if (!file || !organizationId || !propertyId || !requisitionMonth || !requisitionYear || !userId) {
            return NextResponse.json({ error: 'Missing required fields: file, organization_id, property_id, requisition_month, requisition_year, user_id' }, { status: 400 });
        }

        // Upload file to Supabase storage
        const filePath = `${organizationId}/${propertyId}/${requisitionYear}_${requisitionMonth}_${Date.now()}_${file.name}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { data: uploadData, error: uploadError } = await adminSupabase.storage
            .from('procurement_requisitions')
            .upload(filePath, buffer, { upsert: true, contentType: file.type || 'application/octet-stream' });

        if (uploadError) {
            console.error('[Requisition Upload Storage Error]:', uploadError);
            return NextResponse.json({ error: 'Failed to upload file to storage', details: uploadError.message }, { status: 500 });
        }

        const publicUrl = adminSupabase.storage.from('procurement_requisitions').getPublicUrl(uploadData.path).data.publicUrl;

        // Insert or Upsert into property_monthly_requisitions table
        const { data: insertedRecord, error: insertError } = await adminSupabase
            .from('property_monthly_requisitions')
            .upsert(
                {
                    organization_id: organizationId,
                    property_id: propertyId,
                    requisition_month: requisitionMonth,
                    requisition_year: requisitionYear,
                    file_url: publicUrl,
                    file_name: file.name,
                    file_size_bytes: file.size,
                    notes,
                    status: 'uploaded',
                    uploaded_by: userId,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'property_id,requisition_month,requisition_year' }
            )
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email)
            `)
            .single();

        if (insertError) {
            console.error('[Requisition Insert Error]:', insertError);
            return NextResponse.json({ error: 'Failed to save requisition metadata', details: insertError.message }, { status: 500 });
        }

        // Process event strictly via event_outbox queue (supports mobile app, web app, and direct inserts without duplicates)
        (async () => {
            try {
                const { data: outboxEvent } = await adminSupabase
                    .from('event_outbox')
                    .update({ status: 'processing', updated_at: new Date().toISOString() })
                    .eq('entity_id', insertedRecord.id)
                    .eq('event_type', 'REQUISITION_UPLOADED')
                    .in('status', ['pending', 'retry'])
                    .select()
                    .maybeSingle();

                if (outboxEvent) {
                    await EventProcessor.processEvent(outboxEvent);
                    await adminSupabase
                        .from('event_outbox')
                        .update({ status: 'completed', updated_at: new Date().toISOString() })
                        .eq('id', outboxEvent.id);
                }
            } catch (e) {
                console.error('[Requisition Outbox Processing Error]:', e);
            }
        })();

        return NextResponse.json({ success: true, requisition: insertedRecord }, { status: 201 });
    } catch (err: any) {
        console.error('[Requisitions POST Server Error]:', err);
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}
