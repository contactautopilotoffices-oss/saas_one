import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import ExcelJS from 'exceljs';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const month = searchParams.get('month'); // YYYY-MM
    if (!month) return NextResponse.json({ error: 'Month parameter is required' }, { status: 400 });

    const startDate = `${month}-01`;
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const endDateStr = nextMonth.toISOString().split('T')[0];
    const daysInMonth = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate();

    // Fetch Sources & Tariffs
    const { data: sources, error: sourceErr } = await supabase
        .from('water_sources')
        .select(`*, water_tariffs(*)`)
        .eq('property_id', propertyId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

    if (sourceErr) return NextResponse.json({ error: sourceErr.message }, { status: 500 });

    // Fetch Readings
    const { data: readings, error: readErr } = await supabase
        .from('water_readings')
        .select(`*`)
        .in('source_id', sources.map(s => s.id))
        .gte('reading_date', startDate)
        .lt('reading_date', endDateStr);

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

    // Build Excel Workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Water Management');

    let totalMonthlyExpense = 0;
    
    // Calculate Monthly Expense per source
    const sourceExpenses: Record<string, number> = {};
    sources.forEach(s => {
        sourceExpenses[s.id] = readings.filter(r => r.source_id === s.id).reduce((sum, r) => sum + (r.computed_cost || 0), 0);
        totalMonthlyExpense += sourceExpenses[s.id];
    });

    // Top Row (Total Monthly)
    const topRow = sheet.addRow([]);
    topRow.getCell(sources.length * 3 + 2).value = 'Total Monthly';
    topRow.getCell(sources.length * 3 + 2).font = { bold: true, size: 14 };
    topRow.getCell(sources.length * 3 + 3).value = totalMonthlyExpense;
    topRow.getCell(sources.length * 3 + 3).font = { bold: true, size: 16 };
    
    // Header Row 1
    const h1 = sheet.addRow(['']);
    sources.forEach((s, idx) => {
        const colStart = (idx * 3) + 2; // B, E, H, etc.
        h1.getCell(colStart).value = s.name;
        h1.getCell(colStart).font = { bold: true };
        
        h1.getCell(colStart + 1).value = 'Monthly Expense';
        h1.getCell(colStart + 1).font = { bold: true };
        
        h1.getCell(colStart + 2).value = sourceExpenses[s.id];
        h1.getCell(colStart + 2).font = { bold: true };
    });

    // Header Row 2
    const h2 = sheet.addRow(['Date']);
    h2.getCell(1).font = { bold: true };
    sources.forEach((s, idx) => {
        const colStart = (idx * 3) + 2;
        h2.getCell(colStart).value = 'Date';
        h2.getCell(colStart).font = { bold: true };
        
        h2.getCell(colStart + 1).value = s.source_type === 'jar' ? 'Jars' : 'Loads';
        h2.getCell(colStart + 1).font = { bold: true };
        
        h2.getCell(colStart + 2).value = 'Expense';
        h2.getCell(colStart + 2).font = { bold: true };
    });

    // Data Rows
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${month}-${day.toString().padStart(2, '0')}`;
        const row = sheet.addRow([day]);
        
        sources.forEach((s, idx) => {
            const reading = readings.find(r => r.source_id === s.id && r.reading_date === dateStr);
            const colStart = (idx * 3) + 2;
            row.getCell(colStart).value = dateStr;
            row.getCell(colStart + 1).value = reading?.quantity || 0;
            row.getCell(colStart + 2).value = reading?.computed_cost || 0;
        });
    }

    // Styling grid
    sheet.columns.forEach(column => {
        column.width = 15;
        column.alignment = { horizontal: 'center' };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
        headers: {
            'Content-Disposition': `attachment; filename="Water_Report_${month}.xlsx"`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
    });
}
