import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';

// POST /api/crm/import/check-duplicates - check for duplicate leads
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.rows) {
        return NextResponse.json({ error: 'rows is required' }, { status: 400 });
    }

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    const org = access.organizationId;

    const { rows } = body;

    // Get existing leads
    const { data: existing } = await supabaseAdmin
        .from('crm_leads').select('email, contact_number')
        .eq('organization_id', org);

    const existingEmails = new Set<string>();
    const existingPhones = new Set<string>();

    existing?.forEach(lead => {
        if (lead.email) existingEmails.add(lead.email.toLowerCase());
        if (lead.contact_number) existingEmails.add(cleanPhone(lead.contact_number));
    });

    // Check each row for duplicates
    const duplicateIndices: number[] = [];

    rows.forEach((row: any, idx: number) => {
        const email = (row.email || '').toLowerCase().trim();
        const phone = cleanPhone(row.phone || '');

        if ((email && existingEmails.has(email)) || (phone && existingPhones.has(phone))) {
            duplicateIndices.push(idx);
        }
    });

    return NextResponse.json({
        total_checked: rows.length,
        duplicate_count: duplicateIndices.length,
        duplicate_indices: duplicateIndices,
    });
}

function cleanPhone(phone: string): string {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '').replace(/^0+/, '').replace(/^\+91/, '');
}
