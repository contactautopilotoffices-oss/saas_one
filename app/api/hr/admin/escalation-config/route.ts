import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('organization_id') || '211e1330-ad83-446d-941f-dcea48396798';

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

        // 4. Fetch per-flow, per-level custom step assignees & custom flow levels from organization_settings for orgId
        let flowAssigneesRaw: any = {};
        let flowLevelsRaw: any = null;
        try {
            let settingsQuery = supabaseAdmin
                .from('organization_settings')
                .select('*');

            if (orgId) {
                settingsQuery = settingsQuery.eq('organization_id', orgId);
            }

            const { data: settingsData } = await settingsQuery
                .limit(1)
                .maybeSingle();

            if (settingsData) {
                const configObj = settingsData.notification_matrix?.hr_escalation_config || settingsData.hr_escalation_config || {};
                flowAssigneesRaw = configObj.flow_assignees || configObj || {};
                while (flowAssigneesRaw && flowAssigneesRaw.flow_assignees) {
                    flowAssigneesRaw = flowAssigneesRaw.flow_assignees;
                }
                flowLevelsRaw = configObj.flow_levels || null;
            }
        } catch (sErr) {
            console.warn('Could not read hr_escalation_config from organization_settings:', sErr);
        }

        // Map ID lists in flowAssigneesRaw to full employee profile objects dynamically across any number of levels
        const formattedFlowAssignees: Record<string, Record<string, any[]>> = {};
        const flows = ['grievance', 'hr_query', 'confidential_feedback', 'anonymous_feedback'];

        flows.forEach(flowId => {
            formattedFlowAssignees[flowId] = {};
            const flowConfig = flowAssigneesRaw[flowId] || {};
            
            // Collect all level keys present in flowConfig or default 1..10
            const levelKeys = new Set<string>(Object.keys(flowConfig));
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(n => levelKeys.add(String(n)));

            levelKeys.forEach(levelKey => {
                const targetIds: string[] = Array.isArray(flowConfig[levelKey]) ? flowConfig[levelKey] : [];
                if (targetIds.length > 0) {
                    const matchedEmps = targetIds.map(id => {
                        return mergedEmployees.find(e => e.id === id || e.user_id === id) || { id, full_name: id };
                    });
                    formattedFlowAssignees[flowId][levelKey] = matchedEmps;
                } else {
                    formattedFlowAssignees[flowId][levelKey] = [];
                }
            });
        });

        const defaultFlowLevels: Record<string, any[]> = {
            grievance: [
                { level: 1, title: 'Level 1: Initial Ownership', ownerRole: 'Reporting Manager / HOD', ownerType: 'reporting_manager', slaText: '3 Working Days', slaHours: '72 Hours', description: 'Direct reporting manager conducts initial investigation, talks to employee, and attempts internal resolution.', escalationTrigger: 'If unresolved or no response after 3 Working Days' },
                { level: 2, title: 'Level 2: HR Department Escalation', ownerRole: 'HR Department', ownerType: 'hr', slaText: '7 Working Days', slaHours: '96 Hours', description: 'HR Department steps in to mediate between employee and department, reviews policy guidelines and formal grievances.', escalationTrigger: 'If unresolved or pending after 7 Working Days total' },
                { level: 3, title: 'Level 3: HR Head Review', ownerRole: 'HR Head', ownerType: 'hr_head', slaText: '10 Working Days', slaHours: '72 Hours', description: 'HR Head takes over high-level mediation, formal committee review, and binding policy decisions.', escalationTrigger: 'If unresolved after 10 Working Days total' },
                { level: 4, title: 'Level 4: Final Internal Escalation', ownerRole: 'Director', ownerType: 'director', slaText: '12 Working Days', slaHours: 'Final SLA', description: 'Escalated to Director for final internal resolution, compliance audit, or policy exception approval.', escalationTrigger: 'SLA Breach Flagged on Organization MIS Dashboard' }
            ],
            hr_query: [
                { level: 1, title: 'Level 1: HR Executive / HR Owner', ownerRole: 'HR Executive / Concerned HR Owner', ownerType: 'hr', slaText: '0 - 2 Days', slaHours: '48 Hours', description: 'Assigned HR representative reviews query (Payroll, Leave, PF/ESIC, Reimbursements) and responds directly to employee.', escalationTrigger: 'If query unaddressed after SLA expiry' },
                { level: 2, title: 'Level 2: HR Manager Escalation', ownerRole: 'HR Manager', ownerType: 'hr_head', slaText: 'Day 2 - Day 5', slaHours: '72 Hours', description: 'Escalated to HR Manager for salary calculation verification, tax adjustment, or policy clarification.', escalationTrigger: 'If query remains unresolved' },
                { level: 3, title: 'Level 3: HR Head Review', ownerRole: 'HR Head', ownerType: 'hr_head', slaText: 'Day 5 - Day 7', slaHours: '48 Hours', description: 'Escalated to HR Head to resolve complex payroll disputes or policy exceptions.', escalationTrigger: 'If unresolved by HR Manager' },
                { level: 4, title: 'Level 4: Management Review', ownerRole: 'Management, wherever required', ownerType: 'director', slaText: 'Day 7+', slaHours: 'Final SLA', description: 'Final review by Management for company-wide policy exceptions or executive decisions.', escalationTrigger: 'SLA Breach Flagged' }
            ],
            confidential_feedback: [
                { level: 1, title: 'Level 1: Director Review', ownerRole: 'Director', ownerType: 'director', slaText: '0 - 2 Days', slaHours: '48 Hours', description: 'Bypasses reporting manager completely for employee privacy. Directly visible to authorized Director(s).', escalationTrigger: 'If unaddressed after 48 Hours' },
                { level: 2, title: 'Level 2: Board / Managing Director', ownerRole: 'Managing Director / Executive Board', ownerType: 'super_admin', slaText: 'Day 2+', slaHours: 'Final SLA', description: 'Direct escalation to company executive officers for confidential ethics or whistleblowing review.', escalationTrigger: 'Critical Priority Alert' }
            ],
            anonymous_feedback: [
                { level: 1, title: 'Level 1: Anonymous Ethics Channel', ownerRole: 'Director', ownerType: 'director', slaText: '0 - 3 Days', slaHours: '72 Hours', description: 'Employee identity is cryptographically masked. Routed directly to Director without sender identity.', escalationTrigger: 'If unaddressed after 72 Hours' },
                { level: 2, title: 'Level 2: Executive Board Audit', ownerRole: 'Managing Director / Executive Board', ownerType: 'director', slaText: 'Day 3+', slaHours: 'Final SLA', description: 'Escalated to Managing Director to ensure company culture feedback is reviewed and actioned.', escalationTrigger: 'SLA Breach Flagged' }
            ]
        };

        // Guarantee all 4 flows are populated with their custom or default levels
        const resolvedFlowLevels: Record<string, any[]> = {
            grievance: (flowLevelsRaw?.grievance && Array.isArray(flowLevelsRaw.grievance) && flowLevelsRaw.grievance.length > 0)
                ? flowLevelsRaw.grievance
                : defaultFlowLevels.grievance,
            hr_query: (flowLevelsRaw?.hr_query && Array.isArray(flowLevelsRaw.hr_query) && flowLevelsRaw.hr_query.length > 0)
                ? flowLevelsRaw.hr_query
                : defaultFlowLevels.hr_query,
            confidential_feedback: (flowLevelsRaw?.confidential_feedback && Array.isArray(flowLevelsRaw.confidential_feedback) && flowLevelsRaw.confidential_feedback.length > 0)
                ? flowLevelsRaw.confidential_feedback
                : defaultFlowLevels.confidential_feedback,
            anonymous_feedback: (flowLevelsRaw?.anonymous_feedback && Array.isArray(flowLevelsRaw.anonymous_feedback) && flowLevelsRaw.anonymous_feedback.length > 0)
                ? flowLevelsRaw.anonymous_feedback
                : defaultFlowLevels.anonymous_feedback
        };

        return NextResponse.json({
            success: true,
            data: {
                employees: mergedEmployees,
                designated_hr_managers: hrManagers,
                designated_hr_heads: hrHeads,
                designated_directors: directors,
                designated_hr_head: hrHeads[0] || null,
                designated_director: directors[0] || null,
                flow_assignees: formattedFlowAssignees,
                flow_levels: resolvedFlowLevels
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

        // 4. Save per-flow, per-level custom step assignees & flow levels into organization_settings
        if (body.flow_assignees || body.flow_levels) {
            try {
                // Fetch org id: prioritize request body, then query DB, then default Autopilot Offices
                let orgId = body.organization_id;
                if (!orgId) {
                    const { data: orgData } = await supabaseAdmin.from('organizations').select('id').order('created_at', { ascending: true }).limit(2);
                    // Match Autopilot Offices or first available
                    const matchedOrg = (orgData || []).find(o => o.id === '211e1330-ad83-446d-941f-dcea48396798') || orgData?.[0];
                    orgId = matchedOrg?.id || '211e1330-ad83-446d-941f-dcea48396798';
                }

                if (orgId) {
                    const { data: existingSettings } = await supabaseAdmin
                        .from('organization_settings')
                        .select('notification_matrix, hr_escalation_config')
                        .eq('organization_id', orgId)
                        .maybeSingle();

                    const currentMatrix = existingSettings?.notification_matrix || {};
                    const currentEscalationConfig = existingSettings?.hr_escalation_config || currentMatrix.hr_escalation_config || {};

                    let cleanAssignees = body.flow_assignees;
                    while (cleanAssignees && cleanAssignees.flow_assignees) {
                        cleanAssignees = cleanAssignees.flow_assignees;
                    }

                    if (cleanAssignees && typeof cleanAssignees === 'object') {
                        const allRawIds: string[] = [];
                        Object.keys(cleanAssignees).forEach(fKey => {
                            const flowObj = cleanAssignees[fKey];
                            if (flowObj && typeof flowObj === 'object') {
                                Object.keys(flowObj).forEach(lvlKey => {
                                    const arr = flowObj[lvlKey];
                                    if (Array.isArray(arr)) {
                                        arr.forEach((id: string) => { if (id) allRawIds.push(id); });
                                    }
                                });
                            }
                        });

                        if (allRawIds.length > 0) {
                            const { data: profs } = await supabaseAdmin
                                .from('employee_profiles')
                                .select('id, user_id')
                                .or(`id.in.(${allRawIds.join(',')}),user_id.in.(${allRawIds.join(',')})`);

                            const idToUserIdMap = new Map<string, string>();
                            (profs || []).forEach(p => {
                                if (p.user_id) {
                                    idToUserIdMap.set(p.id, p.user_id);
                                    idToUserIdMap.set(p.user_id, p.user_id);
                                }
                            });

                            Object.keys(cleanAssignees).forEach(fKey => {
                                const flowObj = cleanAssignees[fKey];
                                if (flowObj && typeof flowObj === 'object') {
                                    Object.keys(flowObj).forEach(lvlKey => {
                                        const arr = flowObj[lvlKey];
                                        if (Array.isArray(arr)) {
                                            flowObj[lvlKey] = Array.from(new Set(arr.map((id: string) => idToUserIdMap.get(id) || id)));
                                        }
                                    });
                                }
                            });
                        }
                    }

                    // Deep merge flow_levels with existing config so saving one flow preserves all other flows
                    const existingFlowLevels = currentEscalationConfig.flow_levels || {};
                    const mergedFlowLevels = {
                        ...existingFlowLevels,
                        ...(body.flow_levels || {})
                    };

                    // Deep merge flow_assignees
                    let existingFlowAssignees = currentEscalationConfig.flow_assignees || {};
                    while (existingFlowAssignees && existingFlowAssignees.flow_assignees) {
                        existingFlowAssignees = existingFlowAssignees.flow_assignees;
                    }
                    const mergedFlowAssignees = {
                        ...existingFlowAssignees,
                        ...(cleanAssignees || {})
                    };

                    const newEscalationConfig = {
                        ...currentEscalationConfig,
                        flow_assignees: mergedFlowAssignees,
                        flow_levels: mergedFlowLevels,
                        updated_at: new Date().toISOString()
                    };

                    const updatedMatrix = {
                        ...currentMatrix,
                        hr_escalation_config: newEscalationConfig
                    };

                    const upsertData: any = {
                        organization_id: orgId,
                        notification_matrix: updatedMatrix,
                        hr_escalation_config: newEscalationConfig,
                        updated_at: new Date().toISOString()
                    };

                    const { error: upsertErr } = await supabaseAdmin
                        .from('organization_settings')
                        .upsert(upsertData, { onConflict: 'organization_id' });

                    if (upsertErr) {
                        console.error('Error upserting organization_settings:', upsertErr);
                        throw upsertErr;
                    }

                    // Also sync updated flow_levels SLA days to hr_ticket_categories table
                    if (body.flow_levels && typeof body.flow_levels === 'object') {
                        const parseSlaTextToDays = (slaText: string | undefined, defaultDays: number): number => {
                            if (!slaText) return defaultDays;
                            const clean = slaText.trim();
                            const matchMin = clean.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)/i);
                            if (matchMin && matchMin[1]) {
                                return Number((parseFloat(matchMin[1]) / 1440).toFixed(6));
                            }
                            const matchHr = clean.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)/i);
                            if (matchHr && matchHr[1]) {
                                return Number((parseFloat(matchHr[1]) / 24).toFixed(6));
                            }
                            const matchRange = clean.match(/Day\s*\d+\s*-\s*Day\s*(\d+)/i) || clean.match(/0\s*-\s*(\d+)\s*Days?/i);
                            if (matchRange && matchRange[1]) {
                                return parseFloat(matchRange[1]);
                            }
                            const matchDay = clean.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days|working days)/i);
                            if (matchDay && matchDay[1]) {
                                return parseFloat(matchDay[1]);
                            }
                            const directVal = parseFloat(clean);
                            if (!isNaN(directVal)) return directVal;

                            return defaultDays;
                        };

                        try {
                            for (const ticketType of Object.keys(body.flow_levels)) {
                                const levelsArr = body.flow_levels[ticketType];
                                if (Array.isArray(levelsArr) && levelsArr.length > 0) {
                                    const catUpdates: any = {};
                                    for (let lvlNum = 1; lvlNum <= 10; lvlNum++) {
                                        if (lvlNum <= levelsArr.length) {
                                            const lvl = levelsArr[lvlNum - 1];
                                            const defaultDays = lvlNum === 1 ? 3 : lvlNum === 2 ? 7 : lvlNum === 3 ? 10 : 12;
                                            catUpdates[`l${lvlNum}_sla_days`] = parseSlaTextToDays(lvl?.slaText, defaultDays);
                                        } else {
                                            catUpdates[`l${lvlNum}_sla_days`] = null;
                                        }
                                    }
                                    if (Object.keys(catUpdates).length > 0) {
                                        let catQuery = supabaseAdmin
                                            .from('hr_ticket_categories')
                                            .update(catUpdates)
                                            .eq('ticket_type', ticketType);
                                        if (orgId) {
                                            catQuery = catQuery.eq('organization_id', orgId);
                                        }
                                        await catQuery;
                                    }
                                }
                            }
                        } catch (catErr) {
                            console.warn('Error updating category level SLAs:', catErr);
                        }
                    }
                }
            } catch (cfgErr) {
                console.warn('Error saving hr_escalation_config to organization_settings:', cfgErr);
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Escalation Designated Authorities & Flow Assignees updated successfully'
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
