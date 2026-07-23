import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isValidUuid } from '@/backend/lib/utils';
import * as XLSX from 'xlsx';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Target schema for procurement_catalog items
const TARGET_FIELDS = ['name', 'description', 'category', 'unit', 'estimated_price'] as const;
type TargetField = typeof TARGET_FIELDS[number];
type ColumnMapping = Record<TargetField, string | null>;

// ─── Role guard ────────────────────────────────────────────────────────────────
async function isProcurementUser(userId: string, organizationId: string): Promise<boolean> {
    if (!isValidUuid(organizationId)) return false;
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .maybeSingle();
    return ['procurement', 'org_super_admin', 'master_admin'].includes(data?.role || '');
}

// ─── Org Resolver ────────────────────────────────────────────────────────────
async function resolveOrganizationId(userId: string, providedId: string | null): Promise<string | null> {
    if (providedId && isValidUuid(providedId)) return providedId;
    
    const adminSupabase = createAdminClient();
    const { data } = await adminSupabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
        
    return data?.organization_id || null;
}

// ─── Extract rows from file (CSV or Excel) ───────────────────────────────────
async function extractRowsFromFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON (header: 1 returns array of arrays)
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    if (data.length === 0) return { headers: [], rows: [] };

    // ── Find the first non-empty row to use as headers ──────────────────────
    let headerRowIndex = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1 || headerRowIndex === data.length - 1) {
        return { headers: [], rows: [] };
    }

    const headers = data[headerRowIndex].map(h => String(h || '').trim()).filter(Boolean);
    const rows: Record<string, string>[] = [];

    // Parse subsequent rows
    for (let i = headerRowIndex + 1; i < data.length; i++) {
        const rowData = data[i];
        if (!rowData || rowData.length === 0) continue;
        
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
            row[header] = String(rowData[index] ?? '').trim();
        });
        
        // Skip empty rows
        if (Object.values(row).some(v => v !== '')) {
            rows.push(row);
        }
    }

    return { headers, rows };
}

// ─── Ask Groq to map CSV columns → our target schema ──────────────────────────
// Anti-hallucination: AI can ONLY choose from the provided headers or return null.
// Backend validates every returned value against actual headers before using it.
async function mapColumnsWithGroq(headers: string[], sampleRows: Record<string, string>[]): Promise<ColumnMapping | null> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.warn('[BulkUpload] GROQ_API_KEY not set, skipping AI mapping');
        return null;
    }

    const systemPrompt = `You are a strict CSV/Excel column mapper. You receive a list of column headers and sample data rows.
Your ONLY job: map our target field names to the most matching header from the file.

Target Fields & Synonyms:
1. name: Matches "Product Name", "Item", "Title", "Material", "Product", "Description" (if no better name exists)
2. description: Matches "Details", "Specifications", "Specs", "About"
3. category: Matches "Group", "Type", "Class", "Section"
4. unit: Matches "UoM", "Pack", "Size", "Measurement"
5. estimated_price: Matches "Price", "Cost", "Rate", "Amount", "Value"

Rules (STRICTLY ENFORCED):
1. You MUST only use column names from the provided headers list
2. If no column clearly matches a target field, return null for that field
3. Return ONLY a valid JSON object — no explanation, no markdown`;

    const userPrompt = `CSV Headers (choose ONLY from this list):
${JSON.stringify(headers)}

Sample rows (first ${sampleRows.length}):
${JSON.stringify(sampleRows, null, 2)}

Map each target field to the best matching header from the list above. Return null if no match.`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.0, // Zero temperature — fully deterministic, no creativity
                max_tokens: 200,
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error('[BulkUpload] Groq API error:', response.status);
            return null;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content) as Partial<ColumnMapping>;

        // ── Anti-hallucination validation ──────────────────────────────────────
        // Reject any mapped column that does not exist in actual CSV headers
        const headerSet = new Set(headers);
        const validated: ColumnMapping = {
            name: null,
            description: null,
            category: null,
            unit: null,
            estimated_price: null,
        };

        for (const field of TARGET_FIELDS) {
            const mappedCol = parsed[field];
            if (mappedCol && headerSet.has(mappedCol)) {
                validated[field] = mappedCol; // Only accept real columns
            } else if (mappedCol) {
                console.warn(`[BulkUpload] Groq hallucinated column "${mappedCol}" for field "${field}" — rejected`);
            }
        }

        return validated;
    } catch (err) {
        console.error('[BulkUpload] Groq call failed:', err);
        return null;
    }
}

// ─── POST /api/procurement/catalog/bulk-upload ─────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const providedOrgId = formData.get('organizationId') as string | null;

        const organizationId = await resolveOrganizationId(user.id, providedOrgId);

        if (!file || !organizationId) {
            return NextResponse.json({ error: 'file and Valid organizationId are required' }, { status: 400 });
        }

        if (!(await isProcurementUser(user.id, organizationId))) {
            return NextResponse.json({ error: 'Forbidden: procurement role required' }, { status: 403 });
        }

        // Extract rows using XLSX (handles CSV, XLSX, XLS)
        const { headers, rows } = await extractRowsFromFile(file);

        if (headers.length === 0) {
            return NextResponse.json({ error: 'CSV file is empty or invalid' }, { status: 400 });
        }
        if (rows.length === 0) {
            return NextResponse.json({ error: 'CSV has headers but no data rows' }, { status: 400 });
        }
        if (rows.length > 500) {
            return NextResponse.json({ error: 'Maximum 500 rows per upload' }, { status: 400 });
        }

        // AI column mapping — sample max 3 rows to keep prompt small
        const sampleRows = rows.slice(0, 3);
        const mapping = await mapColumnsWithGroq(headers, sampleRows);

        if (!mapping || !mapping.name) {
            return NextResponse.json({
                error: 'Could not identify a "name" column in your CSV. Please ensure your CSV has a column with item names.',
                headers,
                mapping,
            }, { status: 422 });
        }

        // ── Transform all rows using validated mapping ──────────────────────────
        const adminSupabase = createAdminClient();
        
        // ── Get existing items to prevent duplicates ──────────────────────────
        const { data: existingItems } = await adminSupabase
            .from('procurement_catalog')
            .select('name')
            .eq('organization_id', organizationId)
            .eq('is_active', true);
        
        const existingNames = new Set((existingItems || []).map(i => i.name.toLowerCase()));

        const toInsert: any[] = [];
        let skipped = 0;
        let duplicates = 0;

        for (const row of rows) {
            const name = mapping.name ? row[mapping.name]?.trim() : '';
            if (!name) { skipped++; continue; } 

            if (existingNames.has(name.toLowerCase())) {
                duplicates++;
                continue;
            }

            toInsert.push({
                organization_id: organizationId,
                name,
                description: mapping.description ? (row[mapping.description]?.trim() || null) : null,
                category: mapping.category ? (row[mapping.category]?.trim() || null) : null,
                unit: mapping.unit ? (row[mapping.unit]?.trim() || 'pcs') : 'pcs',
                estimated_price: mapping.estimated_price
                    ? parseFloat(row[mapping.estimated_price]?.replace(/[^0-9.]/g, '') || '0') || 0
                    : 0,
                is_active: true,
            });
        }

        if (toInsert.length === 0) {
            return NextResponse.json({
                error: 'No valid rows found. All rows were missing a name value.',
                skipped,
                mapping,
            }, { status: 422 });
        }

        // Bulk insert
        const { data: inserted, error: insertErr } = await adminSupabase
            .from('procurement_catalog')
            .insert(toInsert)
            .select('id, name, category, unit, estimated_price');

        if (insertErr) {
            console.error('[BulkUpload] DB insert error:', insertErr);
            return NextResponse.json({ error: 'Database error during insert' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            inserted: inserted?.length || 0,
            skipped,
            duplicates,
            mapping, // Return mapping so frontend can show what was auto-detected
            preview: (inserted || []).slice(0, 5), // First 5 inserted items as preview
        });

    } catch (error) {
        console.error('[BulkUpload] API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
