import { NextRequest, NextResponse } from 'next/server';
import { slaHoursFrom } from '@/backend/lib/ticketing/categorySla';
import { createClient } from '@/frontend/utils/supabase/server';
import { classifyTicket } from '@/backend/lib/ticketing';
import { resolveImportRows } from '@/backend/lib/ticketing/resolver';
import { processIntelligentAssignment } from '@/backend/lib/ticketing/assignment';
import { deriveOrgInitials, derivePropertyInitials, formatTicketNumber } from '@/backend/lib/ticketing/ticketNumberService';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface SnagRow {
    issue_description: string;
    issue_date: string;
    // Computed fields
    skill_group?: string;
    issue_code?: string | null;
    confidence?: string;
    // Owner 2026-11-15: filled when the AI sorted the row (null when the keyword rules did)
    priority?: string | null;
    risk_flag?: string | null;
    llm_reasoning?: string | null;
    confidence_score?: number | null;
    classification_source?: string;
    isValid?: boolean;
    validationErrors?: string[];
}

interface ParsedData {
    rows: SnagRow[];
    errors: string[];
}

/**
 * Parse DD-MM-YYYY date format to ISO date string
 */
function parseDateDDMMYYYY(dateStr: string): string | null {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;

    // Return ISO format for database storage
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Extract floor number from description (reusing existing logic)
 */
function extractFloorNumber(description: string): number | null {
    const lowerDesc = description.toLowerCase();

    // Check for ground floor first (including common misspellings)
    if (lowerDesc.includes('ground floor') ||
        lowerDesc.includes('grourd floor') ||
        lowerDesc.includes('groud floor') ||
        lowerDesc.includes('floor 0') ||
        lowerDesc.includes('level 0')) {
        return 0;
    }

    // Check for basement
    if (lowerDesc.includes('basement') || lowerDesc.includes('b1')) return -1;
    if (lowerDesc.includes('b2')) return -2;

    const floorPatterns = [
        /(\d+)(?:st|nd|rd|th)\s*floor/i,
        /floor\s*(\d+)/i,
        /(\d+)\s*floor/i,
        /level\s*(\d+)/i,
    ];

    for (const pattern of floorPatterns) {
        const match = description.match(pattern);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

/**
 * Extract location from description (reusing existing logic)
 */
function extractLocation(description: string): string | null {
    const locations: Record<string, string[]> = {
        'Cafeteria': ['cafeteria', 'canteen', 'pantry', 'kitchen', 'mess'],
        'Reception': ['lobby', 'reception', 'front desk', 'entrance'],
        'Parking': ['parking', 'basement', 'garage'],
        'Terrace': ['terrace', 'roof', 'rooftop'],
        'Washroom': ['washroom', 'restroom', 'toilet', 'bathroom', 'loo'],
        'Conference Room': ['conference', 'meeting room', 'board room'],
        'Cabin': ['cabin', 'cubicle', 'desk', 'workstation'],
        'Server Room': ['server room', 'data center', 'hub room'],
        'Electrical Room': ['electrical room', 'ups room', 'dg room']
    };

    const lowerDesc = description.toLowerCase();
    for (const [loc, keywords] of Object.entries(locations)) {
        for (const keyword of keywords) {
            // Use word boundaries to avoid matching keywords inside other words (e.g., 'loo' in 'floor')
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            if (regex.test(lowerDesc)) return loc;
        }
    }
    return null;
}

/**
 * Parse CSV content
 */
function parseCSV(content: string): ParsedData {
    const result = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.toLowerCase().trim().replace(/\s+/g, '_'),
    });

    const rows: SnagRow[] = [];
    const errors: string[] = [];

    result.data.forEach((row, index) => {
        const rowNum = index + 2; // +2 because header is row 1 and index is 0-based
        const validationErrors: string[] = [];

        // Validate required fields
        const issueDescription = row.issue_description?.trim();
        const issueDate = row.issue_date?.trim();

        if (!issueDescription) {
            validationErrors.push('Missing issue_description');
        }
        if (!issueDate) {
            validationErrors.push('Missing issue_date');
        } else if (!parseDateDDMMYYYY(issueDate)) {
            validationErrors.push('Invalid date format (expected DD-MM-YYYY)');
        }

        // Classify the ticket
        let classification = { issue_code: null as string | null, skill_group: 'technical', confidence: 'low' };
        if (issueDescription) {
            classification = classifyTicket(issueDescription);
        }

        rows.push({
            issue_description: issueDescription || '',
            issue_date: issueDate || '',
            skill_group: classification.skill_group,
            issue_code: classification.issue_code,
            confidence: classification.confidence,
            isValid: validationErrors.length === 0,
            validationErrors,
        });

        if (validationErrors.length > 0) {
            errors.push(`Row ${rowNum}: ${validationErrors.join(', ')}`);
        }
    });

    return { rows, errors };
}

/**
 * Parse Excel content
 */
function parseExcel(buffer: ArrayBuffer): ParsedData {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to CSV and use existing CSV parser
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return parseCSV(csv);
}

/**
 * POST /api/tickets/bulk-import
 * Preview and import bulk snags from CSV/Excel
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const propertyId = formData.get('propertyId') as string;
        const organizationId = formData.get('organizationId') as string;
        const confirmImport = formData.get('confirmImport') === 'true';

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!propertyId || !organizationId) {
            return NextResponse.json({ error: 'Missing propertyId or organizationId' }, { status: 400 });
        }

        // Determine file type and parse
        const fileName = file.name.toLowerCase();
        let parsedData: ParsedData;

        if (fileName.endsWith('.csv')) {
            const content = await file.text();
            parsedData = parseCSV(content);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            const buffer = await file.arrayBuffer();
            parsedData = parseExcel(buffer);
        } else {
            return NextResponse.json({ error: 'Unsupported file type. Use CSV or Excel.' }, { status: 400 });
        }

        const { rows, errors } = parsedData;

        // Owner 2026-11-15: the AI sorts the rows (several per call) from this property's categories. A row it gives no
        // usable answer for keeps the keyword rules' sorting made while reading the file. Rows with errors are not
        // imported, so they are not sent to the AI either.
        const sortable = rows.filter(r => r.isValid && r.issue_description);
        const sorted = await resolveImportRows(sortable.map(r => r.issue_description), { propertyId, organizationId });
        sortable.forEach((row, i) => {
            const s = sorted[i];
            row.skill_group = s.skill_group;
            row.issue_code = s.issue_code;
            row.confidence = s.confidence;
            row.priority = s.priority;
            row.risk_flag = s.risk_flag;
            row.llm_reasoning = s.reasoning;
            row.confidence_score = s.confidenceScore;
            row.classification_source = s.source;
        });

        const validRows = rows.filter(r => r.isValid);
        const invalidRows = rows.filter(r => !r.isValid);

        // If not confirming import, return preview data
        if (!confirmImport) {
            return NextResponse.json({
                preview: true,
                totalRows: rows.length,
                validRows: validRows.length,
                invalidRows: invalidRows.length,
                rows: rows,
                errors: errors,
            });
        }

        // Confirm import - create snag_import record and insert tickets
        if (validRows.length === 0) {
            return NextResponse.json({ error: 'No valid rows to import' }, { status: 400 });
        }

        // Create import batch record (optional - skip if table doesn't exist)
        let importBatchId: string | null = null;

        try {
            const { data: importBatch, error: batchError } = await supabase
                .from('snag_imports')
                .insert({
                    property_id: propertyId,
                    organization_id: organizationId,
                    imported_by: user.id,
                    filename: file.name,
                    total_rows: rows.length,
                    valid_rows: validRows.length,
                    error_rows: invalidRows.length,
                    status: 'processing',
                })
                .select('id')
                .single();

            if (batchError) {
                console.warn('Warning: Could not create import batch (table may not exist or RLS blocked):', batchError.message);
                // Continue without batch tracking
            } else {
                importBatchId = importBatch.id;
            }
        } catch (err) {
            console.warn('Warning: snag_imports table error:', err);
            // Continue without batch tracking
        }

        // Resolve all categories and skill groups for lookup
        const { data: allCategories } = await supabase
            .from('issue_categories')
            .select('id, code, skill_group_id, priority, sla_hours, property_id');

        const { data: allSkillGroups } = await supabase
            .from('skill_groups')
            .select('id, code');

        // 2026-11-19: per-priority SLAs (Brain → Categories & SLAs). Read apart, so a missing column changes nothing.
        const slaPlans = new Map<string, unknown>();
        try {
            const plans = await supabase.from('issue_categories').select('id, sla_by_priority');
            if (!plans.error) for (const p of plans.data ?? []) if (p.sla_by_priority) slaPlans.set(String(p.id), p.sla_by_priority);
        } catch { /* as before */ }

        // One row per code: this property's own first, then the shared one, then any other (as before).
        const categoryRank = (c: { property_id: string | null }) => (c.property_id === propertyId ? 2 : !c.property_id ? 1 : 0);
        const categoryMap = new Map([...(allCategories ?? [])].sort((a, b) => categoryRank(a) - categoryRank(b)).map(c => [c.code, c]));
        const priorityRank: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3, critical: 3 };
        const skillGroupMap = new Map(allSkillGroups?.map(sg => [sg.code, sg.id]) || []);

        // Resolve org and property initials for ticket numbering
        const { data: propData } = await supabase.from('properties').select('name').eq('id', propertyId).maybeSingle();
        const { data: orgData } = await supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle();
        const orgInit = deriveOrgInitials(orgData?.name);
        const propInit = derivePropertyInitials(propData?.name);

        const { data: recentT } = await supabase
            .from('tickets')
            .select('ticket_number')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false })
            .limit(100);

        let maxSeq = 0;
        const prefix = `${orgInit}-${propInit}-`;
        if (recentT) {
            for (const t of recentT) {
                if (t.ticket_number?.startsWith(prefix)) {
                    const s = parseInt(t.ticket_number.substring(prefix.length), 10);
                    if (!isNaN(s) && s > maxSeq) maxSeq = s;
                }
            }
        }
        if (maxSeq === 0) {
            const { count } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('property_id', propertyId);
            maxSeq = count || 0;
        }

        // Prepare tickets for insert
        const ticketsToInsert = validRows.map((row, index) => {
            // 1. The sorting done above (AI, or the keyword rules for a row the AI could not answer)
            const issue_code = row.issue_code ?? null;
            const skill_group = row.skill_group || 'technical';
            const confidence = row.confidence || 'low';

            // 2. Resolve IDs
            const cat = issue_code ? categoryMap.get(issue_code) : null;
            const skillGroupId = cat?.skill_group_id || skillGroupMap.get(skill_group);
            // The AI may only raise the category's usual priority.
            const catPriority = cat?.priority || 'medium';
            const aiPriority = row.priority || '';
            const finalPriority = (priorityRank[aiPriority] ?? -1) > (priorityRank[catPriority] ?? -1) ? aiPriority : catPriority;

            // 3. Extract Floor and Location
            const floorNumber = extractFloorNumber(row.issue_description);
            const location = extractLocation(row.issue_description);

            // 4. Generate sequential ticket number
            const ticketNumber = formatTicketNumber(orgInit, propInit, maxSeq + index + 1);

            return {
                property_id: propertyId,
                organization_id: organizationId,
                ticket_number: ticketNumber,
                title: row.issue_description.slice(0, 100),
                description: row.issue_description,
                category: issue_code || 'general',
                category_id: cat?.id || null,
                skill_group_id: skillGroupId || null,
                priority: finalPriority,
                status: 'open', // Trigger will auto-assign if possible
                raised_by: user.id,
                import_batch_id: importBatchId,
                issue_code: issue_code,
                skill_group_code: skill_group,
                confidence: confidence,
                risk_flag: row.risk_flag ?? null,
                llm_reasoning: row.llm_reasoning ?? null,
                classification_source: row.classification_source || 'rule',
                ...(row.confidence_score != null ? { confidence_score: row.confidence_score } : {}),
                sla_hours: slaHoursFrom(cat ? slaPlans.get(String(cat.id)) : null, finalPriority, cat?.sla_hours, 24),
                floor_number: floorNumber,
                location: location,
                is_internal: false
            };
        });

        // Insert tickets
        const { data: insertedTickets, error: insertError } = await supabase
            .from('tickets')
            .insert(ticketsToInsert)
            .select('id, status, title');

        if (insertError) {
            // Mark import as failed (if batch was created)
            if (importBatchId) {
                await supabase
                    .from('snag_imports')
                    .update({ status: 'failed' })
                    .eq('id', importBatchId);
            }

            console.error('Error inserting tickets:', insertError);
            return NextResponse.json({ error: 'Failed to insert tickets', details: insertError.message }, { status: 500 });
        }

        // Mark import as completed (if batch was created)
        if (importBatchId) {
            await supabase
                .from('snag_imports')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('id', importBatchId);
        }

        // 5. Automatic Assignment (Rule-base + Round Robin)
        // Fetch the full ticket data including skill_group_code for the assignment engine
        const { data: ticketsToAssign } = await supabase
            .from('tickets')
            .select('id, property_id, skill_group_code, status')
            .in('id', insertedTickets.map(t => t.id))
            .eq('status', 'open'); // Only assign unassigned tickets

        let assignmentSummary = null;
        if (ticketsToAssign && ticketsToAssign.length > 0) {
            const assignmentResult = await processIntelligentAssignment(supabase, ticketsToAssign, propertyId);
            assignmentSummary = assignmentResult.summary;
        }

        return NextResponse.json({
            success: true,
            importBatchId: importBatchId,
            ticketsCreated: insertedTickets?.length || 0,
            assignmentSummary,
            tickets: insertedTickets,
        }, { status: 201 });

    } catch (error) {
        console.error('Bulk import API error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
