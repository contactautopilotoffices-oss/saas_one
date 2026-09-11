import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();
        const userFilter = user.email
            ? `user_id.eq.${user.id},email.eq.${user.email}`
            : `user_id.eq.${user.id}`;

        const [dbUserRes, empProfileRes] = await Promise.all([
            adminSupabase.from('users').select('*').eq('id', user.id).maybeSingle(),
            adminSupabase.from('employee_profiles').select('*, reporting_manager:users!reporting_manager_id(id, email, raw_user_meta_data)').or(userFilter).maybeSingle()
        ]);

        const dbUser = dbUserRes.data;
        const empProfile = empProfileRes.data;

        // Auto-link user_id on employee_profile if matched by email but user_id is null
        if (empProfile && !empProfile.user_id) {
            adminSupabase
                .from('employee_profiles')
                .update({ user_id: user.id, reconciliation_status: 'linked' })
                .eq('id', empProfile.id)
                .then(() => {});
        }

        let reportingManagerName: string | null = null;
        if (empProfile) {
            const repMgr: any = empProfile.reporting_manager;
            const repMgrObj = Array.isArray(repMgr) ? repMgr[0] : repMgr;
            if (repMgrObj?.full_name) {
                reportingManagerName = repMgrObj.full_name;
            } else if (repMgrObj?.raw_user_meta_data?.full_name) {
                reportingManagerName = repMgrObj.raw_user_meta_data.full_name;
            }

            if (!reportingManagerName && empProfile.reporting_manager_id) {
                // 1. Check users table by ID
                const { data: mgrUser } = await adminSupabase
                    .from('users')
                    .select('full_name')
                    .eq('id', empProfile.reporting_manager_id)
                    .maybeSingle();
                if (mgrUser?.full_name) {
                    reportingManagerName = mgrUser.full_name;
                } else {
                    // 2. Check employee_profiles table by ID
                    const { data: mgrEmpProf } = await adminSupabase
                        .from('employee_profiles')
                        .select('first_name, last_name, employee_code, user:users!user_id(full_name)')
                        .eq('id', empProfile.reporting_manager_id)
                        .maybeSingle();
                    if (mgrEmpProf) {
                        const uObj: any = mgrEmpProf.user;
                        const uName = Array.isArray(uObj) ? uObj[0]?.full_name : uObj?.full_name;
                        const baseName = uName || `${mgrEmpProf.first_name || ''} ${mgrEmpProf.last_name || ''}`.trim();
                        if (baseName) {
                            reportingManagerName = mgrEmpProf.employee_code ? `${baseName} (${mgrEmpProf.employee_code})` : baseName;
                        }
                    }
                }
            }

            if (!reportingManagerName && empProfile.reporting_manager_code) {
                const { data: mgrProf } = await adminSupabase
                    .from('employee_profiles')
                    .select('first_name, last_name, employee_code, user:users!user_id(full_name)')
                    .eq('employee_code', empProfile.reporting_manager_code)
                    .maybeSingle();
                if (mgrProf) {
                    const uObj: any = mgrProf.user;
                    const uName = Array.isArray(uObj) ? uObj[0]?.full_name : uObj?.full_name;
                    const baseName = uName || `${mgrProf.first_name || ''} ${mgrProf.last_name || ''}`.trim();
                    if (baseName) {
                        reportingManagerName = mgrProf.employee_code ? `${baseName} (${mgrProf.employee_code})` : baseName;
                    }
                }
            }
        }

        return NextResponse.json({
            id: user.id,
            email: user.email,
            full_name: dbUser?.full_name || (empProfile ? `${empProfile.first_name || ''} ${empProfile.last_name || ''}`.trim() : '') || user.user_metadata?.full_name || '',
            phone: dbUser?.phone || empProfile?.phone || user.user_metadata?.phone || '',
            role: dbUser?.role || user.user_metadata?.role || '',
            employee_code: empProfile?.employee_code || user.user_metadata?.employee_code || null,
            department: empProfile?.department || null,
            designation: empProfile?.designation || null,
            location: empProfile?.location || null,
            reporting_manager_name: reportingManagerName,
            user_metadata: user.user_metadata
        });
    } catch (err: any) {
        console.error('Error fetching user profile:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        // Strictly unpack allowed fields — reporting_manager_id is intentionally excluded & blocked!
        const { full_name, phone, employee_code, department, designation, location } = body;

        const cleanName = full_name !== undefined ? String(full_name).trim() : undefined;
        let cleanPhone = phone !== undefined ? String(phone).replace(/[^0-9+]/g, '').trim() : undefined;
        const cleanECode = employee_code !== undefined ? String(employee_code).trim().toUpperCase() : undefined;

        const adminSupabase = createAdminClient();

        // 1. Update public.users table
        const updateData: any = {};
        if (cleanName !== undefined) updateData.full_name = cleanName;
        if (cleanPhone !== undefined) updateData.phone = cleanPhone;

        let updatedDbUser = null;
        if (Object.keys(updateData).length > 0) {
            const { data: uData, error: updateError } = await adminSupabase
                .from('users')
                .update(updateData)
                .eq('id', user.id)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating public.users table:', updateError);
                return NextResponse.json({ error: 'Failed to update database profile: ' + updateError.message }, { status: 500 });
            }
            updatedDbUser = uData;
        }

        // 2. Sync to employee_profiles
        const empUpdates: any = { updated_at: new Date().toISOString() };
        if (cleanName !== undefined) {
            const parts = cleanName.split(' ');
            empUpdates.first_name = parts[0];
            empUpdates.last_name = parts.slice(1).join(' ') || '';
        }
        if (cleanPhone !== undefined) empUpdates.phone = cleanPhone;
        if (cleanECode !== undefined) empUpdates.employee_code = cleanECode;
        if (department !== undefined) empUpdates.department = department;
        if (designation !== undefined) empUpdates.designation = designation;
        if (location !== undefined) empUpdates.location = location;

        const userFilter = user.email
            ? `user_id.eq.${user.id},email.eq.${user.email}`
            : `user_id.eq.${user.id}`;

        const { data: existingProf } = await adminSupabase
            .from('employee_profiles')
            .select('id')
            .or(userFilter)
            .maybeSingle();

        if (existingProf) {
            await adminSupabase
                .from('employee_profiles')
                .update({ ...empUpdates, user_id: user.id })
                .eq('id', existingProf.id);
        } else if (cleanECode || cleanName) {
            const defaultEmailPrefix = user.email ? user.email.split('@')[0] : 'employee';
            const parts = (cleanName || defaultEmailPrefix).split(' ');
            await adminSupabase
                .from('employee_profiles')
                .insert({
                    user_id: user.id,
                    employee_code: cleanECode || `E${Math.floor(100 + Math.random() * 900)}`,
                    first_name: parts[0] || 'Employee',
                    last_name: parts.slice(1).join(' ') || '',
                    email: user.email || '',
                    phone: cleanPhone || null,
                    department: department || 'Operations',
                    designation: designation || 'Executive',
                    location: location || 'Lower Parel',
                    reconciliation_status: 'linked',
                    is_active: true
                });
        }

        // 3. Sync to Supabase Auth User metadata
        try {
            await adminSupabase.auth.admin.updateUserById(user.id, {
                user_metadata: {
                    ...(user.user_metadata || {}),
                    ...(cleanName !== undefined ? { full_name: cleanName } : {}),
                    ...(cleanPhone !== undefined ? { phone: cleanPhone } : {}),
                    ...(cleanECode !== undefined ? { employee_code: cleanECode } : {})
                }
            });
        } catch (authSyncErr) {
            console.warn('Warning updating auth user metadata:', authSyncErr);
        }

        return NextResponse.json({
            success: true,
            user: updatedDbUser,
            employee_code: cleanECode
        });
    } catch (err: any) {
        console.error('Error updating user profile:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
