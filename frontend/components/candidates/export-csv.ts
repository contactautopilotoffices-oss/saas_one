import { originLabel, STATUS_LABELS, type CandidateRecord } from '@/backend/lib/candidates/types';
import { formatMonths, formatNotice } from './format';

/**
 * The ticked candidates as a CSV file Excel opens directly (owner 2026-11-11, redesign). Built in the browser from the
 * records already on screen: nothing new is asked of the server. A cell that starts like a formula gets an apostrophe
 * in front, so a name such as "=cmd" can never run in Excel.
 */

const COLUMNS: [string, (r: CandidateRecord) => string | number | null | undefined][] = [
    ['Name', r => r.fullName],
    ['Email', r => r.email],
    ['Phone', r => r.phone],
    ['Current company', r => r.currentOrganization],
    ['Current designation', r => r.currentDesignation],
    ['Location', r => r.location],
    ['Total experience', r => (r.totalExpMonths === null ? '' : formatMonths(r.totalExpMonths))],
    ['Relevant experience', r => (r.relevantExpMonths === null ? '' : formatMonths(r.relevantExpMonths))],
    ['Notice period', r => (r.noticePeriodDays === null ? '' : formatNotice(r.noticePeriodDays))],
    ['Current in-hand (Rs/month)', r => r.currentInhand],
    ['Expected in-hand (Rs/month)', r => r.expectedInhand],
    ['Role sourced for', r => r.role],
    ['Status', r => STATUS_LABELS[r.status]],
    ['Candidate source', r => r.candidateSource],
    ['Sourced on', r => r.sourcingDate],
    ['Came from', r => originLabel(r)],
    ['Resume on file', r => (r.hasResume === undefined ? '' : r.hasResume ? 'Yes' : 'No')],
    ['Industry', r => r.extras?.industry],
    ['Education', r => [r.extras?.ugQualification, r.extras?.pgQualification, r.extras?.ppgQualification].filter(q => q && q.toLowerCase() !== 'none').join(', ')],
    ['Skills', r => r.extras?.skills.join(', ')],
    ['Remark', r => r.remark],
];

function cell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsToCsv(records: CandidateRecord[]): string {
    const lines = [COLUMNS.map(([title]) => cell(title)).join(',')];
    for (const record of records) lines.push(COLUMNS.map(([, read]) => cell(read(record))).join(','));
    return lines.join('\r\n');
}

/** Saves the CSV under `name` (the byte-order mark makes Excel read the rupee sign and Indian names correctly). */
export function downloadCsv(name: string, csv: string): void {
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Digits to dial: "+91 98200 00000" -> "+919820000000". */
export function telHref(phone: string): string {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** A WhatsApp chat with this number; a bare 10-digit Indian mobile gets the country code. Null when it is not dialable. */
export function whatsappHref(phone: string): string | null {
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}
