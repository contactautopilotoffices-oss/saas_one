import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import * as XLSX from 'xlsx';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse('Unauthorized', { status: 401 });

    const { data: sources } = await supabase
        .from('water_sources')
        .select('name')
        .eq('property_id', propertyId);

    if (!sources || sources.length === 0) {
        return new NextResponse('No water sources found. Configure sources first.', { status: 400 });
    }

    const sourceNames = sources.map(s => s.name);
    const headers = ['Date', ...sourceNames];
    
    // Create an empty row to show as example
    const exampleRow: any = { Date: '2026-06-15' };
    for (const name of sourceNames) {
        exampleRow[name] = 10;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([exampleRow], { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
        headers: {
            'Content-Disposition': 'attachment; filename="Water_Import_Template.xlsx"',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
    });
}
