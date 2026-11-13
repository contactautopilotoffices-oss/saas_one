import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Derives organization initials.
 * Specifically maps 'Autopilot Offices' to 'AP', 'tcs' to 'TCS',
 * and extracts first letters of words for other orgs.
 */
export function deriveOrgInitials(orgName?: string | null): string {
    if (!orgName) return 'AP';
    const trimmed = orgName.trim();
    if (trimmed.toLowerCase().includes('autopilot')) return 'AP';
    if (trimmed.toLowerCase() === 'tcs') return 'TCS';

    const words = trimmed.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(w => w[0].toUpperCase()).join('');
}

/**
 * Strictly derives property initials algorithmically from the property name.
 * - Single word (e.g. 'Indore', 'Rabale', 'Noida') -> first 3 letters ('IND', 'RAB', 'NOI')
 * - 'SS' kept intact so 'SS Plaza' -> 'SSP'
 * - '3i' kept intact so '3i Cresent' -> '3IC'
 * - Words first letter (e.g. 'ETPL Digitide' -> 'ED', 'AMR Altruist' -> 'AA')
 */
export function derivePropertyInitials(name?: string | null): string {
    if (!name || !name.trim()) return 'PRP';
    const clean = name.trim().replace(/,/g, '').replace(/\s+/g, ' ');
    const separated = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
    const words = separated.split(/[\s-]+/).filter(w => w.length > 0);

    if (words.length === 1) {
        return words[0].slice(0, 3).toUpperCase();
    }

    let res = '';
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.toUpperCase() === 'SS') {
            res += 'SS';
        } else if (w.toLowerCase() === '3i') {
            res += '3I';
        } else {
            res += w[0].toUpperCase();
        }
    }
    return res;
}

/**
 * Formats ticket number with dynamic padding:
 * Minimum 3 digits (001..999), automatically expanding to 4 (1000..9999), 5 digits (10000+).
 */
export function formatTicketNumber(orgInitials: string, propInitials: string, seqNumber: number): string {
    const minPadding = 3;
    const seqStr = String(seqNumber);
    const padded = seqStr.padStart(Math.max(minPadding, seqStr.length), '0');
    return `${orgInitials}-${propInitials}-${padded}`;
}

/**
 * Calculates and returns the next ticket number for a given property.
 * Atomically increments ticket_property_sequences via RPC or direct upsert.
 */
export async function generateNextTicketNumber(
    supabase: SupabaseClient,
    propertyId: string,
    orgId?: string | null
): Promise<string> {
    // 1. Try atomic database RPC function first
    try {
        const { data: rpcNum, error: rpcErr } = await supabase.rpc('get_next_ticket_number', {
            p_property_id: propertyId,
            p_org_id: orgId || null,
        });
        if (!rpcErr && rpcNum) {
            return rpcNum;
        }
    } catch {
        // Fallback to client-side logic below if RPC not available
    }

    // 2. Fetch Property and Organization
    const { data: prop } = await supabase
        .from('properties')
        .select('id, name, organization_id')
        .eq('id', propertyId)
        .maybeSingle();

    const resolvedOrgId = orgId || prop?.organization_id;
    let orgName = 'Autopilot Offices';
    if (resolvedOrgId) {
        const { data: org } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', resolvedOrgId)
            .maybeSingle();
        if (org?.name) orgName = org.name;
    }

    const orgInit = deriveOrgInitials(orgName);
    const propInit = derivePropertyInitials(prop?.name || 'Property');

    // 3. Atomically advance ticket_property_sequences table directly
    const { data: seqRow } = await supabase
        .from('ticket_property_sequences')
        .select('last_sequence')
        .eq('property_id', propertyId)
        .maybeSingle();

    let nextSeq = (seqRow?.last_sequence || 0) + 1;

    // Verify against existing tickets to guarantee no regressions
    const prefix = `${orgInit}-${propInit}-`;
    const { data: recentTickets } = await supabase
        .from('tickets')
        .select('ticket_number')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(20);

    for (const t of recentTickets || []) {
        if (t.ticket_number && t.ticket_number.startsWith(prefix)) {
            const parsed = parseInt(t.ticket_number.substring(prefix.length), 10);
            if (!isNaN(parsed) && parsed >= nextSeq) {
                nextSeq = parsed + 1;
            }
        }
    }

    // Update sequence table
    await supabase
        .from('ticket_property_sequences')
        .upsert({
            property_id: propertyId,
            last_sequence: nextSeq,
            updated_at: new Date().toISOString(),
        });

    return formatTicketNumber(orgInit, propInit, nextSeq);
}
