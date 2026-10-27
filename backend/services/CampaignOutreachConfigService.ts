import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { getCityCentrePhoto } from '@/backend/lib/crm/centreMedia';

export interface CampaignOutreachConfig {
    campaign: string;
    city: string;
    outreach_enabled: boolean;
    property_name: string;
    property_photo_url: string;
    assigned_user_id: string | null;
    assigned_advisor_name: string | null;
    is_pilot: boolean;
}

export interface NudgeConfig {
    nudge_enabled: boolean;
    nudge_delay_hours: number;
    nudge_delay_minutes: number;
    nudge_template_name: string;
}

const DEFAULT_BANGALORE_ADVISOR = {
    id: '0889c23c-0028-4b08-af18-b95d602fde28',
    name: 'Harshini Ranganathan',
    phone: '9494608123',
    email: 'harshini.ranganathan@autopilotoffices.com',
};

const SYSTEM_DEFAULT_CONFIGS: Record<string, Partial<CampaignOutreachConfig>> = {
    'test campaign': {
        outreach_enabled: true,
        property_name: 'Autopilot Offices Showcase · Test Centre',
        property_photo_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
        assigned_user_id: DEFAULT_BANGALORE_ADVISOR.id,
        assigned_advisor_name: DEFAULT_BANGALORE_ADVISOR.name,
        city: 'Bangalore',
        is_pilot: true,
    },
    bangalore: {
        outreach_enabled: false,
        property_name: 'Purva Gainz · Bangalore',
        property_photo_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
        assigned_user_id: DEFAULT_BANGALORE_ADVISOR.id,
        assigned_advisor_name: DEFAULT_BANGALORE_ADVISOR.name,
        city: 'Bangalore',
        is_pilot: false,
    },
    bengaluru: {
        outreach_enabled: false,
        property_name: 'Purva Gainz · Bangalore',
        property_photo_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
        assigned_user_id: DEFAULT_BANGALORE_ADVISOR.id,
        assigned_advisor_name: DEFAULT_BANGALORE_ADVISOR.name,
        city: 'Bangalore',
        is_pilot: false,
    },
    'lower parel': {
        outreach_enabled: false,
        property_name: 'Marathon Futurex · Lower Parel',
        property_photo_url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
        city: 'Mumbai',
        is_pilot: false,
    },
    andheri: {
        outreach_enabled: false,
        property_name: 'Kanakia Wall Street · Andheri East',
        property_photo_url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
        city: 'Mumbai',
        is_pilot: false,
    },
    mafatlal: {
        outreach_enabled: false,
        property_name: 'Mafatlal House · Byculla',
        property_photo_url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
        city: 'Mumbai',
        is_pilot: false,
    },
    noida: {
        outreach_enabled: false,
        property_name: 'Skymark One · Noida',
        property_photo_url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
        city: 'Noida',
        is_pilot: false,
    },
    skymark: {
        outreach_enabled: false,
        property_name: 'Skymark One · Noida',
        property_photo_url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
        city: 'Noida',
        is_pilot: false,
    },
};

export class CampaignOutreachConfigService {
    private static CONFIG_NAME = '__campaign_outreach_config__';

    /**
     * Retrieve all configured campaigns for the organization, merging persisted overrides with defaults.
     */
    static async getAllCampaignConfigs(organizationId: string): Promise<CampaignOutreachConfig[]> {
        // 1. Fetch campaigns from distribution rules
        const { data: rules } = await supabaseAdmin
            .from('crm_lead_distribution_rules')
            .select('campaign, mode, members:crm_lead_distribution_members(*, user_info:users(id, full_name, email))')
            .eq('organization_id', organizationId)
            .eq('is_active', true);

        // 2. Fetch distinct campaigns from leads
        const { data: leadCampaigns } = await supabaseAdmin
            .from('crm_leads')
            .select('campaign, city')
            .eq('organization_id', organizationId)
            .not('campaign', 'is', null)
            .limit(200);

        // Gather all unique campaign keys
        const campaignMap = new Map<string, { city?: string; defaultUser?: { id: string; name: string } }>();

        // Always seed standard pilot and operational campaigns
        for (const [key, val] of Object.entries(SYSTEM_DEFAULT_CONFIGS)) {
            campaignMap.set(key.toLowerCase(), {
                city: val.city,
                defaultUser: val.assigned_user_id ? { id: val.assigned_user_id, name: val.assigned_advisor_name || '' } : undefined,
            });
        }

        for (const rule of rules || []) {
            const campKey = (rule.campaign || '').toLowerCase().trim();
            if (campKey) {
                const activeMember = (rule.members || []).find((m: any) => m.is_active);
                campaignMap.set(campKey, {
                    ...campaignMap.get(campKey),
                    defaultUser: activeMember?.user_info ? {
                        id: activeMember.user_info.id,
                        name: activeMember.user_info.full_name || activeMember.user_info.email,
                    } : undefined,
                });
            }
        }

        for (const lc of leadCampaigns || []) {
            const raw = (lc.campaign || '').trim();
            const campKey = raw.toLowerCase();
            if (campKey && !campaignMap.has(campKey)) {
                campaignMap.set(campKey, {
                    city: lc.city || undefined,
                });
            }
        }

        // 3. Load saved overrides from crm_saved_views
        const { data: savedView } = await supabaseAdmin
            .from('crm_saved_views')
            .select('filters')
            .eq('organization_id', organizationId)
            .eq('name', this.CONFIG_NAME)
            .maybeSingle();

        const overrides: Record<string, Partial<CampaignOutreachConfig>> = (savedView?.filters as any) || {};

        // Ensure all saved campaigns from overrides are present in campaignMap
        for (const [overrideKey, overrideVal] of Object.entries(overrides)) {
            const k = overrideKey.toLowerCase().trim();
            if (k && !campaignMap.has(k)) {
                campaignMap.set(k, {
                    city: (overrideVal as any)?.city,
                });
            }
        }

        // 4. Construct final merged list
        const results: CampaignOutreachConfig[] = [];

        for (const [campKey, meta] of campaignMap.entries()) {
            const override = overrides[campKey] || {};
            const systemDef = SYSTEM_DEFAULT_CONFIGS[campKey] || {};
            const isBangalore = campKey.includes('bangalore') || campKey.includes('bengaluru') || (override.city?.toLowerCase() === 'bangalore');

            const outreachEnabled = override.outreach_enabled !== undefined
                ? Boolean(override.outreach_enabled)
                : (override.is_pilot !== undefined ? Boolean(override.is_pilot) : (systemDef.outreach_enabled !== undefined ? Boolean(systemDef.outreach_enabled) : isBangalore));

            const propertyName = override.property_name || systemDef.property_name || `${rawToLabel(campKey)} Centre`;
            const propertyPhotoUrl = override.property_photo_url || systemDef.property_photo_url || getCityCentrePhoto(override.city || meta.city || campKey);

            let assignedUserId = override.assigned_user_id || systemDef.assigned_user_id || meta.defaultUser?.id || null;
            let assignedAdvisorName = override.assigned_advisor_name || systemDef.assigned_advisor_name || meta.defaultUser?.name || null;

            if (isBangalore && !assignedUserId) {
                assignedUserId = DEFAULT_BANGALORE_ADVISOR.id;
                assignedAdvisorName = DEFAULT_BANGALORE_ADVISOR.name;
            }

            results.push({
                campaign: campKey,
                city: meta.city || systemDef.city || (isBangalore ? 'Bangalore' : 'Mumbai'),
                outreach_enabled: outreachEnabled,
                property_name: propertyName,
                property_photo_url: propertyPhotoUrl,
                assigned_user_id: assignedUserId,
                assigned_advisor_name: assignedAdvisorName,
                is_pilot: isBangalore,
            });
        }

        // Put Bangalore at the top, then sort alphabetically
        results.sort((a, b) => {
            if (a.is_pilot && !b.is_pilot) return -1;
            if (!a.is_pilot && b.is_pilot) return 1;
            return a.campaign.localeCompare(b.campaign);
        });

        return results;
    }

    /**
     * Save an updated campaign outreach configuration.
     */
    static async updateCampaignConfig(
        organizationId: string,
        campaign: string,
        updates: Partial<CampaignOutreachConfig>,
        updatedByUserId?: string
    ): Promise<CampaignOutreachConfig> {
        const campKey = campaign.toLowerCase().trim();

        // 1. Get existing overrides
        const { data: savedView } = await supabaseAdmin
            .from('crm_saved_views')
            .select('id, filters')
            .eq('organization_id', organizationId)
            .eq('name', this.CONFIG_NAME)
            .maybeSingle();

        const currentFilters: Record<string, any> = (savedView?.filters as any) || {};
        const existingForCampaign = currentFilters[campKey] || {};

        const mergedForCampaign = {
            ...existingForCampaign,
            ...updates,
            updated_at: new Date().toISOString(),
        };

        currentFilters[campKey] = mergedForCampaign;

        if (savedView?.id) {
            await supabaseAdmin
                .from('crm_saved_views')
                .update({
                    filters: currentFilters,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', savedView.id);
        } else {
            await supabaseAdmin
                .from('crm_saved_views')
                .insert({
                    organization_id: organizationId,
                    created_by: updatedByUserId || DEFAULT_BANGALORE_ADVISOR.id,
                    name: this.CONFIG_NAME,
                    icon: '⚡',
                    color: '#10B981',
                    filters: currentFilters,
                    is_active: false,
                });
        }

        // Also if assigned_user_id changed and this campaign exists in distribution rules, update the member!
        if (updates.assigned_user_id) {
            const { data: rule } = await supabaseAdmin
                .from('crm_lead_distribution_rules')
                .select('id')
                .eq('organization_id', organizationId)
                .ilike('campaign', campKey)
                .maybeSingle();

            if (rule?.id) {
                await supabaseAdmin
                    .from('crm_lead_distribution_members')
                    .update({ is_active: false })
                    .eq('rule_id', rule.id);

                const { data: existingMember } = await supabaseAdmin
                    .from('crm_lead_distribution_members')
                    .select('id')
                    .eq('rule_id', rule.id)
                    .eq('user_id', updates.assigned_user_id)
                    .maybeSingle();

                if (existingMember) {
                    await supabaseAdmin
                        .from('crm_lead_distribution_members')
                        .update({ is_active: true })
                        .eq('id', existingMember.id);
                } else {
                    await supabaseAdmin
                        .from('crm_lead_distribution_members')
                        .insert({ rule_id: rule.id, user_id: updates.assigned_user_id, is_active: true });
                }
            }
        }

        const all = await this.getAllCampaignConfigs(organizationId);
        return all.find((c) => c.campaign === campKey) || {
            campaign: campKey,
            city: 'Bangalore',
            outreach_enabled: mergedForCampaign.outreach_enabled ?? false,
            property_name: mergedForCampaign.property_name || `${campKey} Centre`,
            property_photo_url: mergedForCampaign.property_photo_url || getCityCentrePhoto(campKey),
            assigned_user_id: mergedForCampaign.assigned_user_id || null,
            assigned_advisor_name: mergedForCampaign.assigned_advisor_name || null,
            is_pilot: campKey.includes('bangalore') || campKey.includes('bengaluru'),
        };
    }

    /**
     * Resolves whether outreach should be dispatched for an incoming lead.
     * Matches lead's campaign or city against the active campaign configs.
     */
    static async isOutreachEnabledForLead(params: {
        organization_id?: string | null;
        campaign?: string | null;
        city?: string | null;
        location?: string | null;
        contact_number?: string | null;
    }): Promise<{
        enabled: boolean;
        matchedCampaign: string;
        propertyName: string;
        propertyPhotoUrl: string;
        advisorId: string | null;
        advisorName: string | null;
        city?: string;
        reason?: string;
    }> {
        const leadCampaign = (params.campaign || '').toLowerCase().trim();
        const rawPhone = (params.contact_number || '').replace(/\D/g, '');
        const isTestClientPhone = rawPhone.endsWith('7028232515');

        const orgId = params.organization_id || '211e1330-ad83-446d-941f-dcea48396798';
        const configs = await this.getAllCampaignConfigs(orgId);

        const leadCity = (params.city || params.location || '').toLowerCase().trim();

        // Check if Bangalore
        const isBangalore = leadCampaign.includes('bangalore') ||
            leadCampaign.includes('bengaluru') ||
            leadCity.includes('bangalore') ||
            leadCity.includes('bengaluru');

        // Look for matching campaign config
        let matched: CampaignOutreachConfig | undefined;

        if (leadCampaign) {
            matched = configs.find((c) => leadCampaign === c.campaign.toLowerCase() || leadCampaign.includes(c.campaign.toLowerCase()) || c.campaign.toLowerCase().includes(leadCampaign));
        }

        if (!matched && (isTestClientPhone || leadCampaign.includes('test'))) {
            matched = configs.find((c) => c.campaign.toLowerCase() === 'test campaign');
        }

        if (!matched && leadCity) {
            matched = configs.find((c) => leadCity.includes(c.city.toLowerCase()) || leadCity.includes(c.campaign.toLowerCase()));
        }

        if (isBangalore && !matched) {
            matched = configs.find((c) => c.campaign === 'bangalore' || c.campaign === 'bengaluru');
        }

        if (isTestClientPhone && matched) {
            return {
                enabled: true,
                matchedCampaign: matched.campaign || 'Test Campaign',
                propertyName: matched.property_name || 'Autopilot Offices Showcase · Test Centre',
                propertyPhotoUrl: matched.property_photo_url || getCityCentrePhoto(matched.city || 'Bangalore'),
                advisorId: matched.assigned_user_id || DEFAULT_BANGALORE_ADVISOR.id,
                advisorName: matched.assigned_advisor_name || DEFAULT_BANGALORE_ADVISOR.name,
                city: matched.city || 'Bangalore',
            };
        }

        if (!matched) {
            // If completely unconfigured and is Bangalore, default ON for Bangalore pilot
            if (isBangalore) {
                return {
                    enabled: true,
                    matchedCampaign: 'Bangalore (Pilot)',
                    propertyName: 'Purva Gainz · Bangalore',
                    propertyPhotoUrl: getCityCentrePhoto('bangalore'),
                    advisorId: DEFAULT_BANGALORE_ADVISOR.id,
                    advisorName: DEFAULT_BANGALORE_ADVISOR.name,
                    city: 'Bangalore',
                };
            }

            // Other cities default to OFF until enabled by Org Super Admin
            return {
                enabled: isTestClientPhone ? true : false,
                matchedCampaign: params.campaign || params.city || 'General',
                propertyName: `${params.campaign || params.city || 'Managed Office'} Centre`,
                propertyPhotoUrl: getCityCentrePhoto(params.city),
                advisorId: null,
                advisorName: null,
                city: params.city || 'Mumbai',
                reason: isTestClientPhone ? undefined : 'Campaign outreach is currently switched OFF for this market',
            };
        }

        return {
            enabled: isTestClientPhone ? true : matched.outreach_enabled,
            matchedCampaign: matched.campaign,
            propertyName: matched.property_name,
            propertyPhotoUrl: matched.property_photo_url,
            advisorId: isBangalore ? (matched.assigned_user_id || DEFAULT_BANGALORE_ADVISOR.id) : matched.assigned_user_id,
            advisorName: isBangalore ? (matched.assigned_advisor_name || DEFAULT_BANGALORE_ADVISOR.name) : matched.assigned_advisor_name,
            city: matched.city || (isBangalore ? 'Bangalore' : 'Mumbai'),
            reason: matched.outreach_enabled ? undefined : 'Outreach is paused in campaign settings',
        };
    }

    /**
     * Retrieve the organization's nudge configuration (delay timing, active state, template name).
     */
    static async getNudgeConfig(organizationId: string): Promise<NudgeConfig> {
        // 1. Try from crm_outreach_settings table
        try {
            const { data } = await supabaseAdmin
                .from('crm_outreach_settings')
                .select('nudge_enabled, nudge_delay_hours, nudge_delay_minutes, nudge_template_name')
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (data) {
                const mins = (data as any).nudge_delay_minutes
                    ? Number((data as any).nudge_delay_minutes)
                    : (data.nudge_delay_hours ? Math.round(Number(data.nudge_delay_hours) * 60) : 240);
                const hrs = data.nudge_delay_hours
                    ? Number(data.nudge_delay_hours)
                    : +(mins / 60).toFixed(2);
                return {
                    nudge_enabled: data.nudge_enabled !== undefined ? Boolean(data.nudge_enabled) : true,
                    nudge_delay_hours: hrs,
                    nudge_delay_minutes: mins,
                    nudge_template_name: data.nudge_template_name || 'autopilot_lead_nudge_v1',
                };
            }
        } catch {}

        // 2. Fallback to crm_saved_views for resilience
        try {
            const { data: savedView } = await supabaseAdmin
                .from('crm_saved_views')
                .select('filters')
                .eq('organization_id', organizationId)
                .eq('name', '__nudge_config__')
                .maybeSingle();
            if (savedView?.filters) {
                const f = savedView.filters as any;
                const mins = f.nudge_delay_minutes
                    ? Number(f.nudge_delay_minutes)
                    : (f.nudge_delay_hours ? Math.round(Number(f.nudge_delay_hours) * 60) : 240);
                const hrs = f.nudge_delay_hours
                    ? Number(f.nudge_delay_hours)
                    : +(mins / 60).toFixed(2);
                return {
                    nudge_enabled: f.nudge_enabled !== undefined ? Boolean(f.nudge_enabled) : true,
                    nudge_delay_hours: hrs,
                    nudge_delay_minutes: mins,
                    nudge_template_name: f.nudge_template_name || 'autopilot_lead_nudge_v1',
                };
            }
        } catch {}

        return {
            nudge_enabled: true,
            nudge_delay_hours: 4,
            nudge_delay_minutes: 240,
            nudge_template_name: 'autopilot_lead_nudge_v1',
        };
    }

    /**
     * Update the organization's nudge timing and status settings.
     */
    static async updateNudgeConfig(organizationId: string, updates: Partial<NudgeConfig>): Promise<NudgeConfig> {
        const current = await this.getNudgeConfig(organizationId);
        let mins = updates.nudge_delay_minutes !== undefined ? Number(updates.nudge_delay_minutes) : current.nudge_delay_minutes;
        if (updates.nudge_delay_hours !== undefined && updates.nudge_delay_minutes === undefined) {
            mins = Math.round(Number(updates.nudge_delay_hours) * 60);
        }
        const hrs = updates.nudge_delay_hours !== undefined ? Number(updates.nudge_delay_hours) : +(mins / 60).toFixed(2);

        const next: NudgeConfig = {
            nudge_enabled: updates.nudge_enabled !== undefined ? Boolean(updates.nudge_enabled) : current.nudge_enabled,
            nudge_delay_hours: hrs,
            nudge_delay_minutes: mins,
            nudge_template_name: updates.nudge_template_name || current.nudge_template_name,
        };

        // 1. Try crm_outreach_settings table
        try {
            await supabaseAdmin
                .from('crm_outreach_settings')
                .upsert({
                    organization_id: organizationId,
                    ...next,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'organization_id' });
        } catch {}

        // 2. Also persist in crm_saved_views for maximum resilience
        try {
            const { data: savedView } = await supabaseAdmin
                .from('crm_saved_views')
                .select('id')
                .eq('organization_id', organizationId)
                .eq('name', '__nudge_config__')
                .maybeSingle();

            if (savedView?.id) {
                await supabaseAdmin
                    .from('crm_saved_views')
                    .update({ filters: next, updated_at: new Date().toISOString() })
                    .eq('id', savedView.id);
            } else {
                await supabaseAdmin
                    .from('crm_saved_views')
                    .insert({
                        organization_id: organizationId,
                        name: '__nudge_config__',
                        entity_type: 'crm_outreach',
                        filters: next,
                    });
            }
        } catch {}

        return next;
    }
}

function rawToLabel(key: string): string {
    return key
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
