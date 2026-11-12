import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/frontend/utils/supabase/server';
import { addGuideSheet, xlsxResponse } from '@/backend/lib/excel/templateHelpers';

/**
 * GET /api/roster/template?propertyId=...&month=YYYY-MM
 * Downloads a .xlsx template compatible with POST /api/roster/import.
 * Pre-populates the property's staff and shift codes when propertyId is supplied.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId');
        const monthParam = searchParams.get('month');

        const now = new Date();
        let year = now.getFullYear();
        let monthIndex = now.getMonth();
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            const [y, m] = monthParam.split('-').map(Number);
            if (y > 2000 && m >= 1 && m <= 12) {
                year = y;
                monthIndex = m - 1;
            }
        }

        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const monthStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

        let configs: any[] = [];
        const staffByDesignation: Record<string, string[]> = {};

        if (propertyId) {
            const [{ data: cfgData }, { data: regStaff }, { data: offStaff }] = await Promise.all([
                supabase.from('shift_configurations').select('*').eq('property_id', propertyId),
                supabase
                    .from('property_memberships')
                    .select('user_id, role, custom_designation, users:users!property_memberships_user_id_fkey(full_name)')
                    .eq('property_id', propertyId)
                    .eq('is_active', true)
                    .neq('role', 'vendor')
                    .neq('role', 'tenant')
                    .neq('role', 'super_tenant'),
                supabase.from('offline_roster_staff').select('*').eq('property_id', propertyId),
            ]);

            configs = cfgData || [];
            (regStaff || []).forEach((s: any) => {
                const u = Array.isArray(s.users) ? s.users[0] : s.users;
                if (!u?.full_name) return;
                const desig = (s.custom_designation || s.role || 'STAFF').toUpperCase();
                if (!staffByDesignation[desig]) staffByDesignation[desig] = [];
                staffByDesignation[desig].push(u.full_name);
            });
            (offStaff || []).forEach((s: any) => {
                if (!s.full_name) return;
                const desig = (s.custom_designation || 'STAFF').toUpperCase();
                if (!staffByDesignation[desig]) staffByDesignation[desig] = [];
                staffByDesignation[desig].push(s.full_name);
            });
        }

        const hasStaff = Object.keys(staffByDesignation).length > 0;
        if (!hasStaff) {
            staffByDesignation['MST'] = ['Sample Technician 1', 'Sample Technician 2'];
            staffByDesignation['HOUSEKEEPING - OPERATIONS'] = ['Sample Housekeeping Staff'];
        }

        const workingShiftExample = (() => {
            const work = configs.find((c) => c.is_working_day);
            if (work?.code) return work.code;
            return '09:00 to 18:00';
        })();

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Roster');

        // Row 1: Day names (Row 2 holds the dates so Row 2 wins header detection and Row 1 is skipped cleanly)
        const dayRowValues: string[] = ['', 'Day'];
        const dateRowValues: string[] = ['Sl. No.', 'Name'];
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(year, monthIndex, d);
            dayRowValues.push(dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase());
            dateRowValues.push(`${String(d).padStart(2, '0')}.${String(monthIndex + 1).padStart(2, '0')}.${year}`);
        }

        const dayRow = sheet.addRow(dayRowValues);
        const dateRow = sheet.addRow(dateRowValues);

        dayRow.eachCell((cell, colNum) => {
            if (colNum >= 2) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cell.font = { bold: true, size: 9, color: { argb: 'FF475569' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
        });
        dateRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        sheet.getColumn(1).width = 8;
        sheet.getColumn(2).width = 28;
        for (let c = 3; c <= daysInMonth + 2; c++) {
            sheet.getColumn(c).width = 14;
        }

        let serial = 1;
        const endColLetter = sheet.getColumn(daysInMonth + 2).letter;
        Object.entries(staffByDesignation).forEach(([designation, names]) => {
            const desigRow = sheet.addRow(['', designation.toUpperCase()]);
            sheet.mergeCells(`B${desigRow.number}:${endColLetter}${desigRow.number}`);
            const desigCell = desigRow.getCell(2);
            desigCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
            desigCell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
            desigCell.alignment = { horizontal: 'left', vertical: 'middle' };

            names.forEach((fullName, idx) => {
                const rowVals: (string | number)[] = [serial++, fullName];
                for (let d = 1; d <= daysInMonth; d++) {
                    if (!hasStaff) {
                        // Seed sample shifts on first 3 days when using placeholder staff
                        if (d === 1) rowVals.push(workingShiftExample);
                        else if (d === 2) rowVals.push(idx % 2 === 0 ? workingShiftExample : 'W/O');
                        else if (d === 3) rowVals.push(idx === 0 ? 'Leave' : workingShiftExample);
                        else rowVals.push('');
                    } else {
                        rowVals.push('');
                    }
                }
                const r = sheet.addRow(rowVals);
                r.getCell(1).alignment = { horizontal: 'center' };
                r.getCell(2).alignment = { horizontal: 'left' };
                for (let c = 3; c <= daysInMonth + 2; c++) {
                    r.getCell(c).alignment = { horizontal: 'center' };
                }
            });
        });

        sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

        const guideRows: Array<[string, string, string]> = [
            ['Row 2: Date Headers', 'Required', 'Keep DD.MM.YYYY date headers (or DD-MM-YYYY / YYYY-MM-DD / day numbers 1–31).'],
            ['Col B: Name', 'Required', 'Must match staff full name (fuzzy matching is supported; unknown names auto-create offline staff).'],
            ['ALL-CAPS Section Rows', 'Optional', 'Uppercase rows (e.g. MST, HOUSEKEEPING - OPERATIONS) set the designation for new offline staff below them.'],
            ['Shift Codes', 'Optional', 'Enter any configured shift code, a timing string like "09:00 to 18:00", "W/O" (Week Off), or "Leave".'],
            ['Empty Cells', 'Allowed', 'Leave blank for unassigned days.'],
        ];
        if (configs.length > 0) {
            guideRows.push([
                'Configured Property Shifts',
                'Reference',
                configs
                    .map((c) => `${c.code} (${c.name}${c.start_time && c.end_time ? `: ${c.start_time.slice(0, 5)}-${c.end_time.slice(0, 5)}` : ''})`)
                    .join(' | '),
            ]);
        }
        addGuideSheet(workbook, `Roster Import (${monthStr}) — How to Fill`, guideRows);

        const buffer = await workbook.xlsx.writeBuffer();
        return xlsxResponse(buffer, `Roster_Template_${monthStr}.xlsx`);
    } catch (error) {
        console.error('[GET /api/roster/template] Error:', error);
        return NextResponse.json({ error: 'Failed to generate roster template' }, { status: 500 });
    }
}

