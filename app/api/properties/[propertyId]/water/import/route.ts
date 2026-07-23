import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import Papa from 'papaparse';
import * as xlsx from 'xlsx';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const fileName = file.name.toLowerCase();
    let rows: any[] = [];

    if (fileName.endsWith('.csv')) {
        const text = await file.text();
        const result = Papa.parse(text, { header: true, skipEmptyLines: true });
        if (result.errors.length) {
            return NextResponse.json({ error: 'Failed to parse CSV' }, { status: 400 });
        }
        rows = result.data as any[];
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        try {
            const buffer = await file.arrayBuffer();
            const workbook = xlsx.read(buffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
        } catch (error) {
            return NextResponse.json({ error: 'Failed to parse Excel file' }, { status: 400 });
        }
    } else {
        return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 });
    }

    try {
        const { data: sources } = await supabase
            .from('water_sources')
            .select('*')
            .eq('property_id', propertyId);
            
        if (!sources || sources.length === 0) {
            return NextResponse.json({ error: 'No water sources configured for this property' }, { status: 400 });
        }

        const readingsToSave: any[] = [];
        
        for (const row of rows) {
            let date = row['Date'];
            if (!date) continue;

            // Handle Excel serial date if necessary
            if (typeof date === 'number') {
                const jsDate = xlsx.SSF.parse_date_code(date);
                date = `${jsDate.y}-${String(jsDate.m).padStart(2, '0')}-${String(jsDate.d).padStart(2, '0')}`;
            }
            
            for (const source of sources) {
                const quantityStr = row[source.name];
                if (quantityStr !== undefined && quantityStr !== '') {
                    // Get active tariff securely without RPC
                    const { data: tariffData, error: tariffError } = await supabase
                        .from('water_tariffs')
                        .select('id, rate_per_unit')
                        .eq('source_id', source.id)
                        .lte('effective_from', date)
                        .order('effective_from', { ascending: false })
                        .limit(1);

                    if (tariffError) {
                        throw new Error(`Tariff query failed: ${tariffError.message}`);
                    }

                    let tariffRate = 0;
                    let tariffId = null;

                    if (tariffData && tariffData.length > 0) {
                        tariffId = tariffData[0].id;
                        tariffRate = tariffData[0].rate_per_unit || 0;
                    }

                    const quantity = Number(quantityStr);
                    const computedCost = quantity * tariffRate;

                    readingsToSave.push({
                        source_id: source.id,
                        reading_date: date,
                        quantity: quantity,
                        tariff_id: tariffId,
                        tariff_rate_used: tariffRate,
                        computed_cost: computedCost,
                        created_by: user.id,
                        updated_by: user.id,
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }

        if (readingsToSave.length > 0) {
            const { error } = await supabase
                .from('water_readings')
                .upsert(readingsToSave, { onConflict: 'source_id,reading_date' });
                
            if (error) throw new Error(`Upsert failed: ${error.message}`);
        }

        return NextResponse.json({ success: true, count: readingsToSave.length });
    } catch (e: any) {
        console.error('Import error:', e);
        return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 });
    }
}
