import { createClient } from '@/frontend/utils/supabase/client';

const supabase = createClient();

export interface DashboardSummary {
    active_visitors: number;
    occupancy_percentage: number;
    open_tickets: number;
    sla_percentage: number;
    high_priority_count: number;
}

export const dashboardService = {
    getSummary: async (propertyId: string): Promise<DashboardSummary> => {
        // Mocking data for now, but in a real app these would be Supabase calls
        return {
            active_visitors: 142,
            occupancy_percentage: 78,
            open_tickets: 24,
            sla_percentage: 95,
            high_priority_count: 5
        };
    },

    // Property Admin Overview
    getPropertyOverview: async (propertyId: string) => {
        const { count, error } = await supabase
            .from('property_activities')
            .select('*', { count: 'exact', head: true })
            .eq('property_id', propertyId)
            .eq('status', 'open');

        if (error) throw error;
        return { open_tickets: count };
    },

    // Org Super Admin Overview
    getOrgPortfolioOverview: async (orgId: string) => {
        const { data: properties, error } = await supabase
            .from('properties')
            .select(`
                id, 
                name,
                property_activities (count)
            `)
            .eq('organization_id', orgId);

        if (error) throw error;

        return properties.map(p => ({
            name: p.name,
            ticket_count: (p.property_activities as any)[0]?.count || 0
        }));
    }
};
