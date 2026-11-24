import { NextRequest, NextResponse } from 'next/server';
import { slaHoursFor } from '@/backend/lib/ticketing/categorySla';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { resolveClassification, logClassification } from '@/backend/lib/ticketing';
import { processIntelligentAssignment } from '@/backend/lib/ticketing/assignment';
import { generateNextTicketNumber } from '@/backend/lib/ticketing/ticketNumberService';

// Extract floor number from description
function extractFloorNumber(description: string): number | null {
    const lowerDesc = description.toLowerCase();

    // Check for ground floor first (including common misspellings)
    if (lowerDesc.includes('ground floor') ||
        lowerDesc.includes('grourd floor') ||
        lowerDesc.includes('groud floor') ||
        lowerDesc.includes('floor 0') ||
        lowerDesc.includes('level 0')) {
        return 0;
    }

    // Check for basement
    if (lowerDesc.includes('basement') || lowerDesc.includes('b1')) return -1;
    if (lowerDesc.includes('b2')) return -2;

    const floorPatterns = [
        /(\d+)(?:st|nd|rd|th)\s*floor/i,
        /floor\s*(\d+)/i,
        /(\d+)\s*floor/i,
        /level\s*(\d+)/i,
    ];

    for (const pattern of floorPatterns) {
        const match = description.match(pattern);
        if (match) return parseInt(match[1], 10);
    }

    return null;
}

// Extract location from description
function extractLocation(description: string): string | null {
    const locations: Record<string, string[]> = {
        'Cafeteria': ['cafeteria', 'canteen', 'pantry', 'kitchen', 'mess'],
        'Reception': ['lobby', 'reception', 'front desk', 'entrance'],
        'Parking': ['parking', 'basement', 'garage'],
        'Terrace': ['terrace', 'roof', 'rooftop'],
        'Washroom': ['washroom', 'restroom', 'toilet', 'bathroom', 'loo'],
        'Conference Room': ['conference', 'meeting room', 'board room'],
        'Cabin': ['cabin', 'cubicle', 'desk', 'workstation'],
        'Server Room': ['server room', 'data center', 'hub room'],
        'Electrical Room': ['electrical room', 'ups room', 'dg room']
    };

    const lowerDesc = description.toLowerCase();
    for (const [loc, keywords] of Object.entries(locations)) {
        for (const keyword of keywords) {
            // Use word boundaries to avoid matching keywords inside other words
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            if (regex.test(lowerDesc)) return loc;
        }
    }
    return null;
}

/**
 * GET /api/tickets
 * Fetch tickets with filters.
 * Supports both cookie-based auth (web) and Bearer token auth (mobile).
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId') || searchParams.get('property_id');
        const organizationId = searchParams.get('organizationId') || searchParams.get('organization_id');
        const status = searchParams.get('status');
        const isInternal = searchParams.get('isInternal');
        const assignedTo = searchParams.get('assignedTo');
        const raisedBy = searchParams.get('raisedBy') || searchParams.get('raised_by');
        const raisedByRole = searchParams.get('raisedByRole');
        const limitParam = searchParams.get('limit');
        const offsetParam = searchParams.get('offset');
        const slaBreached = searchParams.get('slaBreached');
        const dateFrom = searchParams.get('dateFrom');
        const dateTo = searchParams.get('dateTo');
        const search = searchParams.get('search');
        const skillGroup = searchParams.get('skillGroup');
        const period = searchParams.get('period');

        const materialsRequired = searchParams.get('materialsRequired');
        const vendorTagged = searchParams.get('vendorTagged');
        const floorNumber = searchParams.get('floorNumber') || searchParams.get('floor_number') || searchParams.get('floor');

        // Resolve user roles and memberships to prevent unauthorized ticket leaks
        const adminSupabase = createAdminClient();
        const [orgMemsRes, propMemsRes] = await Promise.all([
            adminSupabase.from('organization_memberships').select('role, organization_id, is_active').eq('user_id', user.id),
            adminSupabase.from('property_memberships').select('role, property_id').eq('user_id', user.id).eq('is_active', true)
        ]);

        const orgRoles = (orgMemsRes.data || []).map(m => (m.role || '').toLowerCase().trim());
        // Owner 2026-11-03: the org-level Tech team tracks every ticket of its own organisation(s) in the Tech console's
        // Requests tab. Only those organisations; who may edit, assign or delete is unchanged.
        const techOrgIds = Array.from(new Set((orgMemsRes.data || [])
            .filter(m => (m.role || '').toLowerCase().trim() === 'tech' && m.is_active !== false && m.organization_id)
            .map(m => m.organization_id as string)));
        const propMems = propMemsRes.data || [];
        const propRoles = propMems.map(m => (m.role || '').toLowerCase().trim());
        const userPropIds = Array.from(new Set(propMems.map(m => m.property_id).filter(Boolean)));

        const isOrgSuperAdmin = orgRoles.some(r => ['org_super_admin', 'master_admin', 'super_admin', 'ops_super_admin'].includes(r));
        const isPropertyAdmin = propRoles.some(r => ['property_admin', 'ops_super_admin'].includes(r));
        const isStaffOrMst = propRoles.some(r => ['mst', 'staff', 'tech', 'soft_service_manager', 'soft_service_supervisor'].includes(r));
        const isVendor = propRoles.some(r => ['vendor', 'maintenance_vendor'].includes(r)) || orgRoles.some(r => ['vendor', 'maintenance_vendor'].includes(r));
        const isTenant = propRoles.some(r => ['tenant', 'super_tenant'].includes(r)) && !isOrgSuperAdmin && !isPropertyAdmin && !isStaffOrMst;

        const isAllProperties = !propertyId || propertyId === 'all';
        const isAllOrgs = !organizationId || organizationId === 'all';

        // A user may always list the tickets assigned to themselves, at any property (owner 2026-11-02: the org-level
        // IT team is assigned tickets across properties it holds no property membership in).
        const isOwnAssignedQuery = assignedTo === user.id;

        // Org-level Tech, asking for one of its own organisations (or not naming one): scoped to those organisations below.
        const isTechScope = !isOrgSuperAdmin && techOrgIds.length > 0 && (isAllOrgs || techOrgIds.includes(organizationId as string));

        // Non-superadmins cannot query all properties across the organization (except their own assigned tickets)
        if (isAllProperties && !isOrgSuperAdmin && !isOwnAssignedQuery && !isTechScope) {
            if (userPropIds.length === 0) {
                return NextResponse.json({ tickets: [], total: 0 });
            }
        }

        // If a specific property is requested, ensure non-superadmin belongs to that property (or, for Tech, that the
        // property belongs to one of its organisations)
        if (propertyId && !isAllProperties && !isOrgSuperAdmin && !isOwnAssignedQuery) {
            if (!userPropIds.includes(propertyId)) {
                let techProperty = false;
                if (isTechScope) {
                    const { data: prop } = await adminSupabase.from('properties').select('organization_id').eq('id', propertyId).maybeSingle();
                    techProperty = !!prop && techOrgIds.includes(prop.organization_id as string);
                }
                if (!techProperty) {
                    return NextResponse.json({ error: 'You do not have access to tickets for this property.' }, { status: 403 });
                }
            }
        }

        // Use admin client when user has verified admin permissions (or Tech, scoped to its organisations); else user client
        const queryClient = (isOrgSuperAdmin || isPropertyAdmin || isTechScope) ? adminSupabase : supabase;

        let selectStr = `
                id, ticket_number, title, status, priority, created_at, internal, raised_by, assigned_to,
                resolved_at, sla_deadline, sla_breached, sla_hours, sla_paused, sla_paused_at, total_paused_minutes, sla_pause_reason,
                needs_vendor_procurement, vendor_procurement_status, vendor_tagged_at,
                category:issue_categories(id, code, name),
                skill_group:skill_groups(id, code, name),
                creator:users!raised_by(id, full_name, email, user_photo_url, property_memberships!property_memberships_user_id_fkey(role, property_id)),
                assignee:users!assigned_to(id, full_name, email, user_photo_url),
                organization:organizations(id, name, code),
                property:properties(id, name, code),
                photo_before_url,
                ticket_escalation_logs(id, escalated_at, from_employee:users!from_employee_id(full_name, user_photo_url), to_employee:users!to_employee_id(full_name, user_photo_url)),
                material_requests${materialsRequired === 'true' ? '!inner' : ''}(id)
            `;

        let query = queryClient
            .from('tickets')
            .select(selectStr, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(
                offsetParam ? parseInt(offsetParam) : 0,
                (offsetParam ? parseInt(offsetParam) : 0) + (limitParam ? parseInt(limitParam) : 100) - 1
            );

        if (propertyId && !isAllProperties) {
            query = query.eq('property_id', propertyId);
        } else if (isAllProperties && isTechScope && !isOwnAssignedQuery) {
            query = query.in('organization_id', techOrgIds);
        } else if (isAllProperties && !isOrgSuperAdmin && !isOwnAssignedQuery && userPropIds.length > 0) {
            query = query.in('property_id', userPropIds);
        }

        if (organizationId && !isAllOrgs) query = query.eq('organization_id', organizationId);
        if (status) {
            if (status.includes(',')) {
                query = query.in('status', status.split(',').map(s => s.trim()));
            } else {
                query = query.eq('status', status);
            }
        }

        // Internal tickets isolation: Tenants and Vendors can NEVER access internal tickets
        if (isTenant || isVendor) {
            query = query.eq('internal', false);
        } else if (isInternal !== null && isInternal !== undefined) {
            query = query.eq('internal', isInternal === 'true');
        }

        // Vendor scoping: Vendors only see tickets assigned to them
        if (isVendor && !isOrgSuperAdmin && !isPropertyAdmin && !isStaffOrMst) {
            query = query.eq('assigned_to', user.id);
        } else if (assignedTo) {
            query = query.eq('assigned_to', assignedTo);
        }
        if (raisedBy) query = query.eq('raised_by', raisedBy);
        if (vendorTagged === 'true') {
            query = query.eq('needs_vendor_procurement', true);
        } else if (vendorTagged === 'false') {
            query = query.eq('needs_vendor_procurement', false);
        }
        if (slaBreached === 'true') {
            // Include tickets where sla_deadline has passed OR sla_breached flag is explicitly set, excluding paused
            query = query
                .or(`sla_deadline.lt.${new Date().toISOString()},sla_breached.eq.true`)
                .neq('sla_paused', true)
                .not('status', 'in', '("resolved","closed")');
        } else if (slaBreached === 'false') {
            query = query.or(`sla_deadline.gte.${new Date().toISOString()},sla_deadline.is.null,status.in.("resolved","closed")`);
        }
        // Manual date range handling (ensuring IST boundaries)
        if (dateFrom) {
            // If it's a plain date (YYYY-MM-DD), treat as 00:00:00 IST
            const fromStr = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00+05:30`;
            query = query.gte('created_at', fromStr);
        }
        if (dateTo) {
            // If it's a plain date (YYYY-MM-DD), treat as 23:59:59 IST
            const toStr = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59+05:30`;
            query = query.lte('created_at', toStr);
        }
        if (search) query = query.or(`ticket_number.ilike.%${search}%,title.ilike.%${search}%`);
        if (skillGroup && skillGroup !== 'all') query = query.eq('skill_group_code', skillGroup);
        if (floorNumber !== null && floorNumber !== undefined && floorNumber !== 'all') {
            if (floorNumber === 'unspecified') {
                query = query.or('floor_number.is.null,floor_number.eq.""');
            } else {
                query = query.eq('floor_number', floorNumber);
            }
        }

        // Handle predefined periods (e.g., today)
        if (period === 'today') {
            const now = new Date();
            // Offset for IST (UTC+5:30)
            const offset = 5.5 * 60 * 60 * 1000;
            const istNow = new Date(now.getTime() + offset);
            
            const startOfDay = new Date(now.getTime());
            startOfDay.setUTCHours(0 - 5, 0 - 30, 0, 0); // 00:00 IST = 18:30 UTC yesterday
            
            const endOfDay = new Date(now.getTime());
            endOfDay.setUTCHours(23 - 5, 59 - 30, 59, 999); // 23:59 IST = 18:29 UTC today
            
            // Re-calculate more cleanly to avoid negative hour issues
            const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            todayIST.setHours(0, 0, 0, 0);
            const istStart = new Date(todayIST.getTime());
            const istEnd = new Date(todayIST.getTime() + 24 * 60 * 60 * 1000 - 1);

            query = query.gte('created_at', istStart.toISOString());
            query = query.lte('created_at', istEnd.toISOString());
        }

        // Filter by the role of the user who raised the ticket
        if (raisedByRole) {
            // Get user IDs with the specified role from memberships
            let membershipQuery;
            if (propertyId && !isAllProperties) {
                // Scoped: only tenants of this specific property
                membershipQuery = supabase
                    .from('property_memberships')
                    .select('user_id')
                    .eq('property_id', propertyId)
                    .eq('role', raisedByRole)
                    .eq('is_active', true);
            } else if (organizationId && !isAllOrgs) {
                // Scoped: users with this role across any property in this org
                membershipQuery = supabase
                    .from('property_memberships')
                    .select('user_id, properties!inner(organization_id)')
                    .eq('properties.organization_id', organizationId)
                    .eq('role', raisedByRole)
                    .eq('is_active', true);
            }
            else {
                // Global fallback: all users with this role across all properties
                membershipQuery = supabase
                    .from('property_memberships')
                    .select('user_id')
                    .eq('role', raisedByRole)
                    .eq('is_active', true);
            }

            const { data: members, error: memberError } = await membershipQuery;
            if (memberError) {
                console.error('Error fetching members by role:', memberError);
            } else if (members && members.length > 0) {
                // Deduplicate user IDs
                const userIds = [...new Set(members.map((m: any) => m.user_id))];
                query = query.in('raised_by', userIds);
            } else {
                // No users with this role found – return empty result
                return NextResponse.json({ tickets: [] });
            }
        }

        const { data: tickets, error: fetchError, count } = await query;

        if (fetchError) {
            console.error('Error fetching tickets:', fetchError);
            return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
        }

        return NextResponse.json({ 
            tickets: tickets || [], 
            total: (typeof count === 'number') ? count : (tickets?.length || 0)
        });
    } catch (error) {
        console.error('Tickets API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/tickets
 * Create a new ticket with automatic department classification.
 * Supports both cookie-based auth (web) and Bearer token auth (mobile).
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            description,
            property_id,
            propertyId,
            organization_id,
            organizationId,
            is_internal,
            isInternal,
            title,
            priority: explicitPriority,
            department: explicitDepartment, // Allow explicit department override
            assignedTo,
            photo_before_url,
            photoBeforeUrl,
            video_before_url,
            videoBeforeUrl
        } = body;

        const propId = property_id || propertyId;
        const orgId = organization_id || organizationId;
        const internalValue = is_internal ?? isInternal ?? false;

        if (!description || !propId || !orgId) {
            return NextResponse.json(
                { error: 'Missing required fields: description, propertyId, organizationId' },
                { status: 400 }
            );
        }

        // Tenants/clients can NEVER create internal tickets. Force internal to false for tenant role.
        const adminClient = createAdminClient();
        const { data: userPropMembership } = await adminClient
            .from('property_memberships')
            .select('role')
            .eq('property_id', propId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();

        let isTenant = userPropMembership?.role === 'tenant' || userPropMembership?.role === 'super_tenant';
        if (!userPropMembership) {
            const { data: userOrgMembership } = await adminClient
                .from('organization_memberships')
                .select('role')
                .eq('organization_id', orgId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (userOrgMembership?.role === 'tenant' || userOrgMembership?.role === 'super_tenant') {
                isTenant = true;
            }
        }

        const effectiveInternal = isTenant ? false : internalValue;

        // 1. Owner 2026-11-15: the AI sorts every ticket (title AND description), choosing from this property's
        //    categories; the keyword rules only decide when every model fails (backend/lib/ticketing/resolver.ts).
        let categoryId = null;
        let skillGroupId = null;
        let priority = 'medium';
        let slaHours = 24;

        const ticketText = [title, description].map(s => String(s ?? '').trim()).filter(Boolean).filter((s, i, all) => all.indexOf(s) === i).join('\n');
        const [resolution, hierarchyRes] = await Promise.all([
            resolveClassification(ticketText, { propertyId: propId, organizationId: orgId }),
            adminClient
                .from('escalation_hierarchies')
                .select('id, property_id')
                .eq('organization_id', orgId)
                .eq('is_default', true)
                .eq('is_active', true)
                .or(`property_id.eq.${propId},property_id.is.null`)
        ]);
        const { issue_code, skill_group, confidence, enhancedClassification, zone, decisionSource } = resolution;
        const isVague = confidence === 'low';
        const defaultHierarchy = (hierarchyRes.data || []).find((h: any) => h.property_id === propId) || (hierarchyRes.data || []).find((h: any) => !h.property_id);

        // 2. The chosen category's row (this property's own first, then the shared one): its team, usual priority, SLA.
        if (issue_code) {
            const { data: catRows, error: catError } = await supabase
                .from('issue_categories')
                .select('id, skill_group_id, priority, sla_hours, property_id')
                .eq('code', issue_code)
                .limit(50);

            if (catError) {
                console.error('[TICKET API] Error fetching category:', catError);
            }

            const catData = (catRows ?? []).find(c => propId && c.property_id === propId) ?? (catRows ?? []).find(c => !c.property_id) ?? (catRows ?? [])[0];
            if (catData) {
                categoryId = catData.id;
                skillGroupId = catData.skill_group_id;
                priority = catData.priority || 'medium';
                slaHours = catData.sla_hours || slaHours;
            } else {
                console.warn('[TICKET API] \u26a0\ufe0f Issue code not found in issue_categories:', issue_code);
            }
        }

        // Fallback: If no skill group found from category, use classification skill_group directly
        if (!skillGroupId) {
            // GLOBAL lookup
            const { data: defaultSkill, error: skillError } = await supabase
                .from('skill_groups')
                .select('id, code, is_manual_assign')
                .eq('code', skill_group)
                .limit(1)
                .maybeSingle();

            if (skillError) {
                console.error('[TICKET API] Error fetching skill group:', skillError);
            }

            if (defaultSkill) {
                skillGroupId = defaultSkill.id;
            } else {
                console.error('[TICKET API] \u274c NO SKILL GROUP FOUND for code:', skill_group);
            }
        }

        // 3. CREATE TICKET
        const ticketNumber = propId
            ? await generateNextTicketNumber(supabase, propId, orgId)
            : `AP-GEN-${Date.now()}`;

        const ticketPriority = (() => {
            if (explicitPriority) return explicitPriority;
            // The AI may only raise the category's usual priority ('critical' counts as the top, never lowered).
            const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3, critical: 3 };
            const groqP = resolution.priority?.toLowerCase() || '';
            return (priorityRank[groqP] ?? -1) > (priorityRank[priority] ?? -1) ? groqP : priority;
        })();
        const { data: ticket, error: insertError } = await supabase
            .from('tickets')
            .insert({
                ticket_number: ticketNumber,
                property_id: propId,
                organization_id: orgId,
                title: title || description.slice(0, 100),
                description,
                category_id: categoryId,
                skill_group_id: skillGroupId,
                priority: ticketPriority,
                status: assignedTo ? 'assigned' : 'open',
                assigned_to: assignedTo || undefined,
                raised_by: user.id,
                internal: effectiveInternal,
                is_internal: effectiveInternal,
                is_vague: isVague,
                // 2026-11-19: a category can have a different SLA per priority (Brain → Categories & SLAs).
                sla_hours: await slaHoursFor(supabase, categoryId, ticketPriority, slaHours),
                floor_number: extractFloorNumber(title || description) ?? undefined,
                location: extractLocation(title || description) ?? undefined,
                // Tracking fields
                issue_code: issue_code,
                skill_group_code: skill_group,
                confidence: confidence,
                // AI-Assisted Enrichment
                secondary_category_code: resolution.secondary_category_code,
                risk_flag: resolution.risk_flag,
                llm_reasoning: resolution.llm_reasoning,
                classification_source: decisionSource,
                // The AI's own 0–100 rating (shown as "72% (Medium)"); the keyword rules keep the old fixed 100
                confidence_score: resolution.confidenceScore ?? 100,
                // Escalation hierarchy attached directly on insert (saves separate update & re-fetch)
                hierarchy_id: defaultHierarchy?.id,
                current_escalation_level: defaultHierarchy ? 0 : undefined,
                escalation_last_action_at: defaultHierarchy ? new Date().toISOString() : undefined,
                photo_before_url: photo_before_url || photoBeforeUrl || undefined,
                video_before_url: video_before_url || videoBeforeUrl || undefined
            })
            .select('*')
            .single();

        if (insertError) {
            console.error('[TICKET API] Insert Error:', insertError);
            return NextResponse.json({
                error: `Failed to create ticket: ${insertError.message}`
            }, { status: 500 });
        }

        const finalTicket = ticket;

        // Auto-assign ticket to a resolver if not already assigned
        if (!assignedTo && finalTicket.status === 'open') {
            try {
                const assignmentResult = await processIntelligentAssignment(
                    supabase,
                    [{ 
                        id: finalTicket.id, 
                        property_id: propId, 
                        skill_group_code: skill_group,
                        title: finalTicket.title,
                        description: finalTicket.description
                    }],
                    propId
                );

                const assignment = assignmentResult?.results?.[0];
                if (assignment && assignment.assignedTo) {
                    finalTicket.status = assignment.status;
                    finalTicket.assigned_to = assignment.assignedTo;
                    finalTicket.assigned_at = new Date().toISOString();
                }
            } catch (assignErr) {
                console.error('[Ticket API] Auto-assignment error:', assignErr);
            }
        }

        // Log classification decision asynchronously
        logClassification(finalTicket.id, resolution).catch(err => {
            console.error('[Ticket API] Classification logging error:', err);
        });

        // Notifications are not sent from here. The INSERT above fires trg_tickets_outbox, and the
        // Omnichannel matrix (Settings -> Notifications -> Tickets) decides the recipients and the
        // channels for every one of them — email, WhatsApp and in-app/push alike.

        return NextResponse.json({
            success: true,
            ticket: finalTicket,
            classification: {
                issue_code,
                skill_group,
                confidence,
                isAutoClassified: !explicitDepartment,
                enhancedClassification,
                zone,
                decisionSource,
                status: finalTicket.status,
                assigned_to: finalTicket.assigned_to,
            },
        }, { status: 201 });
    } catch (error) {
        console.error('Create ticket API error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
