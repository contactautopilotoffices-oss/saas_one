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
 */
export async function generateNextTicketNumber(
    supabase: SupabaseClient,
    propertyId: string,
    orgId?: string | null
): Promise<string> {
    // 1. Fetch Property and Organization
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

    // 2. Query the highest sequence number for this property
    // We check the most recent 100 tickets to extract the largest sequence
    const { data: recentTickets } = await supabase
        .from('tickets')
        .select('ticket_number')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(100);

    let maxSeq = 0;
    const prefix = `${orgInit}-${propInit}-`;

    if (recentTickets && recentTickets.length > 0) {
        for (const t of recentTickets) {
            const num = t.ticket_number;
            if (num && num.startsWith(prefix)) {
                const seqPart = parseInt(num.substring(prefix.length), 10);
                if (!isNaN(seqPart) && seqPart > maxSeq) {
                    maxSeq = seqPart;
                }
            }
        }
    }

    // Fallback if not found in recent or first time
    if (maxSeq === 0) {
        const { count } = await supabase
            .from('tickets')
            .select('id', { count: 'exact', head: true })
            .eq('property_id', propertyId);
        maxSeq = count || 0;
    }

    const nextSeq = maxSeq + 1;
    return formatTicketNumber(orgInit, propInit, nextSeq);
}
