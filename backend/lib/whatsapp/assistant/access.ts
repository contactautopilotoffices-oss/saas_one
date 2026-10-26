import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { canonicalPhone } from './protocol.mjs';

export async function findWhatsAppUser(phone: string) {
    const normalized = canonicalPhone(phone);
    if (!/^\d{11,15}$/.test(normalized)) return null;
    const last10 = normalized.slice(-10);
    // Stored profile numbers may contain spaces, brackets or hyphens. Fetch
    // candidates in digit order, then require exact canonical equality below.
    const formattedPattern = `%${last10.split('').join('%')}%`;
    const { data, error } = await supabaseAdmin.from('users')
        .select('id, full_name, phone, is_approved, approval_status, is_master_admin')
        .or(`phone.eq.${last10},phone.ilike.${formattedPattern}`);
    if (error) throw error;
    const matches = (data || []).filter(user => canonicalPhone(user.phone) === normalized);
    // Never silently choose between profiles sharing the same number.
    if (matches.length !== 1) return null;
    const user = matches[0];
    return user.is_master_admin || user.is_approved || user.approval_status === 'approved' ? user : null;
}

export async function getWhatsAppProperties(userId: string, allowLegacyFallback = false) {
    const { data, error } = await supabaseAdmin.rpc('whatsapp_assistant_properties', { p_user_id: userId });
    if (error && allowLegacyFallback && ['PGRST202', '42883'].includes(error.code)) {
        // Keep old ingress usable during a code-first rollout; do not mask DB/network errors.
        const [profile, orgs, memberships] = await Promise.all([
            supabaseAdmin.from('users').select('is_master_admin,is_approved,approval_status').eq('id', userId).maybeSingle(),
            supabaseAdmin.from('organization_memberships').select('organization_id,role').eq('user_id', userId).eq('is_active', true),
            supabaseAdmin.from('property_memberships').select('property_id').eq('user_id', userId).eq('is_active', true),
        ]);
        if (profile.error) throw profile.error;
        if (orgs.error) throw orgs.error;
        if (memberships.error) throw memberships.error;
        if (!profile.data || !(profile.data.is_master_admin || profile.data.is_approved || profile.data.approval_status === 'approved')) return [];
        const orgIds = (orgs.data || []).filter(row => ['org_super_admin','ops_super_admin','org_admin','owner'].includes(row.role)).map(row => row.organization_id);
        const propertyIds = (memberships.data || []).map(row => row.property_id);
        const queries = [];
        if (profile.data.is_master_admin) queries.push(supabaseAdmin.from('properties').select('*').order('name'));
        else {
            if (orgIds.length) queries.push(supabaseAdmin.from('properties').select('*').in('organization_id', orgIds).order('name'));
            if (propertyIds.length) queries.push(supabaseAdmin.from('properties').select('*').in('id', propertyIds).order('name'));
        }
        const seen = new Map<string, { id: string; name: string; organization_id: string }>();
        for (const result of await Promise.all(queries)) {
            if (result.error) throw result.error;
            for (const property of result.data || []) {
                if (property.is_active && !property.deleted_at) seen.set(property.id, { id: property.id, name: property.name, organization_id: property.organization_id });
            }
        }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    }
    if (error) throw error;
    return (data || []) as { id: string; name: string; organization_id: string }[];
}
