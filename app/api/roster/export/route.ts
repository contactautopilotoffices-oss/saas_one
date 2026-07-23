import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import ExcelJS from 'exceljs';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId');
        const exportType = searchParams.get('exportType') || 'monthly'; // 'monthly', 'weekly', 'daily'
        const dateStr = searchParams.get('date'); // YYYY-MM-DD
        const monthStr = searchParams.get('month'); // YYYY-MM

        if (!propertyId) {
            return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
        }

        let startDate: Date;
        let endDate: Date;

        if (exportType === 'monthly') {
            if (!monthStr) return NextResponse.json({ error: 'month is required' }, { status: 400 });
            const year = parseInt(monthStr.split('-')[0]);
            const month = parseInt(monthStr.split('-')[1]) - 1; 
            startDate = new Date(year, month, 1);
            endDate = new Date(year, month + 1, 0);
        } else if (exportType === 'weekly') {
            if (!dateStr) return NextResponse.json({ error: 'date is required for weekly export' }, { status: 400 });
            const d = new Date(dateStr);
            const day = d.getDay() || 7; // Convert Sunday(0) to 7
            startDate = new Date(d);
            startDate.setDate(d.getDate() - day + 1); // Monday
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6); // Sunday
        } else if (exportType === 'daily') {
            if (!dateStr) return NextResponse.json({ error: 'date is required for daily export' }, { status: 400 });
            startDate = new Date(dateStr);
            endDate = new Date(dateStr);
        } else if (exportType === 'custom') {
            const startStr = searchParams.get('startDate');
            const endStr = searchParams.get('endDate');
            if (!startStr || !endStr) return NextResponse.json({ error: 'startDate and endDate are required for custom export' }, { status: 400 });
            startDate = new Date(startStr);
            endDate = new Date(endStr);
        } else {
            return NextResponse.json({ error: 'Invalid export type' }, { status: 400 });
        }

        const supabase = await createClient();

        // 1. Fetch Configs (to know colors and codes)
        const { data: configs } = await supabase
            .from('shift_configurations')
            .select('*')
            .eq('property_id', propertyId);

        const configMap = new Map((configs || []).map(c => [c.id, c]));

        // 2. Fetch Registered Staff
        const { data: staffMembers } = await supabase
            .from('property_memberships')
            .select(`
                user_id,
                role,
                custom_designation,
                users ( id, full_name )
            `)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .neq('role', 'vendor')
            .neq('role', 'tenant')
            .neq('role', 'super_tenant');

        // Fetch offline staff
        const { data: offlineStaffData } = await supabase
            .from('offline_roster_staff')
            .select('*')
            .eq('property_id', propertyId);

        // Map offline staff
        const offlineStaffMapped = (offlineStaffData || []).map(os => ({
            user_id: os.id,
            role: 'offline',
            custom_designation: os.custom_designation,
            users: {
                id: os.id,
                full_name: os.full_name,
                designation: os.custom_designation || 'UNASSIGNED'
            }
        }));

        const combinedStaff = [...(staffMembers || []), ...offlineStaffMapped];

        // 3. Fetch Rosters
        const { data: rosters } = await supabase
            .from('staff_rosters')
            .select('*')
            .eq('property_id', propertyId)
            .gte('roster_date', startDate.toISOString().split('T')[0])
            .lte('roster_date', endDate.toISOString().split('T')[0]);

        // Group staff by Role/Designation
        const staffByDesignation: Record<string, any[]> = {};
        combinedStaff.forEach(sm => {
            const userObj = Array.isArray(sm.users) ? sm.users[0] : sm.users;
            const desig = sm.custom_designation || sm.role || 'UNASSIGNED';
            if (!staffByDesignation[desig]) staffByDesignation[desig] = [];
            staffByDesignation[desig].push(userObj);
        });

        // Initialize Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Roster');

        // Build Header Rows
        const daysInRange = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        
        const topHeader = ['', 'Date'];
        const subHeader = ['', 'Day'];
        
        const currentLoopDate = new Date(startDate);
        for (let i = 1; i <= daysInRange; i++) {
            const year = currentLoopDate.getFullYear();
            const month = currentLoopDate.getMonth() + 1;
            const date = currentLoopDate.getDate();
            
            topHeader.push(`${date.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`);
            subHeader.push(currentLoopDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase());
            
            currentLoopDate.setDate(currentLoopDate.getDate() + 1);
        }
        
        topHeader.push(''); // Right purple column
        subHeader.push('');

        const headerRow1 = sheet.addRow(topHeader);
        const headerRow2 = sheet.addRow(subHeader);

        sheet.getColumn(1).width = 4; // Left purple
        sheet.getColumn(2).width = 25; // Name
        sheet.getColumn(daysInRange + 3).width = 4; // Right purple

        // Style headers
        [headerRow1, headerRow2].forEach(row => {
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } }; // Purple
            row.getCell(daysInRange + 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } };
            
            for (let i = 2; i <= daysInRange + 2; i++) {
                const cell = row.getCell(i);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6B8B7' } }; // Pinkish
                cell.font = { bold: true };
                cell.alignment = { horizontal: 'center' };
                cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
            }
        });
        
        let currentRow = 3;

        // Iterate through Designations in sorted order
        const getRank = (desig: string) => {
            const d = desig.toUpperCase().trim();
            if (d === 'ASSISTANT MANAGER - TECHNICAL') return 1;
            if (d === 'EXECUTIVE - TECHNICAL') return 2;
            if (d === 'BMS OPERATOR') return 3;
            if (d === 'MST') return 4;
            if (d === 'ASSISTANT MANAGER - OPERATIONS') return 5;
            if (d === 'FACILITY EXECUTIVE - OPERATIONS') return 6;
            if (d === 'TRAINEE - OPERATIONS') return 7;
            if (d === 'HOUSEKEEPING - OPERATIONS') return 8;
            if (d === 'PANTRY - OPERATIONS') return 9;
            if (d === 'SECURITY - OPERATIONS') return 10;
            return 100;
        };

        const sortedDesignations = Object.entries(staffByDesignation)
            .filter(([a]) => getRank(a) <= 10) // ONLY SHOW THESE ROLES
            .sort(([a], [b]) => {
                const rankA = getRank(a);
                const rankB = getRank(b);
                if (rankA !== rankB) return rankA - rankB;
                return a.localeCompare(b);
            });

        for (const [designation, users] of sortedDesignations) {
            // Add Designation Header Row
            const desigRow = sheet.addRow(['', designation.toUpperCase()]);
            // Merge designation across all date columns
            const endColLetter = sheet.getColumn(daysInRange + 2).letter;
            sheet.mergeCells(`B${currentRow}:${endColLetter}${currentRow}`);
            
            // Format Borders and Backgrounds
            desigRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } };
            desigRow.getCell(daysInRange + 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } };
            
            const isAsstManager = designation.toUpperCase().includes('ASSISTANT MANAGER');
            const bgColor = isAsstManager ? 'FFFFFF00' : 'FFD3D3D3'; // Yellow or Grey
            
            const desigCell = desigRow.getCell(2);
            desigCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
            desigCell.font = { bold: true };
            desigCell.alignment = { horizontal: 'center' };
            
            for (let i = 2; i <= daysInRange + 2; i++) {
                desigRow.getCell(i).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
            }
            
            currentRow++;

            // Add Staff Rows
            for (const user of users) {
                const rowData = ['', user.full_name]; 
                
                const shiftLoopDate = new Date(startDate);
                for (let i = 1; i <= daysInRange; i++) {
                    const lYear = shiftLoopDate.getFullYear();
                    const lMonth = shiftLoopDate.getMonth() + 1;
                    const lDate = shiftLoopDate.getDate();
                    const dateStr = `${lYear}-${lMonth.toString().padStart(2, '0')}-${lDate.toString().padStart(2, '0')}`;
                    const rosterEntry = rosters?.find(r => r.user_id === user.id && r.roster_date === dateStr);
                    
                    if (rosterEntry && rosterEntry.shift_id) {
                        const config = configMap.get(rosterEntry.shift_id);
                        if (config) {
                            if (config.is_working_day && config.start_time && config.end_time) {
                                rowData.push(`${config.start_time.slice(0,5)} to ${config.end_time.slice(0,5)}`);
                            } else {
                                rowData.push(config.code);
                            }
                        } else {
                            rowData.push('');
                        }
                    } else {
                        rowData.push('');
                    }
                    shiftLoopDate.setDate(shiftLoopDate.getDate() + 1);
                }
                
                rowData.push(''); // dummy right col
                const userRow = sheet.addRow(rowData);
                
                userRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } };
                userRow.getCell(daysInRange + 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF330066' } };
                
                userRow.getCell(2).alignment = { horizontal: 'left' };
                userRow.getCell(2).border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

                for (let i = 1; i <= daysInRange; i++) {
                    const cell = userRow.getCell(i + 2);
                    cell.alignment = { horizontal: 'center' };
                    cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                    
                    let val = cell.value?.toString();
                    if (val && ['L', 'LEAVE', 'LV'].includes(val.toUpperCase())) {
                        cell.value = 'Leave';
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; // Red
                        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                    } else if (val && ['W/O', 'WO', 'WEEK OFF', 'OFF'].includes(val.toUpperCase())) {
                        cell.value = 'W/O';
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8FAADC' } }; // Blue
                        cell.font = { bold: true };
                    } else if (val && val !== '') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // White
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // White
                    }
                }
                currentRow++;
            }
        }

        // Generate Buffer
        const buffer = await workbook.xlsx.writeBuffer();

        let filename = `Roster_Monthly_${monthStr}.xlsx`;
        if (exportType === 'weekly') {
            filename = `Roster_Weekly_${dateStr}.xlsx`;
        } else if (exportType === 'daily') {
            filename = `Roster_Daily_${dateStr}.xlsx`;
        }

        return new NextResponse(buffer, {
            headers: {
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        });
    } catch (error) {
        console.error('[GET /api/roster/export] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
