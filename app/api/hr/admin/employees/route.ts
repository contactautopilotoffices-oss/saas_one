import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const department = searchParams.get('department');
        const queryStr = searchParams.get('q');
        const orgId = searchParams.get('organization_id') || searchParams.get('orgId');

        // 1. Fetch profiles from employee_profiles table
        let query = supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!user_id(id, email, full_name, phone),
                reporting_manager:users!reporting_manager_id(id, email, full_name, phone)
            `)
            .order('employee_code', { ascending: true });

        if (orgId) {
            query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }
        if (department) {
            query = query.eq('department', department);
        }

        const { data: dbProfiles, error: profileErr } = await query;
        if (profileErr) console.warn('Error querying employee_profiles:', profileErr);

        let profiles = dbProfiles || [];

        // 2. Fetch memberships to identify tenant, super_tenant, and vendor users to exclude from HR
        const EXCLUDED_HR_ROLES = new Set(['tenant', 'super_tenant', 'tenant_admin', 'vendor', 'maintenance_vendor']);

        const [orgMemsRes, propMemsRes, appUsersRes] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id, role'),
            supabaseAdmin.from('property_memberships').select('user_id, role'),
            supabaseAdmin.from('users').select('id, email, phone, full_name')
        ]);

        const excludedUserIds = new Set<string>();
        (orgMemsRes.data || []).forEach(m => { if (EXCLUDED_HR_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });
        (propMemsRes.data || []).forEach(m => { if (EXCLUDED_HR_ROLES.has(m.role)) excludedUserIds.add(m.user_id); });

        // Filter out employee profiles that are linked to tenant or vendor user accounts
        profiles = profiles.filter(p => !p.user_id || !excludedUserIds.has(p.user_id));

        const appUsers = (appUsersRes.data || []).filter(u => !excludedUserIds.has(u.id));

        if (appUsers.length > 0 && profiles.length > 0) {
            const updatesToPersist: { id: string; user_id: string }[] = [];

            for (const p of profiles) {
                if (!p.user_id) {
                    const pName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().trim();
                    const pEmail = (p.email || '').toLowerCase().trim();
                    const pPhone = (p.contact_number || p.phone || '').replace(/\D/g, '');

                    const match = appUsers.find(u => {
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

            // Persist auto-links in DB
            if (updatesToPersist.length > 0) {
                Promise.all(updatesToPersist.map(u =>
                    supabaseAdmin
                        .from('employee_profiles')
                        .update({ user_id: u.user_id, reconciliation_status: 'linked', updated_at: new Date().toISOString() })
                        .eq('id', u.id)
                )).catch(err => console.error('Error persisting auto-links:', err));
            }
        }

        // Build role lookup map for linked users
        const userRoleMap = new Map<string, string>();
        (orgMemsRes.data || []).forEach(m => userRoleMap.set(m.user_id, m.role));
        (propMemsRes.data || []).forEach(m => { if (!userRoleMap.has(m.user_id)) userRoleMap.set(m.user_id, m.role); });

        let combined = profiles.map(p => {
            const role = p.user_id ? userRoleMap.get(p.user_id) || (p.is_hr_authority ? 'hr' : 'staff') : null;
            return {
                ...p,
                app_role: role,
                app_email: p.user?.email || null,
                app_phone: p.user?.phone || null,
                is_app_linked: Boolean(p.user_id)
            };
        });

        // Apply in-memory filtering for query search if specified
        if (queryStr) {
            const q = queryStr.toLowerCase();
            combined = combined.filter(emp =>
                (emp.first_name || '').toLowerCase().includes(q) ||
                (emp.last_name || '').toLowerCase().includes(q) ||
                (emp.employee_code || '').toLowerCase().includes(q) ||
                (emp.email || '').toLowerCase().includes(q) ||
                (emp.department || '').toLowerCase().includes(q)
            );
        }

        if (department) {
            combined = combined.filter(emp => emp.department === department);
        }

        return NextResponse.json({ success: true, data: combined });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { employee_id, reporting_manager_id, alternate_manager_id, sync_open_tickets = true } = body;

        if (!employee_id) {
            return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
        }

        // Fetch employee details before update
        const { data: profile, error: fetchErr } = await supabaseAdmin
            .from('employee_profiles')
            .select('*')
            .eq('id', employee_id)
            .maybeSingle();

        let targetProfileId = employee_id;

        // If this was a synthesized profile without a DB row, create it now!
        if (!profile) {
            const { data: userData } = await supabaseAdmin.from('users').select('*').eq('id', employee_id).maybeSingle();
            if (!userData) {
                return NextResponse.json({ success: false, error: 'Employee or User not found' }, { status: 404 });
            }
            const fullName = userData.full_name || userData.email.split('@')[0];
            const nameParts = fullName.split(' ');

            const { data: createdProfile, error: createErr } = await supabaseAdmin
                .from('employee_profiles')
                .insert({
                    user_id: userData.id,
                    employee_code: `E${userData.id.substring(0, 4).toUpperCase()}`,
                    first_name: nameParts[0],
                    last_name: nameParts.slice(1).join(' '),
                    department: 'Operations',
                    designation: 'Staff',
                    email: userData.email,
                    phone: userData.phone || null,
                    reporting_manager_id,
                    is_active: true
                })
                .select()
                .single();

            if (createErr) throw createErr;
            targetProfileId = createdProfile.id;
        }

        // Fetch new manager code/name if manager ID is provided
        let newMgrCode = 'Unassigned';
        if (reporting_manager_id) {
            const { data: mgrProfile } = await supabaseAdmin
                .from('employee_profiles')
                .select('employee_code, first_name, last_name')
                .or(`user_id.eq.${reporting_manager_id},id.eq.${reporting_manager_id}`)
                .maybeSingle();

            if (mgrProfile) {
                newMgrCode = `${mgrProfile.first_name} ${mgrProfile.last_name}`;
            } else {
                const { data: mgrUser } = await supabaseAdmin.from('users').select('full_name, email').eq('id', reporting_manager_id).maybeSingle();
                if (mgrUser) {
                    newMgrCode = mgrUser.full_name || mgrUser.email;
                }
            }
        }

        // Update profile
        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('employee_profiles')
            .update({
                reporting_manager_id: reporting_manager_id || null,
                alternate_manager_id: alternate_manager_id || null,
                reporting_manager_code: newMgrCode,
                updated_at: new Date().toISOString()
            })
            .eq('id', targetProfileId)
            .select()
            .single();

        if (updateErr) throw updateErr;

        // Sync open Level 1 Grievance tickets raised by this employee to the new manager
        let syncedCount = 0;
        if (sync_open_tickets && (profile?.user_id || employee_id) && reporting_manager_id) {
            const userIdToMatch = profile?.user_id || employee_id;
            const { data: openTickets } = await supabaseAdmin
                .from('hr_tickets')
                .select('id')
                .eq('raised_by_user_id', userIdToMatch)
                .eq('current_level', 1)
                .in('status', ['new', 'assigned', 'in_progress', 'awaiting_manager_response']);

            if (openTickets && openTickets.length > 0) {
                const ticketIds = openTickets.map(t => t.id);
                await supabaseAdmin
                    .from('hr_tickets')
                    .update({ assigned_to_user_id: reporting_manager_id, updated_at: new Date().toISOString() })
                    .in('id', ticketIds);

                syncedCount = ticketIds.length;
            }
        }

        return NextResponse.json({ success: true, data: updated, synced_tickets_count: syncedCount });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            employee_code,
            first_name,
            last_name,
            email,
            contact_number,
            department,
            designation,
            location,
            reporting_manager_id,
            organization_id,
            property_id,
            create_app_account = false,
            role = 'staff'
        } = body;

        if (!first_name || !last_name || !email) {
            return NextResponse.json({ success: false, error: 'First name, last name, and email are required' }, { status: 400 });
        }

        let createdUserId: string | null = null;

        if (create_app_account) {
            const full_name = `${first_name} ${last_name}`;
            const tempPassword = 'Pass' + Math.random().toString(36).slice(-8) + '!';

            const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: tempPassword,
                email_confirm: true,
                user_metadata: {
                    full_name,
                    username: email.split('@')[0],
                    organization_id
                }
            });

            if (createErr && !createErr.message.includes('already registered')) {
                return NextResponse.json({ success: false, error: `Failed to create auth user: ${createErr.message}` }, { status: 500 });
            }

            if (userData?.user) {
                createdUserId = userData.user.id;

                await supabaseAdmin
                    .from('users')
                    .update({
                        full_name,
                        phone: contact_number || null,
                        onboarding_completed: true,
                        is_approved: true,
                        approval_status: 'approved'
                    })
                    .eq('id', createdUserId);

                if (organization_id) {
                    if (['org_super_admin', 'hr', 'hr_head'].includes(role)) {
                        await supabaseAdmin
                            .from('organization_memberships')
                            .upsert({ organization_id, user_id: createdUserId, role }, { onConflict: 'organization_id,user_id' });
                    }
                    if (property_id) {
                        await supabaseAdmin
                            .from('property_memberships')
                            .upsert({ organization_id, property_id, user_id: createdUserId, role, is_active: true }, { onConflict: 'user_id,property_id' });
                    }
                }
            }
        }

        let reporting_manager_code = null;
        if (reporting_manager_id) {
            const { data: mgr } = await supabaseAdmin
                .from('employee_profiles')
                .select('first_name, last_name, employee_code')
                .or(`user_id.eq.${reporting_manager_id},id.eq.${reporting_manager_id}`)
                .maybeSingle();

            if (mgr) {
                reporting_manager_code = `${mgr.first_name} ${mgr.last_name}`;
            }
        }

        const finalECode = employee_code || `E${Math.floor(100 + Math.random() * 900)}`;

        const { data: newProfile, error: profileErr } = await supabaseAdmin
            .from('employee_profiles')
            .insert({
                organization_id: organization_id || null,
                property_id: property_id || null,
                user_id: createdUserId,
                employee_code: finalECode,
                first_name,
                last_name,
                department: department || 'Operations',
                designation: designation || 'Executive',
                email: email,
                phone: contact_number || null,
                location: location || 'Lower Parel',
                reporting_manager_id: reporting_manager_id || null,
                reporting_manager_code,
                is_active: true
            })
            .select()
            .single();

        if (profileErr) throw profileErr;

        return NextResponse.json({ success: true, data: newProfile });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id') || searchParams.get('employee_id');

        if (!id) {
            return NextResponse.json({ success: false, error: 'Employee ID is required' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('employee_profiles')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true, message: 'Employee profile deleted successfully' });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

