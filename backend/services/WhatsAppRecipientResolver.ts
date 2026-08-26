import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface FeatureWhatsAppConfig {
    enabled?: boolean;
    roles?: string[];
    user_ids?: string[];
    property_overrides?: Record<string, {
        enabled?: boolean;
        roles?: string[];
        user_ids?: string[];
    }>;
    notify_assignee?: boolean;
    notify_requester?: boolean;
    notify_approver?: boolean;
    reminder_minutes?: number | null;
}

const ORG_SCOPED_ROLES = new Set([
    'org_super_admin', 'master_admin', 'procurement', 'procurement_user', 'org_admin', 'owner', 'admin',
    'bd_admin', 'bd_super_admin', 'bd_rep', 'sales', 'sales_executive', 'accounts'
]);

export interface ResolvedWhatsAppUser {
    id: string;
    phone: string;
    name: string | null;
}

export interface ResolveWhatsAppRecipientsOptions {
    organizationId: string;
    propertyId?: string | null;
    featureKey: string;
    contextualUserIds?: (string | null | undefined)[];
}

export interface ResolveWhatsAppRecipientsResult {
    enabled: boolean;
    users: ResolvedWhatsAppUser[];
    config: FeatureWhatsAppConfig;
}

const ALIAS_MAP: Record<string, string> = {
    meeting_rooms: 'meeting_room_booked',
    tickets: 'ticket_created',
    material_requests: 'material_request_created',
    comparative_quotes: 'comparative_uploaded',
    material_delivery: 'material_delivered',
    monthly_requisitions: 'monthly_requisition_uploaded',
    crm_leads: 'lead_created',
    checklists: 'checklist_slot_reminder',
    ppm: 'reminder_ppm'
};

export const DEFAULT_WHATSAPP_SERVICE_CONFIG: Record<string, FeatureWhatsAppConfig> = {
    ticket_created: { enabled: true, roles: ['property_admin', 'staff'], user_ids: [], notify_assignee: true, notify_requester: true },
    ticket_assigned: { enabled: true, roles: [], user_ids: [], notify_assignee: true },
    ticket_completed: { enabled: true, roles: [], user_ids: [], notify_requester: true },
    reminder_ticket_sla: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true, reminder_minutes: 30 },
    checklist_slot_reminder: { enabled: true, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true, reminder_minutes: 30 },
    checklist_started: { enabled: true, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true },
    checklist_completed: { enabled: true, roles: ['property_admin', 'soft_service_manager', 'soft_service_supervisor'], user_ids: [], notify_requester: true },
    checklist_overdue_alert: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true },
    checklist_rated: { enabled: true, roles: [], user_ids: [], notify_requester: true },
    checklists: { enabled: true, roles: ['property_admin'], user_ids: [] },
    daily_property_report: { enabled: true, roles: ['org_super_admin', 'owner', 'admin'], user_ids: [] },
    material_request_created: { enabled: true, roles: ['procurement', 'org_super_admin'], user_ids: [], notify_assignee: true },
    material_requests: { enabled: true, roles: ['procurement', 'org_super_admin'], user_ids: [], notify_assignee: true },
    comparative_uploaded: { enabled: true, roles: ['org_super_admin', 'procurement'], user_ids: [], notify_approver: true },
    comparative_quotes: { enabled: true, roles: ['org_super_admin', 'procurement'], user_ids: [], notify_approver: true },
    comparative_approved: { enabled: true, roles: ['procurement'], user_ids: [], notify_requester: true },
    comparative_rejected: { enabled: true, roles: ['procurement'], user_ids: [] },
    material_delivered: { enabled: true, roles: ['property_admin', 'procurement'], user_ids: [], notify_requester: true },
    material_delivery: { enabled: true, roles: ['property_admin', 'procurement'], user_ids: [], notify_requester: true },
    monthly_requisition_uploaded: { enabled: true, roles: ['procurement', 'org_super_admin'], user_ids: [], notify_requester: true },
    monthly_requisitions: { enabled: true, roles: ['procurement', 'org_super_admin'], user_ids: [], notify_requester: true },
    requisition_submitted: { enabled: true, roles: ['procurement', 'org_super_admin'], notify_requester: true },
    requisition_approval_requested: { enabled: true, roles: ['org_super_admin'], user_ids: [], notify_approver: true },
    requisition_status_updated: { enabled: true, roles: ['procurement'], user_ids: [], notify_requester: true },
    requisition_po_issued: { enabled: true, roles: ['property_admin'], user_ids: [], notify_requester: true },
    procurement_vendor_tag: { enabled: true, roles: ['procurement'], user_ids: [] },
    procurement_vendor_aligned: { enabled: true, roles: [], user_ids: [], notify_requester: true },
    meeting_rooms: { enabled: true, roles: ['property_admin'], user_ids: [], notify_requester: true },
    meeting_room_booked: { enabled: true, roles: ['property_admin'], user_ids: [], notify_requester: true },
    meeting_room_cancelled: { enabled: true, roles: ['property_admin'], user_ids: [], notify_requester: true },
    reminder_ppm: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], reminder_minutes: 1440 },
    lead_created: { enabled: true, roles: ['sales', 'org_super_admin'], user_ids: [] },
    lead_assigned: { enabled: true, roles: [], user_ids: [], notify_assignee: true },
    crm_leads: { enabled: true, roles: ['sales', 'org_super_admin'], user_ids: [] }
};

export const WhatsAppRecipientResolver = {
    /**
     * Resolves target WhatsApp recipients (users with phone numbers) for a feature event
     * based on the org's whatsapp_service_config or omnichannel matrix.
     */
    async resolveRecipients(options: ResolveWhatsAppRecipientsOptions): Promise<ResolveWhatsAppRecipientsResult> {
        const { organizationId, propertyId, featureKey, contextualUserIds = [] } = options;

        if (!organizationId) {
            return { enabled: false, users: [], config: DEFAULT_WHATSAPP_SERVICE_CONFIG[featureKey] || {} };
        }

        // 1. Fetch organization settings
        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('notification_matrix, whatsapp_service_config')
            .eq('organization_id', organizationId)
            .maybeSingle();

        const matrix = orgData?.notification_matrix || {};
        const orgConfigMap = (orgData as any)?.whatsapp_service_config || {};

        // Find matrix rule for this featureKey across all modules
        const searchKeys = [featureKey, ALIAS_MAP[featureKey]].filter(Boolean);
        let matrixRule: any = null;
        for (const key of searchKeys) {
            for (const mod of Object.values(matrix)) {
                if (mod && typeof mod === 'object' && (mod as any)[key]) {
                    matrixRule = (mod as any)[key];
                    break;
                }
            }
            if (matrixRule) break;
        }

        let featureConfig: FeatureWhatsAppConfig;
        if (matrixRule) {
            let propOverride: any = null;
            if (propertyId && matrixRule.property_overrides && matrixRule.property_overrides[propertyId]) {
                propOverride = matrixRule.property_overrides[propertyId];
            }

            const isWhatsAppEnabled = propOverride
                ? (propOverride.channels?.whatsapp === true)
                : (matrixRule.channels?.whatsapp === true);

            featureConfig = {
                enabled: isWhatsAppEnabled,
                roles: propOverride?.roles || matrixRule.roles || [],
                user_ids: propOverride?.user_ids || matrixRule.user_ids || [],
                notify_assignee: propOverride?.notify_assignee !== undefined ? propOverride.notify_assignee !== false : matrixRule.notify_assignee !== false,
                notify_requester: propOverride?.notify_requester !== undefined ? propOverride.notify_requester !== false : matrixRule.notify_requester !== false,
                notify_approver: propOverride?.notify_approver !== undefined ? propOverride.notify_approver !== false : matrixRule.notify_approver !== false,
                reminder_minutes: propOverride?.reminder_minutes ?? matrixRule.reminder_minutes ?? null,
                property_overrides: matrixRule.property_overrides || {}
            };
        } else {
            featureConfig = orgConfigMap[featureKey] || DEFAULT_WHATSAPP_SERVICE_CONFIG[featureKey] || {
                enabled: false,
                roles: [],
                user_ids: [],
                notify_requester: true,
                notify_assignee: true,
                notify_approver: true
            };

            // Check if property-specific override exists in legacy orgConfigMap
            if (propertyId && featureConfig.property_overrides && featureConfig.property_overrides[propertyId]) {
                const override = featureConfig.property_overrides[propertyId];
                featureConfig = {
                    ...featureConfig,
                    ...override,
                    enabled: override.enabled !== undefined ? override.enabled : featureConfig.enabled
                };
            }
        }

        const isChannelEnabled = featureConfig.enabled !== false;

        const targetRoles = featureConfig.roles || [];
        const targetUserIds = featureConfig.user_ids || [];

        const orgRoles = targetRoles.filter(r => ORG_SCOPED_ROLES.has(r.toLowerCase()));
        const propertyRoles = targetRoles.filter(r => !ORG_SCOPED_ROLES.has(r.toLowerCase()));

        const recipientIds = new Set<string>();

        // Include specific configured individual users
        targetUserIds.forEach(id => {
            if (id && typeof id === 'string' && id.trim()) {
                recipientIds.add(id.trim());
            }
        });

        // Include contextual users only if relevant notify flag is enabled
        if (featureConfig.notify_requester !== false || featureConfig.notify_assignee !== false || featureConfig.notify_approver !== false) {
            contextualUserIds.forEach(id => {
                if (id && typeof id === 'string' && id.trim()) {
                    recipientIds.add(id.trim());
                }
            });
        }

        // 2. Parallel Database Lookups
        const tasks: Promise<any>[] = [];

        // Task A: Org Memberships by role
        if (orgRoles.length > 0) {
            tasks.push(
                Promise.resolve(
                    supabaseAdmin
                        .from('organization_memberships')
                        .select('user_id')
                        .eq('organization_id', organizationId)
                        .eq('is_active', true)
                        .in('role', orgRoles)
                )
            );
        } else {
            tasks.push(Promise.resolve(null));
        }

        // Task B: Property Memberships by role (Strictly scoped by property_id)
        if (propertyId && propertyRoles.length > 0) {
            tasks.push(
                Promise.resolve(
                    supabaseAdmin
                        .from('property_memberships')
                        .select('user_id')
                        .eq('property_id', propertyId)
                        .eq('is_active', true)
                        .in('role', propertyRoles)
                )
            );
        } else {
            tasks.push(Promise.resolve(null));
        }

        const [orgMemsRes, propMemsRes] = await Promise.all(tasks);

        if (orgMemsRes?.data) {
            orgMemsRes.data.forEach((m: any) => { if (m?.user_id) recipientIds.add(m.user_id); });
        }

        if (propMemsRes?.data) {
            propMemsRes.data.forEach((m: any) => { if (m?.user_id) recipientIds.add(m.user_id); });
        }

        // Explicit user ids from config
        targetUserIds.forEach(id => { if (id) recipientIds.add(id); });

        if (recipientIds.size === 0) {
            return { enabled: true, users: [], config: featureConfig };
        }

        // 3. Fetch user rows from public.users table
        const { data: users } = await supabaseAdmin
            .from('users')
            .select('id, phone, full_name')
            .in('id', Array.from(recipientIds));

        const userMap = new Map<string, any>((users || []).map(u => [u.id, u]));

        // Check for any recipient IDs whose phone is missing from public.users table
        const missingPhoneIds = Array.from(recipientIds).filter(id => {
            const u = userMap.get(id);
            return !u?.phone || String(u.phone).replace(/[^0-9+]/g, '').trim().length < 10;
        });

        if (missingPhoneIds.length > 0) {
            await Promise.all(
                missingPhoneIds.map(async (uid) => {
                    try {
                        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
                        if (authUser?.user) {
                            const rawPhone = authUser.user.phone || authUser.user.user_metadata?.phone;
                            if (rawPhone) {
                                const cleanPhone = String(rawPhone).replace(/[^0-9+]/g, '').trim();
                                if (cleanPhone.length >= 10) {
                                    userMap.set(uid, {
                                        id: uid,
                                        phone: cleanPhone,
                                        full_name: authUser.user.user_metadata?.full_name || userMap.get(uid)?.full_name || null
                                    });
                                    // Auto-sync back to public.users table in the background
                                    supabaseAdmin
                                        .from('users')
                                        .update({ phone: cleanPhone })
                                        .eq('id', uid)
                                        .then();
                                }
                            }
                        }
                    } catch (e) {
                        // ignore background fallback errors
                    }
                })
            );
        }

        const resolvedUsers: ResolvedWhatsAppUser[] = Array.from(userMap.values())
            .map((u: any) => {
                const rawPhone = u?.phone;
                const cleanPhone = rawPhone ? String(rawPhone).replace(/[^0-9+]/g, '').trim() : '';
                return {
                    id: u.id,
                    phone: cleanPhone,
                    name: u.full_name || null
                };
            })
            .filter(u => u.phone && u.phone.length >= 10);

        return {
            enabled: isChannelEnabled,
            users: resolvedUsers,
            config: featureConfig
        };
    }
};
