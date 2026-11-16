'use client';

import { clock, niceDate, type MeetingDetail, type MeetingTask } from './api';

/**
 * Owner 2026-10-29: download a meeting's notes — summary, decisions, open questions, notes, the task list and
 * (optionally) the transcript — as a PDF (jsPDF, already in the project; real text, not a picture) or as a Word file.
 * The Word file is HTML saved as .doc, which Word opens as a document (no new library; a true .docx would need one).
 * Everything is built in the browser from what is on the screen; nothing is sent anywhere.
 *
 * Owner 2026-11-13: several meetings at once (the list's "Download notes" for the ticked meetings) make ONE combined
 * file — one meeting per section, each on a new page in the PDF — because phones block several downloads in a row and
 * a ZIP would need a new library. `exportPdf` / `exportWord` (one meeting) are the same code with one item.
 */

export interface ExportInput { meeting: MeetingDetail; tasks: MeetingTask[]; includeTranscript: boolean }

const fileBase = (m: MeetingDetail) => `${m.title} ${m.meetingDate}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'meeting_notes';
const today = () => new Date().toISOString().slice(0, 10);
/** File name: the meeting's own for one, "Meeting_notes_<n>_meetings_<date>" for several. */
const fileName = (items: ExportInput[]) => (items.length === 1 ? fileBase(items[0].meeting) : `Meeting_notes_${items.length}_meetings_${today()}`);

function owner(t: MeetingTask): string {
    if (t.ownerNames.length) return t.ownerNames.join(', ');
    return t.ownerName ? `${t.ownerName} (not matched)` : '—';
}
const due = (t: MeetingTask) => (t.dueDate ? `${niceDate(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ''}` : '—');
const taskStatus = (t: MeetingTask) => (t.status === 'sent' ? 'Sent' : 'Draft');
const people = (m: MeetingDetail) => [...m.attendees.map(a => a.name), ...m.extraNames].join(', ') || '—';

function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Word (.doc) ───────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (items: string[]) => (items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>None.</p>');

function wordSection({ meeting: m, tasks, includeTranscript }: ExportInput): string {
    const s = m.summary;
    const cell = 'border:1px solid #bbb;padding:4px 6px;vertical-align:top;';
    return `<h1>${esc(m.title)}</h1>
<p class="muted">${esc(niceDate(m.meetingDate))}${m.durationSeconds ? ` · ${clock(m.durationSeconds)} long` : ''}</p>
<p><b>Present:</b> ${esc(people(m))}</p>
${s ? `<h2>Summary</h2><p>${esc(s.summary)}</p>
<h2>Decisions</h2>${list(s.decisions)}
<h2>Open questions</h2>${list(s.openQuestions)}
<h2>Notes</h2>${s.notes.length ? s.notes.map(n => `<h3>${esc(n.topic)}</h3>${list(n.points)}`).join('') : '<p>None.</p>'}` : ''}
<h2>Tasks</h2>
${tasks.length ? `<table><tr><th style="${cell}">#</th><th style="${cell}">Task</th><th style="${cell}">For</th><th style="${cell}">Due</th><th style="${cell}">Status</th></tr>
${tasks.map((t, i) => `<tr><td style="${cell}">${i + 1}</td><td style="${cell}">${esc(t.title)}${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''}</td><td style="${cell}">${esc(owner(t))}</td><td style="${cell}">${esc(due(t))}</td><td style="${cell}">${taskStatus(t)}</td></tr>`).join('')}
</table>` : '<p>No tasks.</p>'}
${includeTranscript && m.transcript.length ? `<h2>Transcript</h2>${m.transcript.map(l => `<p><span class="muted">[${clock(l.start)}]</span> ${l.speaker ? `<b>${esc(l.speaker)}:</b> ` : ''}${esc(l.text)}</p>`).join('')}` : ''}`;
}

export function exportManyWord(items: ExportInput[]) {
    if (!items.length) return;
    const title = items.length === 1 ? items[0].meeting.title : `Meeting notes (${items.length} meetings)`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4} h1{font-size:18pt;margin:0 0 4pt} h2{font-size:13pt;margin:14pt 0 4pt} h3{font-size:11pt;margin:8pt 0 2pt} .muted{color:#555} table{border-collapse:collapse;width:100%} .break{page-break-before:always}</style></head>
<body>
${items.map((it, i) => `${i ? '<br clear="all" class="break" style="page-break-before:always">' : ''}${wordSection(it)}`).join('\n')}
</body></html>`;
    // The BOM makes Word read the file as UTF-8 (names, ₹, Hindi)
    download(new Blob(['﻿', html], { type: 'application/msword' }), `${fileName(items)}.doc`);
}

export function exportWord(input: ExportInput) {
    exportManyWord([input]);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

/** The built-in PDF font only has Western characters: map the common ones, drop what it cannot draw. */
function pdfSafe(s: string): string {
    return s.replace(/₹/g, 'Rs. ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
        .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

export async function exportManyPdf(items: ExportInput[]) {
    if (!items.length) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const M = 48, width = W - 2 * M;
    let y = M;

    const room = (h: number) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
    const text = (s: string, o: { size?: number; bold?: boolean; gray?: boolean; indent?: number; gap?: number } = {}) => {
        const size = o.size ?? 10.5;
        pdf.setFont('helvetica', o.bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        pdf.setTextColor(o.gray ? 100 : 20);
        const lines: string[] = pdf.splitTextToSize(pdfSafe(s), width - (o.indent ?? 0));
        const lh = size * 1.35;
        for (const line of lines) { room(lh); pdf.text(line, M + (o.indent ?? 0), y + size); y += lh; }
        y += o.gap ?? 4;
    };
    const heading = (s: string) => { y += 8; room(40); text(s, { size: 13, bold: true, gap: 6 }); };
    const bullets = (items: string[]) => { if (!items.length) text('None.', { gray: true }); for (const i of items) text(`-  ${i}`, { indent: 8, gap: 2 }); };

    // Several meetings: a short contents page first
    if (items.length > 1) {
        text(`Meeting notes - ${items.length} meetings`, { size: 18, bold: true, gap: 2 });
        text(`Made on ${niceDate(today())}`, { gray: true, gap: 8 });
        items.forEach((it, i) => text(`${i + 1}. ${it.meeting.title}  -  ${niceDate(it.meeting.meetingDate)}`, { gap: 2 }));
    }

    items.forEach(({ meeting: m, tasks, includeTranscript }, idx) => {
        if (items.length > 1 || idx > 0) { pdf.addPage(); y = M; }
        text(m.title, { size: 18, bold: true, gap: 2 });
        text(`${niceDate(m.meetingDate)}${m.durationSeconds ? `  -  ${clock(m.durationSeconds)} long` : ''}`, { gray: true });
        text(`Present: ${people(m)}`);

        const s = m.summary;
        if (s) {
            heading('Summary'); text(s.summary);
            heading('Decisions'); bullets(s.decisions);
            heading('Open questions'); bullets(s.openQuestions);
            heading('Notes');
            if (!s.notes.length) text('None.', { gray: true });
            for (const n of s.notes) { text(n.topic, { bold: true, gap: 2 }); bullets(n.points); y += 4; }
        }

        heading('Tasks');
        if (!tasks.length) text('No tasks.', { gray: true });
        tasks.forEach((t, i) => {
            room(48);
            text(`${i + 1}. ${t.title}`, { bold: true, gap: 1 });
            text(`For: ${owner(t)}    Due: ${due(t)}    ${taskStatus(t)}`, { gray: true, indent: 14, gap: t.note ? 1 : 6 });
            if (t.note) text(t.note, { indent: 14, gap: 6 });
        });

        if (includeTranscript && m.transcript.length) {
            heading('Transcript');
            for (const l of m.transcript) text(`[${clock(l.start)}] ${l.speaker ? `${l.speaker}: ` : ''}${l.text}`, { size: 9.5, gap: 2 });
        }
    });

    // Page numbers
    const footer = items.length === 1 ? items[0].meeting.title : `Meeting notes (${items.length} meetings)`;
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(140);
        pdf.text(pdfSafe(`${footer} - page ${p} of ${pages}`), W / 2, H - 24, { align: 'center' });
    }
    pdf.save(`${fileName(items)}.pdf`);
}

export async function exportPdf(input: ExportInput) {
    await exportManyPdf([input]);
}
