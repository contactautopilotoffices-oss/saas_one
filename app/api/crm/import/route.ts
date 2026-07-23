import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import * as XLSX from 'xlsx';

const MAX_ROWS = 5000;

// Status name to UUID mapping
const STATUS_MAP: Record<string, string> = {
    'hot': 'hot_lead',
    'warm': 'warm_lead',
    'cold': 'cold_lead',
    'lost': 'lost',
    'hold': 'on_hold',
    'not responsive': 'not_responsive',
    'site visit scheduled': 'site_visit_scheduled',
    'meeting scheduled': 'meeting_scheduled',
    'proposal shared': 'proposal_shared',
    'new lead': 'new_lead',
    'contacted': 'contacted',
};

// Source name to normalized mapping
const SOURCE_MAP: Record<string, string> = {
    'meta': 'meta_ads',
    'meta ads': 'meta_ads',
    'linkedin': 'linkedin',
    'linked in': 'linkedin',
    'facebook': 'facebook',
    'google ads': 'google_ads',
    'referral': 'referral',
    'direct': 'direct',
    'website': 'website',
};

// POST /api/crm/import - import leads with column mapping
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.rows || !body?.mappings) {
        return NextResponse.json({ error: 'rows and mappings are required' }, { status: 400 });
    }

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;
    const org = access.organizationId;

    const { rows, mappings, skip_duplicates = true, duplicate_indices = [] } = body;

    if (rows.length > MAX_ROWS) {
        return NextResponse.json({ error: `Exceeds ${MAX_ROWS}-row limit (got ${rows.length})` }, { status: 413 });
    }

    const errors: { row: number; field: string; message: string }[] = [];
    const importedLeads: string[] = [];
    let skipped = 0;

    // Build column index map
    const colMap = new Map<string, number>();
    mappings.forEach((m: any, idx: number) => {
        if (m.crmField !== 'skip') {
            colMap.set(m.crmField, idx);
        }
    });

    // Get default status
    const { data: def } = await supabaseAdmin
        .from('crm_lead_statuses').select('id')
        .eq('is_default', true)
        .or(`organization_id.eq.${org},organization_id.is.null`)
        .order('organization_id', { ascending: false, nullsFirst: false })
        .limit(1).maybeSingle();
    const defaultStatusId = def?.id;

    // Get all statuses for mapping
    const { data: statuses } = await supabaseAdmin
        .from('crm_lead_statuses').select('id, name').eq('is_active', true)
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const statusMap = new Map((statuses || []).map(s => [s.name.toLowerCase(), s.id]));

    // Get sources
    const { data: sources } = await supabaseAdmin
        .from('crm_lead_sources').select('id, name').eq('is_active', true)
        .or(`organization_id.eq.${org},organization_id.is.null`);
    const sourceMap = new Map((sources || []).map(s => [s.name.toLowerCase(), s.id]));

    // Get territories for location mapping
    const { data: territories } = await supabaseAdmin
        .from('crm_territories').select('id, name').eq('organization_id', org);
    const territoryMap = new Map((territories || []).map(t => [t.name.toLowerCase(), t.id]));

    // Get users for assignment mapping
    let userMap = new Map<string, string>();
    if (access.isAdmin) {
        const [pm, om] = await Promise.all([
            supabaseAdmin.from('property_memberships').select('user_id').eq('organization_id', org).eq('is_active', true),
            supabaseAdmin.from('organization_memberships').select('user_id').eq('organization_id', org).eq('is_active', true),
        ]);
        const memberIds = [...new Set([...(pm.data || []), ...(om.data || [])].map((m: any) => m.user_id))];
        if (memberIds.length) {
            const { data: us } = await supabaseAdmin.from('users').select('id, full_name').in('id', memberIds);
            userMap = new Map((us || []).map(u => [u.full_name.toLowerCase().trim(), u.id]));
        }
    }

    // Get existing leads for duplicate detection (if needed)
    let existingContacts = new Set<string>();
    if (skip_duplicates) {
        const { data: existing } = await supabaseAdmin
            .from('crm_leads').select('email, contact_number').eq('organization_id', org);
        existing?.forEach(lead => {
            if (lead.email) existingContacts.add(lead.email.toLowerCase());
            if (lead.contact_number) existingContacts.add(cleanPhone(lead.contact_number));
        });
    }

    // Helper functions
    const getValue = (field: string, row: string[]): string => {
        const idx = colMap.get(field);
        if (idx === undefined) return '';
        return (row[idx] || '').trim();
    };

    const getStatusId = (statusName: string): string | null => {
        if (!statusName) return defaultStatusId || null;
        const name = statusName.toLowerCase().trim();

        // Check direct name match
        if (statusMap.has(name)) return statusMap.get(name)!;

        // Check status type mapping
        const mapped = STATUS_MAP[name];
        if (mapped) {
            // Try to find status with that identifier
            const found = statuses?.find(s =>
                s.name.toLowerCase().includes(mapped.replace('_', ' ')) ||
                s.name.toLowerCase().replace(' ', '_') === mapped
            );
            if (found) return found.id;
        }

        return defaultStatusId || null;
    };

    const getSourceId = (sourceName: string): string | null => {
        if (!sourceName) return null;
        const name = sourceName.toLowerCase().trim();

        if (sourceMap.has(name)) return sourceMap.get(name)!;

        const mapped = SOURCE_MAP[name];
        if (mapped && sourceMap.has(mapped)) return sourceMap.get(mapped)!;

        return null;
    };

    const getTerritoryId = (location: string): string | null => {
        if (!location) return null;
        const name = location.toLowerCase().trim();

        if (territoryMap.has(name)) return territoryMap.get(name)!;

        // Partial match
        for (const [key, value] of territoryMap) {
            if (name.includes(key) || key.includes(name)) return value;
        }

        return null;
    };

    const getAssignedUserId = (handledBy: string): string | null => {
        if (!handledBy) return null;
        const name = handledBy.toLowerCase().trim();
        return userMap.get(name) || null;
    };

    const isDuplicate = (row: string[]): boolean => {
        const email = getValue('email', row).toLowerCase();
        const phone = cleanPhone(getValue('phone', row));

        if (email && existingContacts.has(email)) return true;
        if (phone && existingContacts.has(phone)) return true;

        return false;
    };

    // Process rows
    for (let i = 0; i < rows.length; i++) {
        // Skip duplicates
        if (duplicate_indices.includes(i)) {
            skipped++;
            continue;
        }

        const row = rows[i];
        const rowNum = i + 2;

        try {
            // Check for required fields
            const companyName = getValue('company_name', row) || getValue('full_name', row);
            const email = getValue('email', row);
            const phone = getValue('phone', row);

            if (!companyName && !email && !phone) {
                errors.push({ row: rowNum, field: 'required', message: 'Need at least company_name, email, or phone' });
                continue;
            }

            // Check duplicates
            if (isDuplicate(row)) {
                skipped++;
                continue;
            }

            // Build full name from first/last
            const firstName = getValue('first_name', row);
            const lastName = getValue('last_name', row);
            const fullName = getValue('full_name', row) || `${firstName} ${lastName}`.trim();

            // Parse requirement for structured data
            const requirement = getValue('requirement', row);
            const { seats, budget, timeline } = parseRequirement(requirement);

            // Build lead data
            const leadData: Record<string, any> = {
                organization_id: org,
                created_by: access.user.id,
                assigned_to: access.isAdmin ? null : access.user.id,
                full_name: fullName || null,
                first_name: firstName || null,
                last_name: lastName || null,
                email: email || null,
                contact_number: cleanPhone(phone) || null,
                company_name: companyName || null,
                job_title: getValue('job_title', row) || null,
                requirement: requirement || null,
                location: getValue('location', row) || null,
                status: getStatusId(getValue('status', row)) || defaultStatusId,
                priority: 'Medium',
                // Structured requirement fields
                seats_required: seats || null,
                budget_min: budget?.min || null,
                budget_max: budget?.max || null,
                move_in_timeline: timeline || null,
            };

            // Map optional fields
            const sourceId = getSourceId(getValue('lead_source', row));
            if (sourceId) leadData.lead_source = sourceId;

            const territoryId = getTerritoryId(getValue('location', row));
            if (territoryId) leadData.territory_id = territoryId;

            const assignedUserId = getAssignedUserId(getValue('handled_by', row));
            if (assignedUserId) leadData.assigned_to = assignedUserId;

            // Handle date
            const dateStr = getValue('date', row);
            if (dateStr) {
                const date = parseExcelDate(dateStr);
                if (date) leadData.created_at = date;
            }

            // Insert lead
            const { data: newLead, error: insErr } = await supabaseAdmin
                .from('crm_leads').insert(leadData).select('id').single();

            if (insErr) {
                errors.push({ row: rowNum, field: 'insert', message: insErr.message });
                continue;
            }

            importedLeads.push(newLead.id);

            // Parse and insert activity log from update_notes
            const updateNotes = getValue('update_notes', row);
            if (updateNotes) {
                const activities = parseActivityLog(updateNotes);
                for (const activity of activities) {
                    await supabaseAdmin.from('crm_activity_log').insert({
                        lead_id: newLead.id,
                        activity_type: activity.type,
                        description: activity.description,
                        created_at: activity.date || new Date().toISOString(),
                        created_by: access.user.id,
                    });
                }
            }
        } catch (err: any) {
            errors.push({ row: rowNum, field: 'general', message: err?.message || 'Unknown error' });
        }
    }

    return NextResponse.json({
        total_rows: rows.length,
        success_count: importedLeads.length,
        skipped_duplicates: skipped,
        error_count: errors.length,
        errors: errors.slice(0, 100),
        imported_leads: importedLeads,
    });
}

// Helper: Clean phone number
function cleanPhone(phone: string): string {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '').replace(/^0+/, '').replace(/^\+91/, '');
}

// Helper: Parse requirement text for structured data
function parseRequirement(requirement: string): { seats?: number; budget?: { min: number; max: number }; timeline?: string } {
    const result: any = {};

    if (!requirement) return result;

    // Extract seats - pattern: "X seats", "X seater", "X w.s", etc.
    const seatMatch = requirement.match(/(\d+)\s*(?:seats?|seater|w\.s\.|workstations?|open|closed)/i);
    if (seatMatch) result.seats = parseInt(seatMatch[1]);

    // Extract budget - pattern: "₹X-Y", "X to Y", "budget: X"
    const budgetMatch = requirement.match(/(?:₹|Rs\.?|INR)\s*([\d,]+)\s*(?:-|to|–)\s*([\d,]+)/i) ||
                       requirement.match(/([\d,]+)\s*(?:-|to|–)\s*([\d,]+)\s*(?:₹|Rs\.?|INR)/i);
    if (budgetMatch) {
        result.budget = {
            min: parseInt(budgetMatch[1].replace(/,/g, '')),
            max: parseInt(budgetMatch[2].replace(/,/g, ''))
        };
    }

    // Extract timeline - pattern: "within X months", "X-Y months"
    const timelineMatch = requirement.match(/(?:within|in|by)\s*(\d+)\s*(?:month|week)s?/i) ||
                        requirement.match(/(\d+)\s*-\s*\d+\s*(?:months?|weeks?)/i);
    if (timelineMatch) result.timeline = `${timelineMatch[1]} months`;

    return result;
}

// Helper: Parse activity log text
function parseActivityLog(text: string): { type: string; description: string; date: string }[] {
    const activities: { type: string; description: string; date: string }[] = [];

    // Pattern: "DD Mon: Action text" or "DDth Mon: Action text"
    const pattern = /(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*:?\s*([^\n]+)/gi;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        const day = match[1].padStart(2, '0');
        const monthMap: Record<string, string> = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
            'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        };
        const month = monthMap[match[2].toLowerCase().slice(0, 3)] || '01';

        // Extract action type from description
        const desc = match[3].trim();
        const type = determineActivityType(desc);

        activities.push({
            type,
            description: desc,
            date: `2026-${month}-${day}T00:00:00.000Z`
        });
    }

    return activities;
}

// Helper: Determine activity type from description
function determineActivityType(description: string): string {
    const desc = description.toLowerCase();

    if (desc.includes('spoke') || desc.includes('call') || desc.includes('discussed')) return 'call';
    if (desc.includes('visit') || desc.includes('site visit')) return 'site_visit';
    if (desc.includes('meeting') || desc.includes('met')) return 'meeting';
    if (desc.includes('mail') || desc.includes('email') || desc.includes('sent')) return 'email';
    if (desc.includes('whatsapp') || desc.includes('wp') || desc.includes('text') || desc.includes('message')) return 'message';
    if (desc.includes('proposal') || desc.includes('quotation') || desc.includes('commercial')) return 'proposal';
    if (desc.includes('ringing') || desc.includes('tried calling') || desc.includes('call back')) return 'attempted_contact';
    if (desc.includes('declined') || desc.includes('rejected') || desc.includes('not interested')) return 'lost';
    if (desc.includes('finalized') || desc.includes('closed') || desc.includes('converted')) return 'won';

    return 'note';
}

// Helper: Parse Excel date (serial number to ISO)
function parseExcelDate(value: string): string | null {
    // If it's a number, it's an Excel serial date
    const serial = parseInt(value);
    if (!isNaN(serial) && serial > 0) {
        const epoch = new Date(1899, 11, 30);
        epoch.setDate(epoch.getDate() + serial);
        return epoch.toISOString();
    }

    // Try to parse as regular date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
        return date.toISOString();
    }

    return null;
}

// GET /api/crm/import - sample template
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';

    if (format === 'xlsx') {
        // Generate Excel template
        const template = [
            ['First Name', 'Last Name', 'Email', 'Phone', 'Company Name', 'Job Title',
             'Requirement', 'Location', 'Status', 'Lead Source', 'Handled By', 'Campaign', 'Activity Log / Updates'],
            ['John', 'Doe', 'john@company.com', '919876543210', 'Acme Corp', 'Sales Director',
             '50 seats, 5 cabins, move-in 2 months', 'Andheri', 'Hot', 'LinkedIn', 'Shubham',
             'Q2 Andheri Campaign', '12 June: Spoke, interested in site visit'],
            ['', '', '', '', '', '', '', '', 'Warm', 'Meta', 'Shravani', '', ''],
        ];

        const ws = XLSX.utils.aoa_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Leads Template');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="crm_leads_template.xlsx"',
            },
        });
    }

    // CSV template
    const template = `First Name,Last Name,Email,Phone,Company Name,Job Title,Requirement,Location,Status,Lead Source,Handled By,Campaign,Activity Log / Updates
John,Doe,john@company.com,919876543210,Acme Corp,Sales Director,"50 seats, 5 cabins, move-in 2 months",Andheri,Hot,LinkedIn,Shubham,Q2 Andheri Campaign,"12 June: Spoke, interested in site visit"
,Smith,jane@company.com,,Tech Solutions,CEO,25 seats,Lower Parel,Warm,Meta,Shravani,,`;

    return new NextResponse(template, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="crm_leads_template.csv"',
        },
    });
}
