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

        // 1. Fetch profiles from employee_profiles table (active profiles only)
        let query = supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!user_id(id, email, full_name, phone, user_photo_url, deleted_at),
                reporting_manager:users!reporting_manager_id(id, email, full_name, phone, user_photo_url)
            `)
            .or('is_active.eq.true,is_active.is.null')
            .order('employee_code', { ascending: true });

        if (orgId) {
            query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
        }
        if (department) {
            query = query.eq('department', department);
        }

        const { data: dbProfiles, error: profileErr } = await query;
        if (profileErr) console.warn('Error querying employee_profiles:', profileErr);

        let profiles = (dbProfiles || []).filter(p => {
            if (p.is_active === false) return false;
            if (p.user && p.user.deleted_at) return false;
            return true;
        });

        // 2. Fetch memberships to identify tenant and vendor users to exclude from HR
        const isTenantOrVendorRole = (role?: string | null): boolean => {
            if (!role) return false;
            const r = role.toLowerCase().trim();
            return (
                r.includes('tenant') ||
                r.includes('vendor') ||
                ['tenant', 'super_tenant', 'tenant_admin', 'vendor', 'maintenance_vendor', 'food_vendor', 'pantry_vendor', 'cafeteria_vendor', 'external_vendor'].includes(r)
            );
        };

        const [orgMemsRes, propMemsRes, appUsersRes] = await Promise.all([
            supabaseAdmin.from('organization_memberships').select('user_id, role'),
            supabaseAdmin.from('property_memberships').select('user_id, role'),
            supabaseAdmin.from('users').select('id, email, phone, full_name, user_photo_url, deleted_at').is('deleted_at', null)
        ]);

        const excludedUserIds = new Set<string>();

        (orgMemsRes.data || []).forEach(m => {
            if (isTenantOrVendorRole(m.role)) excludedUserIds.add(m.user_id);
        });
        (propMemsRes.data || []).forEach(m => {
            if (isTenantOrVendorRole(m.role)) excludedUserIds.add(m.user_id);
        });

        // Filter out employee profiles that are linked to tenant or vendor user accounts
        profiles = profiles.filter(p => !p.user_id || !excludedUserIds.has(p.user_id));

        // Include any active user who is not deleted and not in excluded tenant/vendor roles
        const appUsers = (appUsersRes.data || []).filter(u => 
            !u.deleted_at && !excludedUserIds.has(u.id)
        );

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
        (orgMemsRes.data || []).forEach(m => {
            if (m.role && m.role !== 'staff') userRoleMap.set(m.user_id, m.role);
            else if (!userRoleMap.has(m.user_id)) userRoleMap.set(m.user_id, m.role);
        });
        (propMemsRes.data || []).forEach(m => {
            if (m.role && m.role !== 'staff') userRoleMap.set(m.user_id, m.role);
            else if (!userRoleMap.has(m.user_id)) userRoleMap.set(m.user_id, m.role);
        });

        const existingUserIdsInProfiles = new Set(profiles.filter(p => p.user_id).map(p => p.user_id));
        const existingEmailsInProfiles = new Set(profiles.filter(p => p.email).map(p => (p.email || '').toLowerCase().trim()));

        let combined = profiles.map(p => {
            let role = p.user_id ? userRoleMap.get(p.user_id) || null : null;
            if (p.user?.is_master_admin) {
                role = 'master_admin';
            }
            
            // If linked user role is staff or unassigned, derive actual role from HR flags or designation
            if (p.user_id && (!role || role === 'staff')) {
                const desigLower = (p.designation || '').toLowerCase();
                if (p.is_director_authority || desigLower.includes('director') || desigLower === 'md' || desigLower === 'ceo') role = 'director';
                else if (p.is_hr_authority || p.is_hr_manager_authority) role = 'hr';
                else if (desigLower.includes('general manager') || desigLower.includes('senior manager') || desigLower.includes('manager') || desigLower.includes('vp') || desigLower.includes('lead')) role = 'manager';
                else if (p.designation) role = p.designation.toLowerCase().replace(/\s+/g, '_');
                else role = 'staff';
            }

            const appEmail = p.user?.email || p.email || null;
            const appPhone = p.user?.phone || p.phone || null;
            const appPhoto = p.user?.user_photo_url || null;

            return {
                ...p,
                user_photo_url: appPhoto,
                photo_url: appPhoto,
                email: p.email || appEmail,
                app_role: role || (p.user_id ? 'app_user' : null),
                app_email: appEmail,
                app_phone: appPhone,
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

        const unlinkedUsers = appUsers
            .filter(u => !existingUserIdsInProfiles.has(u.id) && (!u.email || !existingEmailsInProfiles.has((u.email || '').toLowerCase().trim())))
            .map(u => ({
                id: u.id,
                email: u.email,
                full_name: u.full_name,
                phone: u.phone,
                app_role: userRoleMap.get(u.id) || null
            }));

        const { data: dbDepts } = await supabaseAdmin
            .from('departments')
            .select('id, name, code')
            .eq('is_active', true)
            .order('name');

        return NextResponse.json({
            success: true,
            data: combined,
            unlinked_users: unlinkedUsers,
            departments: dbDepts || []
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const {
            employee_id,
            id,
            employee_code,
            first_name,
            last_name,
            email,
            phone,
            contact_number,
            department,
            department_id: explicitDeptId,
            designation,
            location,
            reporting_manager_id,
            alternate_manager_id,
            sync_open_tickets = true
        } = body;

        const targetId = employee_id || id;
        if (!targetId) {
            return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
        }

        // Fetch employee details before update
        let { data: profile, error: fetchErr } = await supabaseAdmin
            .from('employee_profiles')
            .select('*')
            .eq('id', targetId)
            .maybeSingle();

        let targetProfileId = targetId;

        // Fallback: check by user_id if not found by id
        if (!profile) {
            const { data: pByUser } = await supabaseAdmin
                .from('employee_profiles')
                .select('*')
                .eq('user_id', targetId)
                .maybeSingle();
            if (pByUser) {
                profile = pByUser;
                targetProfileId = pByUser.id;
            }
        }

        // If this was a synthesized profile without a DB row, create it now!
        if (!profile) {
            const { data: userData } = await supabaseAdmin.from('users').select('*').eq('id', targetId).maybeSingle();
            if (!userData) {
                return NextResponse.json({ success: false, error: 'Employee or User not found' }, { status: 404 });
            }
            const fullName = userData.full_name || userData.email.split('@')[0];
            const nameParts = fullName.split(' ');

            const { data: createdProfile, error: createErr } = await supabaseAdmin
                .from('employee_profiles')
                .insert({
                    user_id: userData.id,
                    employee_code: employee_code?.trim() || `E${userData.id.substring(0, 4).toUpperCase()}`,
                    first_name: first_name?.trim() || nameParts[0] || 'Employee',
                    last_name: last_name?.trim() || nameParts.slice(1).join(' ') || '',
                    department: department?.trim() || 'Operations',
                    designation: designation?.trim() || 'Staff',
                    email: email?.trim().toLowerCase() || userData.email,
                    phone: phone?.trim() || contact_number?.trim() || userData.phone || null,
                    reporting_manager_id,
                    is_active: true
                })
                .select()
                .single();

            if (createErr) throw createErr;
            targetProfileId = createdProfile.id;
            profile = createdProfile;
        }

        // Validate employee_code uniqueness if updated
        if (employee_code !== undefined && employee_code !== null) {
            const cleanCode = employee_code.trim();
            if (!cleanCode) {
                return NextResponse.json({ success: false, error: 'Employee code cannot be empty' }, { status: 400 });
            }
            const { data: codeConflict } = await supabaseAdmin
                .from('employee_profiles')
                .select('id')
                .neq('id', targetProfileId)
                .ilike('employee_code', cleanCode)
                .maybeSingle();

            if (codeConflict) {
                return NextResponse.json({ success: false, error: `Employee code '${cleanCode}' is already assigned to another employee.` }, { status: 400 });
            }
        }

        // Fetch new manager code/name if manager ID is provided
        let newMgrCode: string | undefined = undefined;
        let finalReportingManagerId: string | null | undefined = undefined;
        if (reporting_manager_id !== undefined) {
            if (!reporting_manager_id) {
                newMgrCode = 'Unassigned';
                finalReportingManagerId = null;
            } else {
                const { data: mgrProfile } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('employee_code, first_name, last_name, user_id')
                    .or(`user_id.eq.${reporting_manager_id},id.eq.${reporting_manager_id}`)
                    .maybeSingle();

                if (mgrProfile) {
                    newMgrCode = `${mgrProfile.first_name} ${mgrProfile.last_name}`;
                    finalReportingManagerId = mgrProfile.user_id || reporting_manager_id;
                } else {
                    const { data: mgrUser } = await supabaseAdmin.from('users').select('id, full_name, email, phone').eq('id', reporting_manager_id).maybeSingle();
                    if (mgrUser) {
                        newMgrCode = mgrUser.full_name || mgrUser.email;
                        finalReportingManagerId = mgrUser.id;
                        // Auto-create manager's employee_profiles record if missing
                        const fullName = mgrUser.full_name || mgrUser.email.split('@')[0];
                        const nameParts = fullName.split(' ');
                        try {
                            await supabaseAdmin
                                .from('employee_profiles')
                                .upsert({
                                    user_id: mgrUser.id,
                                    organization_id: '211e1330-ad83-446d-941f-dcea48396798',
                                    employee_code: `E${mgrUser.id.substring(0, 4).toUpperCase()}`,
                                    first_name: nameParts[0] || 'Manager',
                                    last_name: nameParts.slice(1).join(' ') || '',
                                    department: 'Operations',
                                    designation: 'Manager',
                                    email: mgrUser.email,
                                    phone: mgrUser.phone || null,
                                    is_active: true
                                }, { onConflict: 'user_id' });
                        } catch (err: any) {
                            console.warn('Auto-create manager profile failed:', err);
                        }
                    }
                }
            }
        }

        // Resolve department and department_id
        let cleanDept = department !== undefined ? department?.trim() : undefined;
        let resolvedDeptId = explicitDeptId !== undefined ? explicitDeptId : undefined;

        if (cleanDept && !resolvedDeptId) {
            const { data: dRow } = await supabaseAdmin
                .from('departments')
                .select('id, name')
                .ilike('name', cleanDept)
                .maybeSingle();
            if (dRow) {
                resolvedDeptId = dRow.id;
                cleanDept = dRow.name;
            }
        } else if (resolvedDeptId && !cleanDept) {
            const { data: dRow } = await supabaseAdmin
                .from('departments')
                .select('name')
                .eq('id', resolvedDeptId)
                .maybeSingle();
            if (dRow) {
                cleanDept = dRow.name;
            }
        }

        // Construct update fields object
        const updateFields: any = {
            updated_at: new Date().toISOString()
        };

        if (employee_code !== undefined) updateFields.employee_code = employee_code.trim();
        if (first_name !== undefined) updateFields.first_name = first_name.trim();
        if (last_name !== undefined) updateFields.last_name = last_name.trim();
        if (email !== undefined) updateFields.email = email.trim().toLowerCase();
        if (phone !== undefined || contact_number !== undefined) {
            updateFields.phone = (phone ?? contact_number ?? '').trim();
        }
        if (cleanDept !== undefined) updateFields.department = cleanDept;
        if (resolvedDeptId !== undefined) updateFields.department_id = resolvedDeptId || null;
        if (designation !== undefined) updateFields.designation = designation.trim();
        if (location !== undefined) updateFields.location = location.trim();
        if (reporting_manager_id !== undefined) {
            updateFields.reporting_manager_id = finalReportingManagerId ?? (reporting_manager_id || null);
            if (newMgrCode !== undefined) updateFields.reporting_manager_code = newMgrCode;
        }
        if (alternate_manager_id !== undefined) {
            updateFields.alternate_manager_id = alternate_manager_id || null;
        }

        // Update employee profile
        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('employee_profiles')
            .update(updateFields)
            .eq('id', targetProfileId)
            .select(`
                *,
                user:users!user_id(id, email, full_name, phone, user_photo_url, deleted_at),
                reporting_manager:users!reporting_manager_id(id, email, full_name, phone, user_photo_url)
            `)
            .single();

        if (updateErr) throw updateErr;

        // If employee profile is linked to an app user, keep users table in sync
        const linkedUserId = profile.user_id;
        if (linkedUserId) {
            const userUpdates: any = {};
            if (first_name !== undefined || last_name !== undefined) {
                const fn = first_name !== undefined ? first_name.trim() : (profile.first_name || '');
                const ln = last_name !== undefined ? last_name.trim() : (profile.last_name || '');
                const combined = `${fn} ${ln}`.trim();
                if (combined) userUpdates.full_name = combined;
            }
            if (phone !== undefined || contact_number !== undefined) {
                const pVal = (phone ?? contact_number ?? '').trim();
                if (pVal) userUpdates.phone = pVal;
            }
            if (Object.keys(userUpdates).length > 0) {
                userUpdates.updated_at = new Date().toISOString();
                await supabaseAdmin.from('users').update(userUpdates).eq('id', linkedUserId);
            }
        }

        // Sync open Level 1 Grievance tickets raised by this employee to the new manager if manager changed
        let syncedCount = 0;
        const targetMgrIdForTickets = finalReportingManagerId ?? reporting_manager_id;
        if (sync_open_tickets && (profile?.user_id || targetId) && targetMgrIdForTickets) {
            const userIdToMatch = profile?.user_id || targetId;
            const { data: openTickets } = await supabaseAdmin
                .from('hr_tickets')
                .select('id')
                .eq('raised_by_user_id', userIdToMatch)
                .eq('current_level', 1)
                .in('status', [
                    'new', 'assigned', 'in_progress', 
                    'awaiting_employee_response', 'awaiting_manager_response', 
                    'awaiting_hr_response', 'awaiting_internal_approval'
                ]);

            if (openTickets && openTickets.length > 0) {
                const ticketIds = openTickets.map(t => t.id);
                await supabaseAdmin
                    .from('hr_tickets')
                    .update({ assigned_to_user_id: targetMgrIdForTickets, updated_at: new Date().toISOString() })
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
            user_id,
            employee_code,
            first_name,
            last_name,
            email,
            contact_number,
            phone,
            department,
            department_id: explicitDeptId,
            designation,
            location,
            reporting_manager_id,
            organization_id,
            property_id,
            create_app_account = false,
            role = 'staff'
        } = body;

        const cleanEmail = (email || '').trim().toLowerCase();
        const cleanFirstName = (first_name || '').trim();
        const cleanLastName = (last_name || '').trim();
        const cleanPhone = (contact_number || phone || '').trim();

        if (!cleanFirstName || !cleanLastName || !cleanEmail) {
            return NextResponse.json({ success: false, error: 'First name, last name, and email are required' }, { status: 400 });
        }

        // 1. Resolve target app user ID
        let targetUserId: string | null = user_id || null;

        // If user_id wasn't passed directly, look for existing user in users table by email
        if (!targetUserId && cleanEmail) {
            const { data: existingUser } = await supabaseAdmin
                .from('users')
                .select('id, full_name, email, phone')
                .ilike('email', cleanEmail)
                .is('deleted_at', null)
                .maybeSingle();

            if (existingUser) {
                targetUserId = existingUser.id;
            }
        }

        // If still not matched and phone is provided, check by phone
        if (!targetUserId && cleanPhone) {
            const phoneDigits = cleanPhone.replace(/\D/g, '').slice(-10);
            if (phoneDigits.length >= 10) {
                const { data: existingUserByPhone } = await supabaseAdmin
                    .from('users')
                    .select('id, full_name, email, phone')
                    .ilike('phone', `%${phoneDigits}%`)
                    .is('deleted_at', null)
                    .maybeSingle();

                if (existingUserByPhone) {
                    targetUserId = existingUserByPhone.id;
                }
            }
        }

        // 2. Resolve target organization
        let targetOrgId = organization_id || null;
        if (!targetOrgId && targetUserId) {
            const { data: userOrgMemb } = await supabaseAdmin
                .from('organization_memberships')
                .select('organization_id')
                .eq('user_id', targetUserId)
                .maybeSingle();
            if (userOrgMemb?.organization_id) {
                targetOrgId = userOrgMemb.organization_id;
            }
        }
        if (!targetOrgId) {
            targetOrgId = '211e1330-ad83-446d-941f-dcea48396798';
        }

        // 3. Handle App Account creation if requested or update existing user
        if (create_app_account) {
            const full_name = `${cleanFirstName} ${cleanLastName}`.trim();
            const tempPassword = 'Pass' + Math.random().toString(36).slice(-8) + '!';

            if (!targetUserId) {
                const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                    email: cleanEmail,
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: {
                        full_name,
                        username: cleanEmail.split('@')[0],
                        organization_id: targetOrgId
                    }
                });

                if (createErr) {
                    if (createErr.message.includes('already registered')) {
                        const { data: u } = await supabaseAdmin.from('users').select('id').ilike('email', cleanEmail).maybeSingle();
                        if (u) targetUserId = u.id;
                    } else {
                        return NextResponse.json({ success: false, error: `Failed to create auth user: ${createErr.message}` }, { status: 500 });
                    }
                } else if (userData?.user) {
                    targetUserId = userData.user.id;
                }
            }

            if (targetUserId) {
                await supabaseAdmin
                    .from('users')
                    .update({
                        full_name,
                        phone: cleanPhone || null,
                        onboarding_completed: true,
                        is_approved: true,
                        approval_status: 'approved'
                    })
                    .eq('id', targetUserId);

                if (targetOrgId) {
                    if (['org_super_admin', 'hr', 'hr_head'].includes(role)) {
                        await supabaseAdmin
                            .from('organization_memberships')
                            .upsert({ organization_id: targetOrgId, user_id: targetUserId, role }, { onConflict: 'organization_id,user_id' });
                    }
                    if (property_id) {
                        await supabaseAdmin
                            .from('property_memberships')
                            .upsert({ organization_id: targetOrgId, property_id, user_id: targetUserId, role, is_active: true }, { onConflict: 'user_id,property_id' });
                    }
                }
            }
        } else if (targetUserId) {
            // Even if create_app_account is false, sync user full_name/phone if user only had first name
            const { data: uInfo } = await supabaseAdmin.from('users').select('full_name, phone').eq('id', targetUserId).maybeSingle();
            const updates: any = {};
            if (uInfo && (!uInfo.full_name || uInfo.full_name.trim() === cleanFirstName)) {
                updates.full_name = `${cleanFirstName} ${cleanLastName}`.trim();
            }
            if (uInfo && !uInfo.phone && cleanPhone) {
                updates.phone = cleanPhone;
            }
            if (Object.keys(updates).length > 0) {
                await supabaseAdmin.from('users').update(updates).eq('id', targetUserId);
            }
        }

        // 4. Resolve reporting manager code and valid user_id reference
        let reporting_manager_code = null;
        let final_reporting_manager_id: string | null = null;
        if (reporting_manager_id) {
            const { data: mgr } = await supabaseAdmin
                .from('employee_profiles')
                .select('first_name, last_name, employee_code, user_id, id')
                .or(`user_id.eq.${reporting_manager_id},id.eq.${reporting_manager_id}`)
                .maybeSingle();

            if (mgr) {
                reporting_manager_code = `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim() || mgr.employee_code;
                final_reporting_manager_id = mgr.user_id || null;
            }

            if (!final_reporting_manager_id) {
                const { data: mgrUser } = await supabaseAdmin
                    .from('users')
                    .select('id, full_name, email')
                    .eq('id', reporting_manager_id)
                    .maybeSingle();

                if (mgrUser) {
                    reporting_manager_code = mgrUser.full_name || mgrUser.email;
                    final_reporting_manager_id = mgrUser.id;
                }
            }
        }

        // 5. Resolve department_id from departments table if available
        let department_id: string | null = explicitDeptId || null;
        if (!department_id && department) {
            const cleanDept = department.trim();
            const { data: deptRow } = await supabaseAdmin
                .from('departments')
                .select('id')
                .ilike('name', cleanDept)
                .maybeSingle();
            if (deptRow) {
                department_id = deptRow.id;
            }
        }

        // 6. Generate employee code if empty
        const finalECode = (employee_code || '').trim() || `E${Math.floor(100 + Math.random() * 900)}`;

        // 7. Check if employee profile already exists for this user_id or email
        let existingProfile: any = null;
        if (targetUserId) {
            const { data: pByUserId } = await supabaseAdmin
                .from('employee_profiles')
                .select('id')
                .eq('user_id', targetUserId)
                .maybeSingle();
            if (pByUserId) existingProfile = pByUserId;
        }
        if (!existingProfile && cleanEmail) {
            const { data: pByEmail } = await supabaseAdmin
                .from('employee_profiles')
                .select('id')
                .ilike('email', cleanEmail)
                .maybeSingle();
            if (pByEmail) existingProfile = pByEmail;
        }
        if (!existingProfile && finalECode && targetOrgId) {
            const { data: pByCode } = await supabaseAdmin
                .from('employee_profiles')
                .select('id')
                .eq('organization_id', targetOrgId)
                .eq('employee_code', finalECode)
                .maybeSingle();
            if (pByCode) existingProfile = pByCode;
        }

        const profileFields: any = {
            organization_id: targetOrgId,
            user_id: targetUserId || null,
            employee_code: finalECode,
            first_name: cleanFirstName,
            last_name: cleanLastName,
            department: department || 'Operations',
            designation: designation || 'Executive',
            email: cleanEmail,
            phone: cleanPhone || null,
            location: location || 'Lower Parel',
            reporting_manager_id: final_reporting_manager_id || null,
            reporting_manager_code,
            reconciliation_status: targetUserId ? 'linked' : 'unlinked',
            is_active: true,
            updated_at: new Date().toISOString()
        };

        if (department_id) {
            profileFields.department_id = department_id;
        }

        let savedProfile: any = null;

        if (existingProfile) {
            const { data: updated, error: updateErr } = await supabaseAdmin
                .from('employee_profiles')
                .update(profileFields)
                .eq('id', existingProfile.id)
                .select()
                .single();

            if (updateErr) throw updateErr;
            savedProfile = updated;
        } else {
            const { data: created, error: insertErr } = await supabaseAdmin
                .from('employee_profiles')
                .insert(profileFields)
                .select()
                .single();

            if (insertErr) throw insertErr;
            savedProfile = created;
        }

        return NextResponse.json({
            success: true,
            data: savedProfile,
            is_linked: Boolean(targetUserId),
            user_id: targetUserId
        });
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

