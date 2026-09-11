import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
    try {
        // Fetch all employee profiles
        const { data: profiles, error: profErr } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!user_id(id, email, full_name, phone),
                reporting_manager:users!reporting_manager_id(id, email, full_name, phone)
            `)
            .order('employee_code', { ascending: true });

        if (profErr) throw profErr;

        // Fetch memberships to identify tenant, super_tenant, and vendor users to exclude from HR
        const EXCLUDED_HR_ROLES = new Set(['tenant', 'super_tenant', 'tenant_admin', 'vendor', 'maintenance_vendor']);

        const [orgMemsRes, propMemsRes, appUsersRes] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id, role'),
            supabaseAdmin.from('property_memberships').select('user_id, role'),
            supabaseAdmin.from('users').select('id, email, phone, full_name, created_at')
        ]);

        const excludedUserIds = new Set<string>();
        (orgMemsRes.data || []).forEach(m => { if (EXCLUDED_HR_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });
        (propMemsRes.data || []).forEach(m => { if (EXCLUDED_HR_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });

        let profilesList = (profiles || []).filter(p => !p.user_id || !excludedUserIds.has(p.user_id));
        const eligibleAppUsers = (appUsersRes.data || []).filter(u => !excludedUserIds.has(u.id));

        // Perform auto-linking for matching unlinked profiles
        if (eligibleAppUsers.length > 0 && profilesList.length > 0) {
            const updatesToPersist: { id: string; user_id: string }[] = [];

            for (const p of profilesList) {
                if (!p.user_id) {
                    const pName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().trim();
                    const pEmail = (p.email || '').toLowerCase().trim();
                    const pPhone = (p.phone || p.contact_number || '').replace(/\D/g, '');

                    const match = eligibleAppUsers.find(u => {
                        const uEmail = (u.email || '').toLowerCase().trim();
                        const uPhone = (u.phone || '').replace(/\D/g, '');
                        const uName = (u.full_name || '').toLowerCase().trim();

                        return (uEmail && pEmail && uEmail === pEmail) ||
                               (uPhone && pPhone && uPhone.length >= 10 && uPhone === pPhone) ||
                               (uName && pName && uName.length >= 5 && uName === pName);
                    });

                    if (match) {
                        p.user_id = match.id;
                        p.reconciliation_status = 'linked';
                        p.user = match;
                        updatesToPersist.push({ id: p.id, user_id: match.id });
                    }
                }
            }

            if (updatesToPersist.length > 0) {
                Promise.all(updatesToPersist.map(u =>
                    supabaseAdmin
                        .from('employee_profiles')
                        .update({ user_id: u.user_id, reconciliation_status: 'linked', updated_at: new Date().toISOString() })
                        .eq('id', u.id)
                )).catch(err => console.error('Error persisting reconcile auto-links:', err));
            }
        }

        const linkedProfiles = profilesList.filter(p => p.reconciliation_status === 'linked' || p.user_id !== null);
        const unlinkedProfiles = profilesList.filter(p => p.reconciliation_status === 'unlinked' && p.user_id === null);
        const pendingApprovalProfiles = profilesList.filter(p => p.reconciliation_status === 'pending_approval');

        // Users in app who aren't mapped to any employee profile
        const mappedUserIds = new Set(profilesList.map(p => p.user_id).filter(Boolean));
        const unmappedAppUsers = eligibleAppUsers.filter(u => !mappedUserIds.has(u.id));

        return NextResponse.json({
            success: true,
            summary: {
                total_excel_records: profilesList.length,
                total_app_users: eligibleAppUsers.length,
                linked_count: linkedProfiles.length,
                unlinked_count: unlinkedProfiles.length,
                pending_approval_count: pendingApprovalProfiles.length,
                unmapped_app_users_count: unmappedAppUsers.length
            },
            data: {
                linked: linkedProfiles,
                unlinked: unlinkedProfiles,
                pending_approval: pendingApprovalProfiles,
                unmapped_app_users: unmappedAppUsers
            }
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, employee_profile_id, user_id, reporting_manager_id } = body;

        if (action === 'approve_onboarding') {
            // Approve onboarding employee: Link app user_id to employee_profile & assign reporting manager
            if (!employee_profile_id || !user_id) {
                return NextResponse.json({ success: false, error: 'employee_profile_id and user_id are required' }, { status: 400 });
            }

            const updates: any = {
                user_id,
                reconciliation_status: 'linked',
                updated_at: new Date().toISOString()
            };
            if (reporting_manager_id) updates.reporting_manager_id = reporting_manager_id;

            const { data: updated, error } = await supabaseAdmin
                .from('employee_profiles')
                .update(updates)
                .eq('id', employee_profile_id)
                .select()
                .single();

            if (error) throw error;

            return NextResponse.json({ success: true, message: 'Employee onboarding approved and linked successfully', data: updated });
        } else if (action === 'manual_link') {
            // Manually link an Excel profile to an App User
            if (!employee_profile_id || !user_id) {
                return NextResponse.json({ success: false, error: 'employee_profile_id and user_id are required' }, { status: 400 });
            }

            const { data: updated, error } = await supabaseAdmin
                .from('employee_profiles')
                .update({ user_id, reconciliation_status: 'linked', updated_at: new Date().toISOString() })
                .eq('id', employee_profile_id)
                .select()
                .single();

            if (error) throw error;

            return NextResponse.json({ success: true, message: 'User manually linked', data: updated });
        } else if (action === 'create_and_link_profile') {
            // Create a new employee_profile record for an existing unmapped app user and assign an ECode
            if (!user_id) {
                return NextResponse.json({ success: false, error: 'user_id is required' }, { status: 400 });
            }

            // Fetch app user details
            const { data: userObj, error: userFetchErr } = await supabaseAdmin
                .from('users')
                .select('id, email, phone, full_name')
                .eq('id', user_id)
                .single();

            if (userFetchErr || !userObj) {
                return NextResponse.json({ success: false, error: 'App user not found' }, { status: 404 });
            }

            const fullName = userObj.full_name || userObj.email.split('@')[0];
            const nameParts = fullName.split(' ');
            const firstName = nameParts[0] || 'Employee';
            const lastName = nameParts.slice(1).join(' ') || '';
            const generatedECode = body.employee_code || `E${Math.floor(100 + Math.random() * 900)}`;

            const { data: newProf, error: insErr } = await supabaseAdmin
                .from('employee_profiles')
                .insert({
                    user_id: userObj.id,
                    employee_code: generatedECode,
                    first_name: firstName,
                    last_name: lastName,
                    email: userObj.email,
                    phone: userObj.phone || null,
                    department: body.department || 'Operations',
                    designation: body.designation || 'Executive',
                    location: body.location || 'Lower Parel',
                    reporting_manager_id: reporting_manager_id || null,
                    reconciliation_status: 'linked',
                    is_active: true
                })
                .select()
                .single();

            if (insErr) throw insErr;

            return NextResponse.json({ success: true, message: `Profile created with ECode ${generatedECode} and linked to app user`, data: newProf });
        }

        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
