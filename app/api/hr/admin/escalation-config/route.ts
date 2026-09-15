import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('organization_id');

        // 1. Fetch employee_profiles
        let query = supabaseAdmin
            .from('employee_profiles')
            .select(`
                id,
                employee_code,
                first_name,
                last_name,
                email,
                phone,
                department,
                designation,
                user_id,
                is_hr_authority,
                is_director_authority,
                is_hr_manager_authority,
                reconciliation_status,
                organization_id
            `)
            .order('first_name', { ascending: true });

        if (orgId) {
            query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }

        let { data: rawProfiles, error } = await query;

        if (error && (error.code === '42703' || (error.message && error.message.includes('is_hr_manager_authority')))) {
            // Safe fallback if is_hr_manager_authority column does not exist on employee_profiles table in DB
            let fallbackQuery = supabaseAdmin
                .from('employee_profiles')
                .select(`
                    id,
                    employee_code,
                    first_name,
                    last_name,
                    email,
                    phone,
                    department,
                    designation,
                    user_id,
                    is_hr_authority,
                    is_director_authority,
                    reconciliation_status,
                    organization_id
                `)
                .order('first_name', { ascending: true });

            if (orgId) {
                fallbackQuery = fallbackQuery.or(`organization_id.eq.${orgId},organization_id.is.null`);
            }
            const fallbackRes = await fallbackQuery;
            if (fallbackRes.error) {
                console.error('Error fetching employee profiles (fallback):', fallbackRes.error);
            }
            rawProfiles = (fallbackRes.data || []).map((p: any) => ({
                ...p,
                is_hr_manager_authority: false
            }));
        } else if (error) {
            console.error('Error fetching employee profiles:', error);
        }

        const profiles = rawProfiles || [];

        // 2. Fetch app users & memberships
        const EXCLUDED_ROLES = new Set(['tenant', 'super_tenant', 'tenant_admin', 'vendor', 'maintenance_vendor']);
        const [orgMemsRes, propMemsRes, usersRes] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id, role, organization_id'),
            supabaseAdmin.from('property_memberships').select('user_id, role, property_id'),
            supabaseAdmin.from('users').select('id, email, full_name, phone')
        ]);

        const orgMems = orgMemsRes.data || [];
        const propMems = propMemsRes.data || [];
        const appUsers = usersRes.data || [];

        const excludedUserIds = new Set<string>();
        orgMems.forEach(m => { if (EXCLUDED_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });
        propMems.forEach(m => { if (EXCLUDED_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });

        const userRoleMap = new Map<string, string>();
        orgMems.forEach(m => userRoleMap.set(m.user_id, m.role));
        propMems.forEach(m => { if (!userRoleMap.has(m.user_id)) userRoleMap.set(m.user_id, m.role); });

        const appUserMap = new Map<string, any>();
        appUsers.forEach(u => {
            if (!excludedUserIds.has(u.id)) {
                appUserMap.set(u.id, u);
            }
        });

        // 3. Merge profiles and users, deduplicating if user is in both
        const matchedUserIds = new Set<string>();
        const matchedEmails = new Set<string>();

        const mergedEmployees: any[] = profiles.map(p => {
            let matchedUser = p.user_id ? appUserMap.get(p.user_id) : null;
            if (!matchedUser && p.email) {
                const cleanEmail = p.email.toLowerCase().trim();
                matchedUser = appUsers.find(u => !excludedUserIds.has(u.id) && (u.email || '').toLowerCase().trim() === cleanEmail);
            }

            if (matchedUser) {
                matchedUserIds.add(matchedUser.id);
                if (matchedUser.email) matchedEmails.add(matchedUser.email.toLowerCase().trim());
            }
            if (p.user_id) matchedUserIds.add(p.user_id);
            if (p.email) matchedEmails.add(p.email.toLowerCase().trim());

            return {
                ...p,
                full_name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || matchedUser?.full_name || p.email || 'Employee',
                email: p.email || matchedUser?.email || null,
                user_id: p.user_id || matchedUser?.id || null,
                is_hr_manager_authority: p.is_hr_manager_authority === true || p.designation === 'Designated HR Manager'
            };
        });

        // Add app users that are not present in employee_profiles
        appUsers.forEach(u => {
            if (excludedUserIds.has(u.id)) return;
            if (matchedUserIds.has(u.id)) return;
            if (u.email && matchedEmails.has(u.email.toLowerCase().trim())) return;

            const role = userRoleMap.get(u.id) || 'staff';
            const roleLabel = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const nameParts = (u.full_name || '').trim().split(' ');

            mergedEmployees.push({
                id: u.id,
                user_id: u.id,
                employee_code: u.email ? u.email.split('@')[0].toUpperCase() : 'APP-USER',
                first_name: nameParts[0] || 'User',
                last_name: nameParts.slice(1).join(' ') || '',
                full_name: u.full_name || u.email || 'App User',
                email: u.email || null,
                phone: u.phone || null,
                department: role.includes('hr') ? 'Human Resources' : (role.includes('admin') ? 'Administration' : 'App User'),
                designation: roleLabel,
                is_hr_authority: role === 'hr' || role === 'hr_head',
                is_director_authority: role === 'director',
                is_hr_manager_authority: false,
                is_virtual_user: true
            });
        });

        const hrManagers = mergedEmployees.filter(p => p.is_hr_manager_authority === true);
        const hrHeads = mergedEmployees.filter(p => p.is_hr_authority === true);
        const directors = mergedEmployees.filter(p => p.is_director_authority === true);

        return NextResponse.json({
            success: true,
            data: {
                employees: mergedEmployees,
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

        // Helper function to resolve or create employee profile for an ID (which could be profile ID or user ID)
        const ensureProfileIds = async (targetIds: string[]): Promise<string[]> => {
            if (targetIds.length === 0) return [];
            const resultProfileIds: string[] = [];

            const { data: existingProfiles } = await supabaseAdmin
                .from('employee_profiles')
                .select('id, user_id')
                .or(`id.in.(${targetIds.join(',')}),user_id.in.(${targetIds.join(',')})`);

            const foundProfileIds = new Set<string>();
            const foundUserIds = new Set<string>();

            (existingProfiles || []).forEach(p => {
                foundProfileIds.add(p.id);
                if (p.user_id) foundUserIds.add(p.user_id);
            });

            for (const targetId of targetIds) {
                if (foundProfileIds.has(targetId)) {
                    resultProfileIds.push(targetId);
                } else if (foundUserIds.has(targetId)) {
                    const matchedProfile = (existingProfiles || []).find(p => p.user_id === targetId);
                    if (matchedProfile) resultProfileIds.push(matchedProfile.id);
                } else {
                    // ID is a user.id without employee_profile record. Create profile for this specifically designated user.
                    const { data: userRec } = await supabaseAdmin
                        .from('users')
                        .select('id, email, full_name, phone')
                        .eq('id', targetId)
                        .maybeSingle();

                    if (userRec) {
                        const nameParts = (userRec.full_name || '').trim().split(' ');
                        const { data: insertedProfile } = await supabaseAdmin
                            .from('employee_profiles')
                            .insert({
                                user_id: userRec.id,
                                employee_code: userRec.email ? userRec.email.split('@')[0].toUpperCase() : `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
                                first_name: nameParts[0] || 'User',
                                last_name: nameParts.slice(1).join(' ') || '',
                                email: userRec.email,
                                phone: userRec.phone,
                                department: 'Administration',
                                designation: 'Designated Authority',
                                reconciliation_status: 'linked',
                                is_active: true
                            })
                            .select('id')
                            .single();

                        if (insertedProfile?.id) {
                            resultProfileIds.push(insertedProfile.id);
                        }
                    }
                }
            }

            return resultProfileIds;
        };

        const targetHrManagerProfileIds = await ensureProfileIds(hrManagerIds);
        const targetHrHeadProfileIds = await ensureProfileIds(hrHeadIds);
        const targetDirectorProfileIds = await ensureProfileIds(directorIds);

        // 1. Reset & update HR Manager authority flags
        try {
            await supabaseAdmin
                .from('employee_profiles')
                .update({ designation: 'Employee', is_hr_manager_authority: false, updated_at: new Date().toISOString() })
                .or('designation.eq.Designated HR Manager,is_hr_manager_authority.eq.true');
        } catch (e) {
            await supabaseAdmin
                .from('employee_profiles')
                .update({ designation: 'Employee', updated_at: new Date().toISOString() })
                .eq('designation', 'Designated HR Manager');
        }

        if (targetHrManagerProfileIds.length > 0) {
            const { error: mgrErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({ designation: 'Designated HR Manager', is_hr_manager_authority: true, updated_at: new Date().toISOString() })
                .in('id', targetHrManagerProfileIds);

            if (mgrErr) {
                await supabaseAdmin
                    .from('employee_profiles')
                    .update({ designation: 'Designated HR Manager', updated_at: new Date().toISOString() })
                    .in('id', targetHrManagerProfileIds);
            }
        }

        // 2. Reset & update HR Head authority flags
        await supabaseAdmin
            .from('employee_profiles')
            .update({ is_hr_authority: false, updated_at: new Date().toISOString() })
            .eq('is_hr_authority', true);

        if (targetHrHeadProfileIds.length > 0) {
            const { error: setHrErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({ is_hr_authority: true, updated_at: new Date().toISOString() })
                .in('id', targetHrHeadProfileIds);

            if (setHrErr) console.error('Error setting hr authority:', setHrErr);
        }

        // 3. Reset & update Director authority flags
        await supabaseAdmin
            .from('employee_profiles')
            .update({ is_director_authority: false, updated_at: new Date().toISOString() })
            .eq('is_director_authority', true);

        if (targetDirectorProfileIds.length > 0) {
            const { error: setDirErr } = await supabaseAdmin
                .from('employee_profiles')
                .update({ is_director_authority: true, updated_at: new Date().toISOString() })
                .in('id', targetDirectorProfileIds);

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
