import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface FeatureEmailConfig {
    enabled?: boolean;
    roles?: string[];
    user_ids?: string[];
    custom_emails?: string[];
    property_overrides?: Record<string, {
        enabled?: boolean;
        roles?: string[];
        user_ids?: string[];
        custom_emails?: string[];
    }>;
    notify_assignee?: boolean;
    notify_requester?: boolean;
    notify_approver?: boolean;
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
    ppm: 'reminder_ppm',
    cafeteria_revenue: 'vendor_revenue_recorded',
    vendor_revenue: 'vendor_revenue_recorded'
};

export const DEFAULT_EMAIL_SERVICE_CONFIG: Record<string, FeatureEmailConfig> = {
    vendor_revenue_recorded: { enabled: true, roles: ['property_admin', 'org_super_admin', 'accounts'], user_ids: [], notify_requester: true },
    vendor_revenue_reminder: { enabled: true, roles: ['property_admin'], user_ids: [], notify_assignee: true, notify_requester: true },
    ticket_created: { enabled: true, roles: ['property_admin', 'staff'], user_ids: [], notify_assignee: true, notify_requester: true },
    ticket_assigned: { enabled: true, roles: [], user_ids: [], notify_assignee: true },
    ticket_completed: { enabled: true, roles: [], user_ids: [], notify_requester: true },
    reminder_ticket_sla: { enabled: false, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true },
    checklist_slot_reminder: { enabled: false, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true },
    checklist_started: { enabled: false, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true },
    checklist_completed: { enabled: true, roles: ['property_admin', 'soft_service_manager', 'soft_service_supervisor'], user_ids: [], notify_requester: true },
    checklist_overdue_alert: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true },
    checklist_rated: { enabled: false, roles: [], user_ids: [], notify_requester: true },
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
    monthly_requisitions: { enabled: true, roles: ['procurement', 'org_super_admin'], user_ids: [] },
    requisition_approval_requested: { enabled: true, roles: ['org_super_admin'], user_ids: [], notify_approver: true },
    requisition_status_updated: { enabled: true, roles: ['procurement'], user_ids: [], notify_requester: true },
    requisition_po_issued: { enabled: true, roles: ['property_admin'], user_ids: [], notify_requester: true },
    procurement_vendor_tag: { enabled: true, roles: ['procurement'], user_ids: [] },
    procurement_vendor_aligned: { enabled: true, roles: [], user_ids: [], notify_requester: true },
    meeting_rooms: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_requester: true },
    meeting_room_booked: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_requester: true },
    meeting_room_cancelled: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_requester: true },
    reminder_ppm: { enabled: true, roles: ['property_admin', 'org_super_admin'], user_ids: [] },
    lead_created: { enabled: true, roles: ['sales', 'org_super_admin'], user_ids: [] },
    lead_assigned: { enabled: true, roles: [], user_ids: [], notify_assignee: true },
    crm_leads: { enabled: true, roles: ['org_super_admin'], user_ids: [], notify_assignee: true }
};

const ORG_SCOPED_ROLES = new Set([
    'org_super_admin', 'master_admin', 'procurement', 'procurement_user', 'org_admin', 'owner', 'admin',
    'bd_admin', 'bd_super_admin', 'bd_rep', 'sales', 'sales_executive', 'accounts'
]);

export interface ResolveRecipientsOptions {
    organizationId: string;
    propertyId?: string | null;
    featureKey: string;
    contextualEmails?: (string | null | undefined)[];
}

export interface ResolvedRecipientsResult {
    enabled: boolean;
    emails: string[];
    config: FeatureEmailConfig;
}

export const EmailRecipientResolver = {
    /**
     * Resolves target email addresses for a specific feature event dynamically based on org email settings.
     */
    async resolveRecipients(options: ResolveRecipientsOptions): Promise<ResolvedRecipientsResult> {
        const { organizationId, propertyId, featureKey, contextualEmails = [] } = options;

        if (!organizationId) {
            return { enabled: true, emails: [], config: DEFAULT_EMAIL_SERVICE_CONFIG[featureKey] || {} };
        }

        // 1. Fetch organization settings
        const { data: orgData } = await supabaseAdmin
            .from('organization_settings')
            .select('notification_matrix, email_service_config, email_preferences')
            .eq('organization_id', organizationId)
            .maybeSingle();

        const matrix = orgData?.notification_matrix || {};
        const orgConfigMap = orgData?.email_service_config || {};

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

        let featureConfig: FeatureEmailConfig;
        if (matrixRule) {
            let propOverride: any = null;
            if (propertyId && matrixRule.property_overrides && matrixRule.property_overrides[propertyId]) {
                propOverride = matrixRule.property_overrides[propertyId];
            }

            const isEmailEnabled = (propOverride && propOverride.channels && propOverride.channels.email !== undefined)
                ? (propOverride.channels.email === true)
                : (matrixRule.channels?.email === true);

            featureConfig = {
                enabled: isEmailEnabled,
                roles: propOverride?.roles || matrixRule.roles || [],
                user_ids: propOverride?.user_ids || matrixRule.user_ids || [],
                custom_emails: propOverride?.custom_emails || matrixRule.custom_emails || [],
                notify_assignee: propOverride?.notify_assignee !== undefined ? propOverride.notify_assignee !== false : matrixRule.notify_assignee !== false,
                notify_requester: propOverride?.notify_requester !== undefined ? propOverride.notify_requester !== false : matrixRule.notify_requester !== false,
                notify_approver: propOverride?.notify_approver !== undefined ? propOverride.notify_approver !== false : matrixRule.notify_approver !== false,
                property_overrides: matrixRule.property_overrides || {}
            };
        } else {
            featureConfig = orgConfigMap[featureKey] || DEFAULT_EMAIL_SERVICE_CONFIG[featureKey] || {
                enabled: false,
                roles: [],
                user_ids: [],
                custom_emails: []
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

        // Check if feature email channel is disabled
        if (!featureConfig.enabled) {
            return { enabled: false, emails: [], config: featureConfig };
        }

        const targetRoles = featureConfig.roles || [];
        const targetUserIds = featureConfig.user_ids || [];
        const customEmails = featureConfig.custom_emails || [];

        const orgRoles = targetRoles.filter(r => ORG_SCOPED_ROLES.has(r.toLowerCase()));
        const propertyRoles = targetRoles.filter(r => !ORG_SCOPED_ROLES.has(r.toLowerCase()));

        const recipientEmails = new Set<string>();

        // Include explicit custom emails
        customEmails.forEach(e => {
            if (e && typeof e === 'string' && e.trim()) {
                recipientEmails.add(e.trim().toLowerCase());
            }
        });

        // Include contextual emails only if contextual notify is enabled
        if (featureConfig.notify_requester !== false || featureConfig.notify_assignee !== false || featureConfig.notify_approver !== false) {
            contextualEmails.forEach(e => {
                if (e && typeof e === 'string' && e.trim()) {
                    recipientEmails.add(e.trim().toLowerCase());
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
                        .select('users:user_id(email)')
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
                        .select('users:user_id(email)')
                        .eq('property_id', propertyId)
                        .eq('is_active', true)
                        .in('role', propertyRoles)
                )
            );
        } else {
            tasks.push(Promise.resolve(null));
        }

        // Task C: Direct Users by ID
        if (targetUserIds.length > 0) {
            tasks.push(
                Promise.resolve(
                    supabaseAdmin
                        .from('users')
                        .select('email')
                        .in('id', targetUserIds)
                )
            );
        } else {
            tasks.push(Promise.resolve(null));
        }

        // Task D: Procurement User fallback if procurement role is requested
        if (targetRoles.some(r => r.toLowerCase().includes('procurement'))) {
            tasks.push(
                Promise.resolve(
                    supabaseAdmin
                        .from('users')
                        .select('email, role')
                        .or('role.eq.procurement,role.eq.procurement_user,email.ilike.%procurement%,email.ilike.%purchase%')
                )
            );
        } else {
            tasks.push(Promise.resolve(null));
        }

        const [orgMemsRes, propMemsRes, directUsersRes, procurementUsersRes] = await Promise.all(tasks);

        // Process Org Memberships
        if (orgMemsRes?.data) {
            orgMemsRes.data.forEach((m: any) => {
                const email = m.users?.email || (Array.isArray(m.users) ? m.users[0]?.email : null);
                if (email) recipientEmails.add(email.toLowerCase());
            });
        }

        // Process Property Memberships
        if (propMemsRes?.data) {
            propMemsRes.data.forEach((m: any) => {
                const email = m.users?.email || (Array.isArray(m.users) ? m.users[0]?.email : null);
                if (email) recipientEmails.add(email.toLowerCase());
            });
        }

        // Process Explicit Users
        if (directUsersRes?.data) {
            directUsersRes.data.forEach((u: any) => {
                if (u?.email) recipientEmails.add(u.email.toLowerCase());
            });
        }

        // Process Procurement Fallback Users
        if (procurementUsersRes?.data) {
            procurementUsersRes.data.forEach((u: any) => {
                if (u?.email) recipientEmails.add(u.email.toLowerCase());
            });
        }

        // Process Explicit / Hardcoded Custom Email Addresses
        if (featureConfig.custom_emails && Array.from(featureConfig.custom_emails).length > 0) {
            featureConfig.custom_emails.forEach((email: string) => {
                if (email && email.trim()) {
                    recipientEmails.add(email.trim().toLowerCase());
                }
            });
        }

        return {
            enabled: true,
            emails: Array.from(recipientEmails),
            config: featureConfig
        };
    }
};
