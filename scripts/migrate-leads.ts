/**
 * Migration Script: Performance Marketing Leads Excel → CRM
 *
 * This script parses the Performance Marketing Leads.xlsx file and imports
 * all leads into the CRM database.
 *
 * Usage:
 *   npx ts-node scripts/migrate-leads.ts
 *
 * Prerequisites:
 *   - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Status mapping
const STATUS_MAP: Record<string, string> = {
    'hot': 'hot',
    'warm': 'warm',
    'cold': 'cold',
    'lost': 'lost',
    'hold': 'on_hold',
    'not responsive': 'not_responsive',
    'site visit': 'site_visit_scheduled',
    'meeting': 'meeting_scheduled',
    'proposal': 'proposal_shared',
};

// Source mapping
const SOURCE_MAP: Record<string, string> = {
    'meta': 'meta_ads',
    'linkedin': 'linkedin',
};

// Helper: Clean phone number
function cleanPhone(phone: string | number | null): string {
    if (!phone) return '';
    const str = String(phone);
    return str.replace(/[^\d+]/g, '').replace(/^0+/, '').replace(/^\+91/, '');
}

// Helper: Parse Excel date (serial number to ISO)
function parseExcelDate(serial: number | string | null): string | null {
    if (!serial) return null;
    const num = typeof serial === 'string' ? parseFloat(serial) : serial;
    if (isNaN(num) || num <= 0) return null;
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + num);
    return epoch.toISOString();
}

// Helper: Parse requirement text
function parseRequirement(requirement: string | null): {
    seats?: number;
    budget?: { min: number; max: number };
    timeline?: string;
    spaceType?: string;
} {
    const result: any = {};

    if (!requirement) return result;

    // Extract seats
    const seatMatch = String(requirement).match(/(\d+)\s*(?:seats?|seater|w\.?s\.?|workstations?|open|closed)/i);
    if (seatMatch) result.seats = parseInt(seatMatch[1]);

    // Extract budget
    const budgetMatch = String(requirement).match(/(?:₹|Rs\.?|INR)\s*([\d,]+)\s*(?:-|to|–)\s*([\d,]+)/i) ||
                       String(requirement).match(/([\d,]+)\s*(?:-|to|–)\s*([\d,]+)\s*(?:₹|Rs\.?|INR)/i);
    if (budgetMatch) {
        result.budget = {
            min: parseInt(budgetMatch[1].replace(/,/g, '')),
            max: parseInt(budgetMatch[2].replace(/,/g, ''))
        };
    }

    // Extract timeline
    const timelineMatch = String(requirement).match(/(?:within|in|by)\s*(\d+)\s*(?:month|week)s?/i) ||
                        String(requirement).match(/(\d+)\s*-\s*\d+\s*(?:months?|weeks?)/i);
    if (timelineMatch) result.timeline = `${timelineMatch[1]} months`;

    // Extract space type
    const cabinMatch = String(requirement).match(/(\d+)\s*seater\s*(?:cabin|cabin\s*rooms?)/i);
    if (cabinMatch) result.spaceType = 'cabin';

    const meetingMatch = String(requirement).match(/meeting\s*room|conference|board\s*room/i);
    if (meetingMatch) result.spaceType = 'meeting_room';

    return result;
}

// Helper: Parse activity log text
function parseActivityLog(text: string | null): { type: string; description: string; date: string }[] {
    const activities: { type: string; description: string; date: string }[] = [];

    if (!text) return activities;

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

        const desc = (match[3] || '').trim();
        const type = determineActivityType(desc);

        activities.push({
            type,
            description: desc,
            date: `2026-${month}-${day}T00:00:00.000Z`
        });
    }

    return activities;
}

// Helper: Determine activity type
function determineActivityType(description: string): string {
    const desc = description.toLowerCase();

    if (desc.includes('spoke') || desc.includes('call') || desc.includes('discussed')) return 'call';
    if (desc.includes('visit') && !desc.includes('visiting')) return 'site_visit';
    if (desc.includes('meeting')) return 'meeting';
    if (desc.includes('mail') || desc.includes('email') || desc.includes('sent')) return 'email';
    if (desc.includes('whatsapp') || desc.includes('wp') || desc.includes('text')) return 'message';
    if (desc.includes('proposal') || desc.includes('quotation') || desc.includes('commercial')) return 'proposal';
    if (desc.includes('ringing') || desc.includes('tried calling') || desc.includes('call back') || desc.includes('declined')) return 'attempted_contact';
    if (desc.includes('not interested') || desc.includes("don't need")) return 'lost';
    if (desc.includes('finalized') || desc.includes('closed') || desc.includes('converted')) return 'won';

    return 'note';
}

// Helper: Get status from text
function getStatus(status: string | null): string {
    if (!status) return 'new_lead';
    const s = status.toLowerCase().trim();

    for (const [key, value] of Object.entries(STATUS_MAP)) {
        if (s.includes(key)) return value;
    }

    return 'new_lead';
}

// Helper: Get source from campaign text
function getSource(campaign: string | null): string {
    if (!campaign) return 'direct';
    const c = campaign.toLowerCase();

    if (c.includes('meta')) return 'meta_ads';
    if (c.includes('linkedin') || c.includes('linked in')) return 'linkedin';

    return 'direct';
}

// Get default status ID
async function getDefaultStatusId(): Promise<string | null> {
    const { data } = await supabase
        .from('crm_lead_statuses')
        .select('id')
        .eq('is_default', true)
        .single();
    return data?.id || null;
}

// Check if lead exists
async function checkDuplicate(email: string | null, phone: string | null): Promise<boolean> {
    if (!email && !phone) return false;

    const ors: string[] = [];
    if (email) ors.push(`email.ilike.${email}`);
    if (phone) ors.push(`contact_number.eq.${phone}`);

    const { data } = await supabase
        .from('crm_leads')
        .select('id')
        .or(ors.join(','))
        .limit(1)
        .maybeSingle();

    return !!data;
}

// Parse a campaign sheet
async function parseSheet(
    sheetName: string,
    sheet: XLSX.WorkSheet,
    territory: string,
    organizationId: string
): Promise<{ imported: number; skipped: number; errors: number }> {
    console.log(`\n📊 Processing sheet: ${sheetName}`);

    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number | null)[][];

    if (json.length < 2) {
        console.log(`  ⚠️  Sheet is empty, skipping`);
        return { imported: 0, skipped: 0, errors: 0 };
    }

    // Find header row (skip rows that don't have expected headers)
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(5, json.length); i++) {
        const row = json[i];
        if (row && row.some(cell => cell && String(cell).toLowerCase().includes('name'))) {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1) {
        // Try generic header detection
        headerRowIndex = json.findIndex(row =>
            row && row.length > 5 && row.some(cell => cell !== null)
        );
    }

    if (headerRowIndex === -1) {
        console.log(`  ⚠️  Could not find header row`);
        return { imported: 0, skipped: 0, errors: 0 };
    }

    const headers = (json[headerRowIndex] || []).map((h, i) => ({
        index: i,
        name: (h || `col_${i}`).toString().trim().toLowerCase()
    }));

    // Column mapping
    const colMap: Record<string, number> = {};
    headers.forEach(h => {
        if (h.name.includes('first') && h.name.includes('name')) colMap.first_name = h.index;
        else if (h.name.includes('last') && h.name.includes('name')) colMap.last_name = h.index;
        else if (h.name.includes('name') && !h.name.includes('company')) colMap.full_name = h.index;
        else if (h.name.includes('company')) colMap.company_name = h.index;
        else if (h.name.includes('email')) colMap.email = h.index;
        else if (h.name.includes('phone') || h.name.includes('contact') || h.name.includes('mobile')) colMap.phone = h.index;
        else if (h.name.includes('designation') || h.name.includes('title') || h.name.includes('role')) colMap.job_title = h.index;
        else if (h.name.includes('requirement') || h.name.includes('seats')) colMap.requirement = h.index;
        else if (h.name.includes('status')) colMap.status = h.index;
        else if (h.name.includes('update') || h.name.includes('activity') || h.name.includes('interaction') || h.name.includes('log')) colMap.update = h.index;
        else if (h.name.includes('date')) colMap.date = h.index;
        else if ((h.name.includes('handled') || h.name.includes('poc') || h.name.includes('who')) && !h.name.includes('date')) colMap.handled_by = h.index;
        else if (h.name.includes('campaign')) colMap.campaign = h.index;
    });

    const dataRows = json.slice(headerRowIndex + 1).filter(row =>
        row && row.some(cell => cell !== null && cell !== '')
    );

    console.log(`  Found ${dataRows.length} data rows, ${Object.keys(colMap).length} columns mapped`);

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const defaultStatusId = await getDefaultStatusId();

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];

        try {
            const firstName = colMap.first_name !== undefined ? String(row[colMap.first_name] || '').trim() : '';
            const lastName = colMap.last_name !== undefined ? String(row[colMap.last_name] || '').trim() : '';
            const fullName = colMap.full_name !== undefined ? String(row[colMap.full_name] || '').trim() : '';
            const companyName = colMap.company_name !== undefined ? String(row[colMap.company_name] || '').trim() : '';
            const email = colMap.email !== undefined ? String(row[colMap.email] || '').trim() : '';
            const phone = colMap.phone !== undefined ? cleanPhone(row[colMap.phone]) : '';
            const jobTitle = colMap.job_title !== undefined ? String(row[colMap.job_title] || '').trim() : '';
            const requirement = colMap.requirement !== undefined ? String(row[colMap.requirement] || '').trim() : '';
            const status = colMap.status !== undefined ? String(row[colMap.status] || '').trim() : '';
            const update = colMap.update !== undefined ? String(row[colMap.update] || '').trim() : '';
            const date = colMap.date !== undefined ? row[colMap.date] : null;
            const handledBy = colMap.handled_by !== undefined ? String(row[colMap.handled_by] || '').trim() : '';
            const campaign = colMap.campaign !== undefined ? String(row[colMap.campaign] || '').trim() : sheetName;

            // Skip if no identifiable data
            if (!companyName && !fullName && !email && !phone) {
                skipped++;
                continue;
            }

            // Check for duplicates
            const isDup = await checkDuplicate(email, phone);
            if (isDup) {
                skipped++;
                continue;
            }

            // Parse requirement
            const parsed = parseRequirement(requirement);

            // Build lead
            const leadData: any = {
                organization_id: organizationId,
                full_name: fullName || `${firstName} ${lastName}`.trim() || null,
                first_name: firstName || null,
                last_name: lastName || null,
                email: email || null,
                contact_number: phone || null,
                company_name: companyName || null,
                job_title: jobTitle || null,
                requirement: requirement || null,
                location: territory,
                status: getStatus(status) || defaultStatusId,
                lead_source: getSource(campaign),
                priority: status.toLowerCase().includes('hot') ? 'High' :
                          status.toLowerCase().includes('warm') ? 'Medium' : 'Low',
                seats_required: parsed.seats || null,
                budget_min: parsed.budget?.min || null,
                budget_max: parsed.budget?.max || null,
                move_in_timeline: parsed.timeline || null,
            };

            // Parse date
            if (date) {
                const parsedDate = parseExcelDate(date);
                if (parsedDate) leadData.created_at = parsedDate;
            }

            // Insert lead
            const { data: newLead, error: insErr } = await supabase
                .from('crm_leads')
                .insert(leadData)
                .select('id')
                .single();

            if (insErr) {
                console.error(`  ❌ Error on row ${i + 1}: ${insErr.message}`);
                errors++;
                continue;
            }

            // Parse and insert activities
            const activities = parseActivityLog(update);
            if (activities.length > 0) {
                const activityInserts = activities.map(a => ({
                    lead_id: newLead.id,
                    activity_type: a.type,
                    description: a.description,
                    created_at: a.date,
                }));

                await supabase.from('crm_activity_log').insert(activityInserts);
            }

            imported++;

            if (imported % 50 === 0) {
                console.log(`  📥 Imported ${imported} leads...`);
            }

        } catch (err: any) {
            console.error(`  ❌ Error on row ${i + 1}: ${err.message}`);
            errors++;
        }
    }

    console.log(`  ✅ Done: ${imported} imported, ${skipped} skipped, ${errors} errors`);
    return { imported, skipped, errors };
}

// Main migration function
async function migrate() {
    console.log('🚀 Starting Performance Marketing Leads migration...\n');

    // Configuration - UPDATE THESE
    const ORGANIZATION_ID = process.env.CRM_ORG_ID || 'your-organization-uuid';
    const EXCEL_FILE = 'Performance Marketing Leads (1).xlsx';

    console.log(`📁 Loading Excel file: ${EXCEL_FILE}`);

    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.readFile(EXCEL_FILE);
    } catch (err) {
        console.error('❌ Failed to read Excel file:', err);
        process.exit(1);
    }

    console.log(`📑 Sheets found: ${workbook.SheetNames.join(', ')}`);

    const totals = { imported: 0, skipped: 0, errors: 0 };

    // Process each campaign sheet
    for (const sheetName of workbook.SheetNames) {
        // Skip non-campaign sheets
        if (['Dashboard', 'Spec Options for Andheri  ', 'Calc_Data', 'Sheet17'].includes(sheetName)) {
            console.log(`\n⏭️  Skipping non-campaign sheet: ${sheetName}`);
            continue;
        }

        const sheet = workbook.Sheets[sheetName];
        const territory = sheetName.split(' - ')[0].trim();

        const result = await parseSheet(sheetName, sheet, territory, ORGANIZATION_ID);
        totals.imported += result.imported;
        totals.skipped += result.skipped;
        totals.errors += result.errors;
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION COMPLETE');
    console.log('='.repeat(50));
    console.log(`✅ Total imported: ${totals.imported}`);
    console.log(`⏭️  Total skipped: ${totals.skipped}`);
    console.log(`❌ Total errors: ${totals.errors}`);
    console.log('='.repeat(50));
}

// Run if called directly
migrate().catch(console.error);

export { migrate };
