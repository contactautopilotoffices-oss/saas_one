import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { resolveClassification, logClassification } from '@/backend/lib/ticketing';
import { classifyTicketEnhanced } from '@/backend/lib/ticketing/classifyTicket';
import { processIntelligentAssignment } from '@/backend/lib/ticketing/assignment';

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
        const floorNumber = searchParams.get('floorNumber') || searchParams.get('floor_number') || searchParams.get('floor');

        // Use admin client for org-wide queries to bypass RLS row restrictions
        const queryClient = (organizationId && !propertyId) ? createAdminClient() : supabase;

        let selectStr = `
                id, ticket_number, title, status, priority, created_at, internal, raised_by, assigned_to,
                resolved_at,
                category:issue_categories(id, code, name),
                skill_group:skill_groups(id, code, name),
                creator:users!raised_by(id, full_name, email, user_photo_url, property_memberships(role, property_id)),
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

        if (propertyId) query = query.eq('property_id', propertyId);
        if (organizationId) query = query.eq('organization_id', organizationId);
        if (status) {
            if (status.includes(',')) {
                query = query.in('status', status.split(',').map(s => s.trim()));
            } else {
                query = query.eq('status', status);
            }
        }
        if (isInternal !== null && isInternal !== undefined) {
            query = query.eq('internal', isInternal === 'true');
        }
        if (assignedTo) query = query.eq('assigned_to', assignedTo);
        if (raisedBy) query = query.eq('raised_by', raisedBy);
        if (slaBreached === 'true') {
            // Include tickets where sla_deadline has passed OR sla_breached flag is explicitly set
            query = query
                .or(`sla_deadline.lt.${new Date().toISOString()},sla_breached.eq.true`)
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
            if (propertyId) {
                // Scoped: only tenants of this specific property
                membershipQuery = supabase
                    .from('property_memberships')
                    .select('user_id')
                    .eq('property_id', propertyId)
                    .eq('role', raisedByRole)
                    .eq('is_active', true);
            } else if (organizationId) {
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

        // 1. Quick rule-based pre-pass to get DB priority BEFORE Groq runs
        const preClassification = classifyTicketEnhanced(title || description);
        let categoryId = null;
        let skillGroupId = null;
        let priority = 'medium';
        let slaHours = 24;

        if (preClassification.issue_code) {
            const { data: preCatData } = await supabase
                .from('issue_categories')
                .select('id, skill_group_id, priority, sla_hours')
                .eq('code', preClassification.issue_code)
                .limit(1)
                .maybeSingle();
            if (preCatData) {
                categoryId = preCatData.id;
                skillGroupId = preCatData.skill_group_id;
                priority = preCatData.priority || 'medium';
                slaHours = preCatData.sla_hours || 24;
            }
        }

        // 2. Full hybrid classification — pass DB priority so Groq uses it as anchor
        const resolution = await resolveClassification(title || description, priority);
        const { issue_code, skill_group, confidence, enhancedClassification, zone, decisionSource } = resolution;
        const isVague = confidence === 'low';

        // 3. If Groq resolved a different issue_code, re-fetch IDs
        if (issue_code && issue_code !== preClassification.issue_code) {
            const { data: catData, error: catError } = await supabase
                .from('issue_categories')
                .select('id, skill_group_id, priority, sla_hours')
                .eq('code', issue_code)
                .limit(1)
                .maybeSingle();

            if (catError) {
                console.error('[TICKET API] Error fetching category:', catError);
            }

            if (catData) {
                categoryId = catData.id;
                skillGroupId = catData.skill_group_id;
                const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
                if ((priorityRank[catData.priority] ?? 0) > (priorityRank[priority] ?? 0)) {
                    priority = catData.priority;
                }
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
        const ticketNumber = `TKT-${Date.now()}`;

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
                priority: (() => {
                    if (explicitPriority) return explicitPriority;
                    const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
                    const groqP = resolution.priority?.toLowerCase() || '';
                    return (priorityRank[groqP] ?? -1) > (priorityRank[priority] ?? -1) ? groqP : priority;
                })(),
                status: assignedTo ? 'assigned' : 'open',
                assigned_to: assignedTo || undefined,
                raised_by: user.id,
                internal: internalValue,
                is_vague: isVague,
                sla_hours: slaHours,
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
                confidence_score: resolution.llmResult ? 90 : 100
            })
            .select('*')
            .single();

        if (insertError) {
            console.error('[TICKET API] Insert Error:', insertError);
            return NextResponse.json({
                error: `Failed to create ticket: ${insertError.message}`
            }, { status: 500 });
        }

        // Auto-attach the default escalation hierarchy (property-specific first, then org-wide fallback)
        const adminClient = createAdminClient();
        let { data: defaultHierarchy } = await adminClient
            .from('escalation_hierarchies')
            .select('id')
            .eq('organization_id', orgId)
            .eq('property_id', propId)
            .eq('is_default', true)
            .eq('is_active', true)
            .maybeSingle();

        // Fallback: try org-wide hierarchy (property_id IS NULL)
        if (!defaultHierarchy) {
            const { data: orgWideHierarchy } = await adminClient
                .from('escalation_hierarchies')
                .select('id')
                .eq('organization_id', orgId)
                .is('property_id', null)
                .eq('is_default', true)
                .eq('is_active', true)
                .maybeSingle();
            defaultHierarchy = orgWideHierarchy;
        }

        if (defaultHierarchy) {
            await adminClient
                .from('tickets')
                .update({
                    hierarchy_id: defaultHierarchy.id,
                    current_escalation_level: 0,
                    escalation_last_action_at: new Date().toISOString(),
                })
                .eq('id', ticket.id);
        }

        // Re-fetch the ticket for trigger updates
        const { data: updatedTicket } = await supabase
            .from('tickets')
            .select('*')
            .eq('id', ticket.id)
            .single();

        const finalTicket = updatedTicket || ticket;

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

                // Re-fetch the ticket after assignment
                const { data: assignedTicket } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('id', ticket.id)
                    .single();

                if (assignedTicket) {
                    finalTicket.status = assignedTicket.status;
                    finalTicket.assigned_to = assignedTicket.assigned_to;
                }
            } catch (assignErr) {
                console.error('[Ticket API] Auto-assignment error:', assignErr);
            }
        }

        // Log classification decision asynchronously
        logClassification(finalTicket.id, resolution).catch(err => {
            console.error('[Ticket API] Classification logging error:', err);
        });

        // Trigger Web Push Notifications asynchronously
        try {
            const { NotificationService } = await import('@/backend/services/NotificationService');

            // Trigger unified notification (handles both creation broadcast and auto-assignment)
            NotificationService.afterTicketCreated(finalTicket.id).catch(err => {
                console.error('>>>>>>>>>> [NOTIFICATION TEST] Notification error (Unified):', err);
            });

            // If priority is critical, send an urgent alert to all property staff/admins
            if (finalTicket.priority === 'critical') {
                NotificationService.afterCriticalTicketCreated(finalTicket.id).catch(err => {
                    console.error('>>>>>>>>>> [NOTIFICATION TEST] Critical notification error:', err);
                });
            }
        } catch (err) {
            console.error('>>>>>>>>>> [NOTIFICATION TEST] Failed to load NotificationService:', err);
        }

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
