import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';

// GET /api/feedback — List feedback tickets
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const type = searchParams.get('type');
        const orgId = searchParams.get('org_id');
        const limit = parseInt(searchParams.get('limit') || '50');

        // Use admin client to bypass RLS for fetching (we'll filter manually)
        const admin = createAdminClient();

        let query = admin
            .from('feedback_tickets')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) query = query.eq('status', status);
        if (type) query = query.eq('type', type);
        if (orgId) query = query.eq('organization_id', orgId);

        const { data, error } = await query;

        if (error) {
            if (error.code === 'PGRST205' || error.message?.includes('feedback_tickets')) {
                console.warn('[Feedback GET] feedback_tickets table not found in schema cache. Returning empty list.');
                return NextResponse.json({ data: [] });
            }
            console.error('[Feedback GET] Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data: data || [] });
    } catch (err: any) {
        console.error('[Feedback GET] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/feedback — Submit new feedback
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();

        const {
            type,               // 'bug' | 'feature'
            error_text,         // Bug: error message text
            error_page_url,     // Bug: URL where error occurred
            error_category,     // Bug: category
            severity,           // Bug: severity level
            feature_description,// Feature: what to build
            target_module,      // Feature: which module
            acceptance_criteria,// Feature: done criteria
            priority,           // Feature: priority
            attachments,        // Array of storage URLs
            property_id,        // Optional property context
            organization_id,    // Required org context
        } = body;

        if (!type || !['bug', 'feature'].includes(type)) {
            return NextResponse.json({ error: 'Type must be "bug" or "feature"' }, { status: 400 });
        }

        if (type === 'bug' && !error_text) {
            return NextResponse.json({ error: 'Bug reports require error_text' }, { status: 400 });
        }

        if (type === 'feature' && !feature_description) {
            return NextResponse.json({ error: 'Feature requests require feature_description' }, { status: 400 });
        }

        // Use admin client to insert (bypasses RLS for reliable insert)
        const admin = createAdminClient();

        const insertData = {
            type,
            status: 'pending',
            submitted_by: user.id,
            submitted_by_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
            submitted_by_role: user.user_metadata?.role || 'user',
            property_id: property_id || null,
            organization_id: organization_id || null,
            error_text: type === 'bug' ? error_text : null,
            error_page_url: type === 'bug' ? (error_page_url || null) : null,
            error_category: type === 'bug' ? (error_category || 'other') : null,
            severity: type === 'bug' ? (severity || 'medium') : null,
            feature_description: type === 'feature' ? feature_description : null,
            target_module: type === 'feature' ? (target_module || null) : null,
            acceptance_criteria: type === 'feature' ? (acceptance_criteria || null) : null,
            priority: type === 'feature' ? (priority || 'medium') : null,
            attachments: attachments || [],
        };

        const { data, error } = await admin
            .from('feedback_tickets')
            .insert(insertData)
            .select()
            .single();

        // Send email notification to admins
        const recipientEmails = 'lohitexplores@gmail.com, harshrp2309@gmail.com';
        
        const attachmentsHtml = insertData.attachments && insertData.attachments.length > 0 
            ? `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Attached Screenshots (${insertData.attachments.length})</div>
                <div>
                    ${insertData.attachments.map((att: string, idx: number) => {
                        const isBase64 = att.startsWith('data:image');
                        if (isBase64) {
                            return `<div style="margin-bottom: 12px;"><img src="${att}" alt="Screenshot ${idx + 1}" style="max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid #cbd5e1; display: block;" /></div>`;
                        } else {
                            return `<div style="margin-bottom: 8px;"><a href="${att}" target="_blank" style="display: inline-block; padding: 8px 14px; background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; color: #2563eb; font-weight: 600; font-size: 13px; text-decoration: none;">View Screenshot ${idx + 1} ↗</a></div>`;
                        }
                    }).join('')}
                </div>
            </div>` 
            : '';

        const emailHtmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border-radius: 12px;">
                <div style="background-color: #ffffff; padding: 24px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="border-bottom: 2px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px;">
                        <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 700;">
                            New User Feedback (${type.toUpperCase()})
                        </h2>
                    </div>

                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155; margin-bottom: 20px;">
                        <tr>
                            <td style="padding: 6px 0; font-weight: 600; color: #64748b; width: 130px;">Submitted By:</td>
                            <td style="padding: 6px 0; font-weight: 700; color: #0f172a;">${insertData.submitted_by_name} <span style="font-weight: 400; color: #64748b;">(${user.email})</span></td>
                        </tr>
                        ${insertData.error_category || insertData.target_module ? `
                        <tr>
                            <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Category:</td>
                            <td style="padding: 6px 0; font-weight: 700; text-transform: capitalize; color: #2563eb;">${insertData.error_category || insertData.target_module}</td>
                        </tr>` : ''}
                    </table>

                    <div style="margin-bottom: 20px;">
                        <div style="font-weight: 700; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Description & Details</div>
                        <div style="background-color: #f1f5f9; padding: 14px; border-radius: 8px; border-left: 4px solid #3b82f6; font-size: 14px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${insertData.error_text || insertData.feature_description || 'No description provided.'}</div>
                    </div>

                    ${attachmentsHtml}

                    <div style="border-top: 1px solid #e2e8f0; pt: 16px; margin-top: 24px; text-align: center; color: #94a3b8; font-size: 12px;">
                        Autopilot FMS User Feedback Notification System
                    </div>
                </div>
            </div>
        `;

        EmailService.sendGenericNotificationEmail({
            emailTo: recipientEmails,
            subject: `[New Feedback] ${type.toUpperCase()}: ${insertData.submitted_by_name}`,
            title: `New User Feedback (${type.toUpperCase()})`,
            htmlBody: emailHtmlBody
        }).catch(e => console.error('[Feedback Email Error]', e));

        if (error) {
            console.error('[Feedback POST] DB Insert Error:', error);
            // If table does not exist or schema cache issue, return success fallback so user experience isn't blocked
            if (error.message?.includes('schema cache') || error.code === '42P01' || error.code === 'PGRST205') {
                return NextResponse.json({ 
                    data: { ...insertData, id: 'fallback-' + Date.now() },
                    warning: 'Saved via email fallback while database table is being created.'
                }, { status: 201 });
            }
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data }, { status: 201 });
    } catch (err: any) {
        console.error('[Feedback POST] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
