import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('organization_id');

        let query = supabaseAdmin
            .from('employee_profiles')
            .select(`
                id,
                employee_code,
                first_name,
                last_name,
                email,
                department,
                designation,
                user_id,
                is_hr_authority,
                is_director_authority,
                reconciliation_status
            `)
            .order('first_name', { ascending: true });

        if (orgId) {
            query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }

        let { data: rawProfiles, error } = await query;
        if (error) console.error('Error fetching employee profiles:', error);

        let profiles = (rawProfiles || []).map(p => ({
            ...p,
            full_name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || 'Employee'
        }));

        // Fallback: If employee_profiles is empty, fetch users from users table
        if (!profiles || profiles.length === 0) {
            const { data: usersData } = await supabaseAdmin.from('users').select('id, email, full_name, phone');
            if (usersData && usersData.length > 0) {
                profiles = usersData.map((u: any, idx: number) => ({
                    id: u.id,
                    user_id: u.id,
                    employee_code: `EMP-${100 + idx}`,
                    first_name: u.full_name ? u.full_name.split(' ')[0] : 'User',
                    last_name: u.full_name ? u.full_name.split(' ').slice(1).join(' ') : '',
                    full_name: u.full_name || u.email || `Employee ${idx + 1}`,
                    email: u.email,
                    department: 'General',
                    designation: 'Staff',
                    is_hr_authority: false,
                    is_director_authority: false
                })) as any;
            }
        }

        const hrManagers = (profiles || []).filter(p => (p as any).is_hr_manager_authority === true);
        const hrHeads = (profiles || []).filter(p => p.is_hr_authority === true);
        const directors = (profiles || []).filter(p => p.is_director_authority === true);

        return NextResponse.json({
            success: true,
            data: {
                employees: profiles || [],
                designated_hr_managers: hrManagers,
                designated_hr_heads: hrHeads,
                designated_directors: directors,
                designated_hr_head: hrHeads[0] || null,
                designated_director: directors[0] || null
            }
        });
    } catch (err: any) {
        console.error('Error in GET escalation-config:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            hr_manager_profile_ids,
            hr_head_profile_ids,
            director_profile_ids,
            hr_head_profile_id,
            director_profile_id
        } = body;

        const hrManagerIds: string[] = Array.isArray(hr_manager_profile_ids)
            ? hr_manager_profile_ids
            : [];

        const hrHeadIds: string[] = Array.isArray(hr_head_profile_ids)
            ? hr_head_profile_ids
            : (hr_head_profile_id ? [hr_head_profile_id] : []);

        const directorIds: string[] = Array.isArray(director_profile_ids)
            ? director_profile_ids
            : (director_profile_id ? [director_profile_id] : []);

        // 1. Reset & update HR Manager authority flags (try-catch)
        try {
            await supabaseAdmin
                .from('employee_profiles')
                .update({ is_hr_manager_authority: false, updated_at: new Date().toISOString() })
                .eq('is_hr_manager_authority', true);

            if (hrManagerIds.length > 0) {
                await supabaseAdmin
                    .from('employee_profiles')
                    .update({ is_hr_manager_authority: true, updated_at: new Date().toISOString() })
                    .in('id', hrManagerIds);
            }
        } catch (e) {
            console.warn('is_hr_manager_authority column update warning:', e);
        }

        // 2. Reset & update HR Head authority flags
        await supabaseAdmin
            .from('employee_profiles')
            .update({ is_hr_authority: false, updated_at: new Date().toISOString() })
            .eq('is_hr_authority', true);

        if (hrHeadIds.length > 0) {
            const { error: setHrErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({ is_hr_authority: true, updated_at: new Date().toISOString() })
                .in('id', hrHeadIds);

            if (setHrErr) console.error('Error setting hr authority:', setHrErr);
        }

        // 3. Reset & update Director authority flags
        await supabaseAdmin
            .from('employee_profiles')
            .update({ is_director_authority: false, updated_at: new Date().toISOString() })
            .eq('is_director_authority', true);

        if (directorIds.length > 0) {
            const { error: setDirErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({ is_director_authority: true, updated_at: new Date().toISOString() })
                .in('id', directorIds);

            if (setDirErr) console.error('Error setting director authority:', setDirErr);
        }

        return NextResponse.json({
            success: true,
            message: 'Escalation Designated Authorities updated successfully'
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
