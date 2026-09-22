import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId');
        const userId = searchParams.get('userId');
        const role = (searchParams.get('role') || 'employee').toLowerCase();
        const noteType = searchParams.get('type') || 'all'; // 'all' | 'internal' | 'public'
        const search = searchParams.get('search')?.trim().toLowerCase() || '';

        if (!orgId) {
            return NextResponse.json({ success: false, error: 'Organization ID is required' }, { status: 400 });
        }

        // Fetch comments with their associated ticket details
        let query = supabaseAdmin
            .from('hr_ticket_comments')
            .select(`
                id,
                ticket_id,
                sender_user_id,
                sender_name,
                content,
                attachment_urls,
                is_internal,
                created_at,
                sender:users!sender_user_id(id, email, full_name),
                ticket:hr_tickets!ticket_id(
                    id,
                    ticket_number,
                    organization_id,
                    subject,
                    status,
                    ticket_type,
                    current_level,
                    is_confidential,
                    is_anonymous,
                    employee_snapshot,
                    raised_by_user_id,
                    assigned_to_user_id,
                    assigned_history,
                    category:hr_ticket_categories!category_id(category_name),
                    raised_by:users!raised_by_user_id(id, email, full_name)
                )
            `)
            .order('created_at', { ascending: false })
            .limit(200);

        if (noteType === 'internal') {
            query = query.eq('is_internal', true);
        } else if (noteType === 'public') {
            query = query.eq('is_internal', false);
        }

        const { data: comments, error } = await query;
        if (error) throw error;

        // Fetch author employee profile details (photo & designation)
        const authorUserIds = Array.from(
            new Set((comments || []).map((c: any) => c.sender_user_id).filter(Boolean))
        );
        const empProfileMap = new Map<string, any>();
        if (authorUserIds.length > 0) {
            const { data: empProfiles } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id, designation, user_photo_url, avatar_url, first_name, last_name')
                .in('user_id', authorUserIds);

            (empProfiles || []).forEach((ep: any) => {
                if (ep.user_id) empProfileMap.set(ep.user_id, ep);
            });
        }

        // Filter and sanitize by organization and role permissions
        const isSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin'].includes((role || '').toLowerCase());
        const isDirector = role === 'director';
        const includeSubmitter = searchParams.get('includeSubmitter') === 'true';

        const filtered = (comments || [])
            .filter((c: any) => {
                const t = c.ticket;
                if (!t || t.organization_id !== orgId) return false;

                // Exclude comments posted by the ticket submitter (employee side) unless includeSubmitter is requested
                if (!includeSubmitter && !c.is_internal) {
                    const isRaisedBySender = 
                        (c.sender_user_id && t.raised_by_user_id && c.sender_user_id === t.raised_by_user_id) ||
                        (c.sender?.email && t.raised_by?.email && c.sender.email.toLowerCase() === t.raised_by.email.toLowerCase());
                    if (isRaisedBySender) return false;
                }

                // Anonymity / confidentiality guard
                const isConfidential = Boolean(t.is_confidential) || t.ticket_type === 'confidential_feedback' || t.ticket_type === 'confidential';
                const isAnon = Boolean(t.is_anonymous) || t.ticket_type === 'anonymous_feedback';

                if (isConfidential || isAnon) {
                    if (isSuperAdmin || isDirector) return true;
                    // For all other roles (including HR): only visible if assigned to that user
                    if (userId && (t.assigned_to_user_id === userId || (Array.isArray(t.assigned_history) && t.assigned_history.includes(userId)))) {
                        return true;
                    }
                    return false;
                }

                return true;
            })
            .map((c: any) => {
                const t = c.ticket;
                const isAnon = Boolean(t.is_anonymous);
                const authorEmp = c.sender_user_id ? empProfileMap.get(c.sender_user_id) : null;
                const senderPhoto = authorEmp?.user_photo_url || authorEmp?.avatar_url || null;

                return {
                    id: c.id,
                    ticket_id: t.id,
                    ticket_number: t.ticket_number,
                    ticket_subject: t.subject,
                    ticket_type: t.ticket_type,
                    ticket_status: t.status,
                    ticket_level: t.current_level,
                    ticket_category: (t.category as any)?.category_name || 'HR Request',
                    is_confidential: Boolean(t.is_confidential),
                    is_anonymous: isAnon,
                    submitter_name: isAnon ? 'Anonymous Employee' : (t.employee_snapshot?.name || t.raised_by?.full_name || 'Employee'),
                    submitter_department: isAnon ? 'Confidential' : (t.employee_snapshot?.department || 'Operations'),
                    submitter_location: isAnon ? 'Hidden' : (t.employee_snapshot?.location || 'Head Office'),
                    author_id: c.sender_user_id,
                    author_name: c.sender?.full_name || (authorEmp ? `${authorEmp.first_name || ''} ${authorEmp.last_name || ''}`.trim() : null) || c.sender_name || 'HR Handler',
                    author_email: c.sender?.email || '',
                    author_photo: senderPhoto,
                    author_role: authorEmp?.designation || (c.is_internal ? 'HR Handler (Internal)' : 'HR Team'),
                    content: c.content,
                    attachment_urls: c.attachment_urls || [],
                    is_internal: Boolean(c.is_internal),
                    created_at: c.created_at
                };
            });

        // Apply search keyword filter if provided
        const results = search
            ? filtered.filter(item => 
                item.content.toLowerCase().includes(search) ||
                item.ticket_number.toLowerCase().includes(search) ||
                item.ticket_subject.toLowerCase().includes(search) ||
                item.author_name.toLowerCase().includes(search) ||
                item.submitter_name.toLowerCase().includes(search) ||
                item.ticket_category.toLowerCase().includes(search)
            )
            : filtered;

        return NextResponse.json({
            success: true,
            total: results.length,
            data: results
        });
    } catch (err: any) {
        console.error('[HR Notes API Error]:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
