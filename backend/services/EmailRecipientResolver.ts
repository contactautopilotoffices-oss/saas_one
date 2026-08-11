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

export const DEFAULT_EMAIL_SERVICE_CONFIG: Record<string, FeatureEmailConfig> = {
    material_requests: {
        enabled: true,
        roles: ['procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_assignee: true
    },
    comparative_quotes: {
        enabled: true,
        roles: ['org_super_admin', 'procurement'],
        user_ids: [],
        custom_emails: [],
        notify_approver: true
    },
    material_delivery: {
        enabled: true,
        roles: ['property_admin', 'procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    },
    monthly_requisitions: {
        enabled: true,
        roles: ['procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: []
    },
    meeting_rooms: {
        enabled: true,
        roles: ['property_admin', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    },
    crm_leads: {
        enabled: true,
        roles: ['org_super_admin'],
        user_ids: [],
        custom_emails: ['saniel@worksquare.in', 'rushab@worksquare.in', 'nirupam.lahiri@worksquare.in', 'lohitexplores@gmail.com'],
        notify_assignee: true
    },
    procurement: {
        enabled: true,
        roles: ['procurement'],
        user_ids: [],
        custom_emails: []
    },
    procurement_vendor_aligned: {
        enabled: true,
        roles: [],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    }
};

const ORG_SCOPED_ROLES = new Set([
    'org_super_admin', 'master_admin', 'procurement', 'procurement_user', 'org_admin', 'owner'
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
            .select('email_service_config, email_preferences')
            .eq('organization_id', organizationId)
            .maybeSingle();

        const orgConfigMap = orgData?.email_service_config || {};
        const legacyPrefs = orgData?.email_preferences || {};

        // Merge config with default fallback
        let featureConfig: FeatureEmailConfig = orgConfigMap[featureKey] || DEFAULT_EMAIL_SERVICE_CONFIG[featureKey] || {
            enabled: true,
            roles: [],
            user_ids: [],
            custom_emails: []
        };

        // Check if property-specific override exists for this propertyId
        if (propertyId && featureConfig.property_overrides && featureConfig.property_overrides[propertyId]) {
            const override = featureConfig.property_overrides[propertyId];
            featureConfig = {
                ...featureConfig,
                ...override,
                enabled: override.enabled !== undefined ? override.enabled : featureConfig.enabled
            };
        }

        // Check if feature is disabled
        const isEnabled = featureConfig.enabled !== false;
        if (!isEnabled) {
            return { enabled: false, emails: [], config: featureConfig };
        }

        const targetRoles = featureConfig.roles || [];
        const targetUserIds = featureConfig.user_ids || [];

        const orgRoles = targetRoles.filter(r => ORG_SCOPED_ROLES.has(r.toLowerCase()));
        const propertyRoles = targetRoles.filter(r => !ORG_SCOPED_ROLES.has(r.toLowerCase()));

        const recipientEmails = new Set<string>();

        // Include contextual emails (e.g. assigned user or requester if enabled)
        contextualEmails.forEach(e => {
            if (e && typeof e === 'string' && e.trim()) {
                recipientEmails.add(e.trim().toLowerCase());
            }
        });

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
