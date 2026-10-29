import type { Expense } from '@/frontend/components/pettyCash/workflowTypes';

function escapeCsvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

export function generateCsvContent(expenses: Expense[]): string {
    const headers = [
        'Expense Date',
        'Request No',
        'Property',
        'Spend Mode',
        'Payee / Vendor',
        'Category',
        'Amount (INR)',
        'Payment Mode',
        'Payment Reference',
        'Purpose / Description',
        'Bills Attached',
        'Review Status',
        'Review Remarks'
    ];

    const rows = expenses.map(exp => [
        exp.expense_date ? exp.expense_date.slice(0, 10) : '',
        exp.request?.request_no || '',
        exp.property?.name || '',
        exp.spend_mode || 'Operation',
        exp.vendor || '',
        exp.category || '',
        exp.amount !== undefined ? Number(exp.amount).toFixed(2) : '0.00',
        exp.payment_mode || '',
        exp.payment_ref || '',
        exp.description || '',
        exp.documents?.length ? `${exp.documents.length} bill(s)` : 'None',
        exp.review_status || 'pending',
        exp.review_remarks || ''
    ]);

    const csvBody = [
        headers.map(escapeCsvField).join(','),
        ...rows.map(row => row.map(escapeCsvField).join(','))
    ].join('\r\n');

    // Add UTF-8 BOM so Excel recognizes unicode Indian Rupees and headers properly
    return '\uFEFF' + csvBody;
}

export function generateExcelHtml(expenses: Expense[]): string {
    const headers = [
        'Expense Date',
        'Request No',
        'Property',
        'Spend Mode',
        'Payee / Vendor',
        'Category',
        'Amount (INR)',
        'Payment Mode',
        'Payment Reference',
        'Purpose / Description',
        'Bills Attached',
        'Review Status',
        'Review Remarks'
    ];

    const rowsHtml = expenses.map((exp, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        const modeBg = exp.spend_mode === 'Client' ? '#fef3c7' : '#e0e7ff';
        const modeColor = exp.spend_mode === 'Client' ? '#92400e' : '#3730a3';
        return `<tr style="background-color: ${bg}; font-family: sans-serif; font-size: 12px;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; white-space: nowrap;">${exp.expense_date ? exp.expense_date.slice(0, 10) : ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">${exp.request?.request_no || '—'}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${exp.property?.name || '—'}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">
                <span style="background-color: ${modeBg}; color: ${modeColor}; padding: 3px 8px; border-radius: 9999px; font-weight: bold; font-size: 10px; text-transform: uppercase;">
                    ${exp.spend_mode || 'Operation'}
                </span>
            </td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 500;">${exp.vendor || ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${exp.category || ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; font-family: monospace;">₹${Number(exp.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${exp.payment_mode || ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${exp.payment_ref || ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${exp.description || ''}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: center;">${exp.documents?.length ? `${exp.documents.length} bill(s)` : 'None'}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-transform: capitalize;">${(exp.review_status || 'pending').replace('_', ' ')}</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${exp.review_remarks || ''}</td>
        </tr>`;
    }).join('\n');

    const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const opSpent = expenses.filter(e => (e.spend_mode || 'Operation') === 'Operation').reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const clientSpent = expenses.filter(e => e.spend_mode === 'Client').reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <!--[if gte mso 9]>
        <xml>
            <x:ExcelWorkbook>
                <x:ExcelWorksheets>
                    <x:ExcelWorksheet>
                        <x:Name>Petty Cash Spends</x:Name>
                        <x:WorksheetOptions>
                            <x:DisplayGridlines/>
                        </x:WorksheetOptions>
                    </x:ExcelWorksheet>
                </x:ExcelWorksheets>
            </x:ExcelWorkbook>
        </xml>
        <![endif]-->
    </head>
    <body style="font-family: sans-serif;">
        <h2 style="font-size: 18px; font-weight: bold; color: #0f172a; margin-bottom: 4px;">Petty Cash Expense Report</h2>
        <p style="font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 12px;">Generated on ${new Date().toLocaleString('en-IN')}</p>
        
        <table style="margin-bottom: 16px; border-collapse: collapse;">
            <tr>
                <td style="padding: 6px 14px; background: #f1f5f9; border: 1px solid #cbd5e1; font-weight: bold; font-size: 11px;">Total Expenses:</td>
                <td style="padding: 6px 14px; background: #ffffff; border: 1px solid #cbd5e1; font-weight: bold; font-size: 12px;">₹${totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style="padding: 6px 14px; background: #e0e7ff; border: 1px solid #cbd5e1; font-weight: bold; color: #3730a3; font-size: 11px;">Operation Spends:</td>
                <td style="padding: 6px 14px; background: #ffffff; border: 1px solid #cbd5e1; font-weight: bold; font-size: 12px;">₹${opSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style="padding: 6px 14px; background: #fef3c7; border: 1px solid #cbd5e1; font-weight: bold; color: #92400e; font-size: 11px;">Client Spends:</td>
                <td style="padding: 6px 14px; background: #ffffff; border: 1px solid #cbd5e1; font-weight: bold; font-size: 12px;">₹${clientSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
        </table>

        <table style="border-collapse: collapse; width: 100%;">
            <thead>
                <tr style="background-color: #0f172a; color: #ffffff;">
                    ${headers.map(h => `<th style="padding: 10px 12px; font-weight: bold; font-size: 11px; text-transform: uppercase; border: 1px solid #334155; text-align: left; white-space: nowrap;">${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    </body>
    </html>`;
}

export function exportExpensesToCsv(expenses: Expense[], filenamePrefix = 'petty_cash_expenses'): void {
    const csvContent = generateCsvContent(expenses);
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `${filenamePrefix}_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function exportExpensesToExcel(expenses: Expense[], filenamePrefix = 'petty_cash_expenses'): void {
    const html = generateExcelHtml(expenses);
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `${filenamePrefix}_${dateStr}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
