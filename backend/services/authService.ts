import { RequestContext, User, RoleKey } from '@/frontend/types/rbac';
import { CAPABILITY_MATRIX } from '@/frontend/constants/capabilities';
import { createClient } from '@/frontend/utils/supabase/client';

export const authService = {
    getMeContext: async (): Promise<RequestContext | null> => {
        const supabase = createClient();

        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return null;

        // Fetch user profile from database
        const { data: userProfile } = await supabase
            .from('users')
            .select('id, full_name, email, phone')
            .eq('id', authUser.id)
            .single();

        if (!userProfile) return null;

        // Get property membership for role context
        const { data: propMembership } = await supabase
            .from('property_memberships')
            .select('property_id, role')
            .eq('user_id', authUser.id)
            .eq('is_active', true)
            .maybeSingle();

        const roleKey = (propMembership?.role || authUser.user_metadata?.role || 'staff') as RoleKey;
        const propertyId = propMembership?.property_id || '';

        const roleLevelMap: Record<string, number> = {
            'super_admin': 0,
            'org_admin': 1,
            'property_admin': 2,
            'manager_executive': 3,
            'bd_super_admin': 3, 'bd_admin': 3, 'bd_rep': 4,
            'mst': 4, 'hk': 4, 'fe': 4, 'se': 4, 'technician': 4,
            'field_staff': 4, 'bms_operator': 4, 'staff': 4,
            'tenant_user': 4, 'vendor': 4
        };

        return {
            user_id: userProfile.id,
            role_key: roleKey,
            role_level: (roleLevelMap[roleKey] || 4) as 0 | 1 | 2 | 3 | 4,
            property_id: propertyId,
            capabilities: CAPABILITY_MATRIX[roleKey] || {}
        };
    },

    getCurrentUser: async (): Promise<User | null> => {
        const supabase = createClient();

        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return null;

        const { data: userProfile } = await supabase
            .from('users')
            .select('id, full_name, email, phone')
            .eq('id', authUser.id)
            .single();

        if (!userProfile) return null;

        const { data: propMembership } = await supabase
            .from('property_memberships')
            .select('property_id, role')
            .eq('user_id', authUser.id)
            .eq('is_active', true)
            .maybeSingle();

        const roleKey = (propMembership?.role || authUser.user_metadata?.role || 'staff') as RoleKey;

        const roleLevelMap: Record<string, number> = {
            'super_admin': 0, 'org_admin': 1, 'property_admin': 2,
            'manager_executive': 3, 'bd_admin': 3, 'bd_rep': 4,
            'mst': 4, 'staff': 4, 'tenant_user': 4
        };

        return {
            id: userProfile.id,
            full_name: userProfile.full_name,
            email: userProfile.email,
            phone: userProfile.phone,
            role_key: roleKey,
            role_level: (roleLevelMap[roleKey] || 4) as 0 | 1 | 2 | 3 | 4,
            property_id: propMembership?.property_id || '',
            status: 'active',
            created_at: Date.now()
        };
    }
};

