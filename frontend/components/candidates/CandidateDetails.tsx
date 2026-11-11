'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Paperclip, PencilLine, ScanText, Search, Unlink } from 'lucide-react';
import { DEFENCE_OPTIONS, EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { markKeywords } from '@/backend/lib/candidates/snippet';
import {
    MATCH_REASON_LABELS, originLabel, STATUS_LABELS, TEXT_STATUS_LABELS, type CandidateRecord, type ResumeFile, type ResumeFilesResponse,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate, formatInr, formatMonths, formatNotice } from './format';
import { ContactActions } from './QuickView';
import { OriginTag, WorkedOut } from './ResultCard';
import ResumeDocument, { hasProfile } from './ResumeDocument';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Drawer, EmptyState, INPUT, LABEL, Spinner, StatusBadge, Tag, useUi, WELL } from './ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium text-text-secondary">{label}</dt>
            <dd className="mt-0.5 break-words text-sm font-medium text-text-primary">{value || <span className="font-normal text-text-tertiary">Not on record</span>}</dd>
        </div>
    );
}

type Files = { candidateId: string; files: ResumeFile[]; error: string };

/**
 * One candidate, read-only, so opening a card cannot change anything by accident. Edit details opens the record form.
 *
 * Redesign (owner 2026-11-11): a workspace. On a wide screen the resume's text is on the left with the search keywords
 * marked, and the details are on the right, so HR reads both without switching tabs; below that width the details come
 * first and the resume follows. The text is what the reader took out of the file (or typed out from a scan), not the
 * file's layout: "Open original" shows the file itself in a new tab. It opens the same from Search and from the
 * Candidates table, which hands over a record without the resume fields: those are fetched here.
 *
 * Second round (owner 2026-11-11): the left side is a structured resume (ResumeDocument: the same sections for every
 * candidate, then the file's own text laid out by rule), so the summary, skills and employers moved there from the
 * right side. A value worked out from the resume's employers is marked "worked out".
 */
export default function CandidateDetails({ record, open, onClose, onEdit, orgId, onChanged, keywords = [] }: {
    record: CandidateRecord; open: boolean; onClose: () => void; onEdit: () => void;
    orgId: string;
    /** A resume was attached or detached (phase 2): the lists behind the panel refetch. */
    onChanged?: () => void;
    /** The search's keywords, marked in the resume's text. */
    keywords?: string[];
}) {
    const { reportError } = useUi();

    // The Candidates table lists records without the resume fields: fetch the full record once per opening.
    const [full, setFull] = useState<{ id: string; record: CandidateRecord } | null>(null);
    const needsFull = open && record.extras === undefined && full?.id !== record.id;
    useEffect(() => {
        if (!needsFull) return;
        const ctrl = new AbortController();
        void api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setFull({ id: record.id, record: res.data.record });
            else if (res.noAccess) reportError(res);
        });
        return () => ctrl.abort();
    }, [needsFull, record.id, orgId, reportError]);
    const r: CandidateRecord = full?.id === record.id ? { ...full.record, ...record, extras: record.extras ?? full.record.extras, hasResume: record.hasResume ?? full.record.hasResume, inferred: record.inferred ?? full.record.inferred } : record;
    const x = r.extras;

    // The candidate's resume files: the list on the right, and the one being read on the left.
    const [nonce, setNonce] = useState(0);
    const filesKey = JSON.stringify([orgId, r.candidateId, nonce]);
    const [loaded, setLoaded] = useState<Files | null>(null);
    useEffect(() => {
        if (!open) return;
        const ctrl = new AbortController();
        void api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, candidateId: r.candidateId, pageSize: 20 })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ candidateId: r.candidateId, files: [], error: res.error }); return; }
            setLoaded({ candidateId: r.candidateId, files: res.data.files, error: '' });
        });
        return () => ctrl.abort();
    }, [open, filesKey, orgId, r.candidateId, reportError]);
    // After an attach or a detach the old list stays up until the new one arrives; another candidate's never shows.
    const mine = loaded?.candidateId === r.candidateId ? loaded : null;
    const files = mine?.files ?? [];
    const filesReady = mine !== null;
    const [viewId, setViewId] = useState<string | null>(null);
    const viewing = files.find(f => f.id === viewId) ?? files[0] ?? null;

    const qualifications = x ? [x.ugQualification, x.pgQualification, x.ppgQualification].filter(q => q && q.toLowerCase() !== NO_QUALIFICATION) : [];
    const resumeRows: [string, React.ReactNode][] = x ? [
        ['Industry', x.industry],
        ['Education', qualifications.join(', ')],
        ['Institute', x.institute],
        ['Degree completed', x.degreeYear ? String(x.degreeYear) : null],
        ['Education type', EDUCATION_TYPES.find(t => t.id === x.educationType)?.label],
        ['Would move to', x.preferredLocations.join(', ')],
        ['Career break', x.careerBreak === null ? null : x.careerBreak ? 'Yes' : 'No'],
        ['Defence background', DEFENCE_OPTIONS.find(d => d.id === x.defenceBackground)?.label],
        ['Serving notice', x.servingNotice === null ? null : x.servingNotice ? 'Yes' : 'No'],
    ].filter(([, value]) => !!value) as [string, React.ReactNode][] : [];
    const headline = [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' at '), r.location].filter(Boolean).join(' · ');

    return (
        <Drawer
            wide
            open={open}
            onClose={onClose}
            labelId="candidate-details-title"
            title={r.fullName}
            subtitle={headline || undefined}
            footer={
                <>
                    <button type="button" onClick={onClose} className={`${BTN_SECONDARY} flex-1 sm:flex-none`}>Close</button>
                    <button type="button" onClick={onEdit} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}><PencilLine className="h-4 w-4" />Edit details</button>
                </>
            }
        >
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <ResumePane orgId={orgId} record={r} file={viewing} files={files} ready={filesReady} error={mine?.error ?? ''} onPick={setViewId} keywords={keywords} />

                <div className="order-1 px-4 py-5 sm:px-6 lg:order-2 lg:w-[440px] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={r.status} />
                        {r.hasResume === true && <Tag tone="success" icon={FileText}>Resume</Tag>}
                        {r.hasResume === false && <Tag>No resume</Tag>}
                        <OriginTag record={r} />
                    </div>

                    <div className="mt-4"><ContactActions record={r} /></div>

                    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
                        <Row label="Current designation" value={r.currentDesignation && <>{r.currentDesignation}{r.inferred?.includes('currentDesignation') && <WorkedOut what="the latest employer" />}</>} />
                        <Row label="Current company" value={r.currentOrganization && <>{r.currentOrganization}{r.inferred?.includes('currentOrganization') && <WorkedOut what="the latest employer" />}</>} />
                        <Row label="Status" value={STATUS_LABELS[r.status]} />
                        <Row label="Location" value={r.location} />
                        <Row label="Total experience" value={r.totalExpMonths !== null && <>{formatMonths(r.totalExpMonths)}{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</>} />
                        <Row label="Relevant experience" value={r.relevantExpMonths !== null && formatMonths(r.relevantExpMonths)} />
                        <Row label="Notice period" value={r.noticePeriodDays !== null && formatNotice(r.noticePeriodDays)} />
                        <Row label="Role sourced for" value={r.role} />
                        <Row label="Current in-hand" value={r.currentInhand !== null && formatInr(r.currentInhand)} />
                        <Row label="Expected in-hand" value={r.expectedInhand !== null && formatInr(r.expectedInhand)} />
                        <Row label="Source" value={r.candidateSource} />
                        <Row label="Sourced" value={r.sourcingDate ? formatDate(r.sourcingDate) : null} />
                        <Row label="Came from" value={`${originLabel(r)}${r.sourceRow ? `, row ${r.sourceRow}` : ''}`} />
                        <Row label="Updated" value={formatDate(r.updatedAt)} />
                        {resumeRows.map(([label, value]) => <Row key={label} label={label} value={value} />)}
                    </dl>

                    <ResumeSection
                        orgId={orgId} candidateId={r.candidateId} fullName={r.fullName}
                        files={files} ready={filesReady} error={mine?.error ?? ''} viewingId={viewing?.id ?? null} onView={setViewId}
                        onChanged={() => { setNonce(n => n + 1); onChanged?.(); }}
                    />

                    <div className="mt-5">
                        <p className="text-xs font-medium text-text-secondary">Remark</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-primary">{r.remark || <span className="text-text-tertiary">No remark</span>}</p>
                    </div>
                </div>
            </div>
        </Drawer>
    );
}

const openUrl = (orgId: string, file: ResumeFile, inline: boolean) => {
    window.open(`/api/candidates/resumes/${encodeURIComponent(file.id)}${qs({ orgId, inline })}`, '_blank', 'noopener');
};

/** The resume being read: a structured page (ResumeDocument) built from the details on record and the file's own text. */
function ResumePane({ orgId, record, file, files, ready, error, onPick, keywords }: {
    orgId: string; record: CandidateRecord; file: ResumeFile | null; files: ResumeFile[]; ready: boolean; error: string; onPick: (id: string) => void; keywords: string[];
}) {
    const [text, setText] = useState<{ id: string; text: string; fromScan: boolean; error: string } | null>(null);
    const fileId = file?.id ?? null;
    useEffect(() => {
        if (!fileId) return;
        const ctrl = new AbortController();
        void api<{ fileName: string; text: string; fromScan: boolean }>(`/api/candidates/resumes/${encodeURIComponent(fileId)}${qs({ orgId, text: true })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setText(res.ok ? { id: fileId, text: res.data.text, fromScan: res.data.fromScan, error: '' } : { id: fileId, text: '', fromScan: false, error: res.error });
        });
        return () => ctrl.abort();
    }, [fileId, orgId]);
    const current = text?.id === fileId ? text : null;
    // Counted again only when the text or the keywords change (the keywords arrive as a new array on every render).
    const body = current?.text ?? '';
    const keywordKey = keywords.join('\n');
    const words = useMemo(() => (keywordKey ? keywordKey.split('\n') : []), [keywordKey]);
    const hits = useMemo(() => (body && words.length ? markKeywords(body, words).filter(p => p.hit).length : 0), [body, words]);
    const profile = hasProfile(record);

    return (
        <section aria-label="Resume" className="order-2 flex min-h-0 flex-col border-t border-border-subtle bg-surface-elevated lg:order-1 lg:min-w-0 lg:flex-1 lg:border-r lg:border-t-0">
            {file && (
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle bg-surface px-4 py-2.5 sm:px-6">
                    <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                    {files.length > 1 ? (
                        <select aria-label="Which resume to read" value={file.id} onChange={e => onPick(e.target.value)} className="h-9 min-w-0 max-w-full flex-1 truncate rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                            {files.map(f => <option key={f.id} value={f.id}>{f.fileName}</option>)}
                        </select>
                    ) : (
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary" title={file.fileName}>{file.fileName}</p>
                    )}
                    {current?.fromScan && <Tag tone="info" icon={ScanText} title="This file is a scan: its text was typed out by AI and may have small mistakes. Check against the original.">Typed from a scan</Tag>}
                    {hits > 0 && <Tag tone="neutral">{hits} keyword {hits === 1 ? 'match' : 'matches'}</Tag>}
                    <span className="flex items-center gap-x-1 gap-y-1">
                        <button type="button" onClick={() => openUrl(orgId, file, true)} className={BTN_GHOST}><ExternalLink className="h-4 w-4" />Open original</button>
                        <button type="button" onClick={() => openUrl(orgId, file, false)} className={BTN_GHOST} aria-label={`Download ${file.fileName}`} title="Download"><Download className="h-4 w-4" /></button>
                    </span>
                </div>
            )}

            <div className="min-h-0 flex-1 px-4 py-4 sm:p-6 lg:overflow-y-auto lg:overscroll-contain">
                {!ready ? (
                    <p className="flex items-center gap-x-2 gap-y-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the resume</p>
                ) : error ? (
                    <p role="alert" className="text-sm text-error">{error}</p>
                ) : file && !current ? (
                    <p className="flex items-center gap-x-2 gap-y-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Reading the resume</p>
                ) : current?.error ? (
                    <p role="alert" className="text-sm text-error">{current.error}</p>
                ) : !file && !profile ? (
                    <EmptyState icon={FileText} title="No resume on file">
                        A resume with {record.fullName}&rsquo;s email or phone is linked by itself once it is uploaded. You can also attach one from the Resume section.
                    </EmptyState>
                ) : file && !body && !profile ? (
                    <EmptyState icon={FileText} title="This file's text could not be read">
                        {file.textError ?? TEXT_STATUS_LABELS[file.textStatus]}. Use Open original to see the file itself.
                    </EmptyState>
                ) : (
                    <>
                        <ResumeDocument record={record} text={body} keywords={words} />
                        {file && !body && <p className="mx-auto mt-3 max-w-[860px] text-xs text-text-secondary">The text of {file.fileName} could not be read, so only the details on record are shown. Use Open original to see the file itself.</p>}
                        {!file && <p className="mx-auto mt-3 max-w-[860px] text-xs text-text-secondary">No resume file is linked to this candidate; these details were typed in. Attach a resume from the Resume section.</p>}
                    </>
                )}
            </div>
        </section>
    );
}

type LinkFilter = '' | 'linked' | 'unlinked';

/**
 * The candidate's resume files (owner 2026-11-10, phase 2): matched by email / phone in the background, or attached by
 * HR here. Open shows a PDF in the browser's viewer and a .docx as a page; Detach marks a wrong match so it is never
 * matched again by itself; Attach searches the files not linked to anyone yet. With more than one file, "Read" picks
 * the one shown beside the details.
 */
function ResumeSection({ orgId, candidateId, fullName, files, ready, error, viewingId, onView, onChanged }: {
    orgId: string; candidateId: string; fullName: string; files: ResumeFile[]; ready: boolean; error: string;
    viewingId: string | null; onView: (id: string) => void; onChanged: () => void;
}) {
    const { notify, reportError } = useUi();
    const [picking, setPicking] = useState(false);
    const [q, setQ] = useState(fullName);
    const [qDebounced, setQDebounced] = useState(fullName);
    useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
    const link: LinkFilter = 'unlinked';
    const [searchNonce, setSearchNonce] = useState(0);
    const optionsKey = JSON.stringify([orgId, qDebounced, searchNonce]);
    const [options, setOptions] = useState<{ key: string; files: ResumeFile[] } | null>(null);
    useEffect(() => {
        if (!picking) return;
        const ctrl = new AbortController();
        void api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, link, q: qDebounced, pageSize: 8 })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok && res.noAccess) reportError(res);
            setOptions({ key: optionsKey, files: res.ok ? res.data.files : [] });
        });
        return () => ctrl.abort();
    }, [picking, optionsKey, orgId, qDebounced, reportError]);

    const [busy, setBusy] = useState<string | null>(null);
    const [confirmDetach, setConfirmDetach] = useState<string | null>(null);
    const change = async (file: ResumeFile, target: string | null) => {
        setBusy(file.id);
        const res = await api<{ ok: true }>(`/api/candidates/resumes/${encodeURIComponent(file.id)}`, { method: 'PATCH', json: { orgId, candidateId: target } });
        setBusy(null);
        if (!res.ok) { reportError(res); return; }
        notify(target ? `${file.fileName} attached` : `${file.fileName} detached`, 'success');
        setConfirmDetach(null);
        setPicking(false);
        setSearchNonce(n => n + 1);
        onChanged();
    };

    return (
        <section className="mt-5" aria-labelledby="cand-resumes-heading">
            <div className="flex items-center justify-between gap-x-2 gap-y-2">
                <h3 id="cand-resumes-heading" className={LABEL}>Resume</h3>
                <button type="button" onClick={() => setPicking(p => !p)} className={`${BTN_GHOST} -mr-2.5`}>
                    <Paperclip className="h-4 w-4" />{picking ? 'Cancel' : 'Attach a resume'}
                </button>
            </div>
            {!ready ? (
                <p className="mt-1 text-sm text-text-tertiary"><Spinner className="mr-1.5 inline h-3.5 w-3.5" />Loading</p>
            ) : error ? (
                <p className="mt-1 text-sm text-error">{error}</p>
            ) : files.length === 0 ? (
                <p className="mt-1 text-sm text-text-tertiary">
                    No resume on file. A resume with this person&rsquo;s email or phone is linked by itself once it is uploaded; or attach one here.
                </p>
            ) : (
                <ul className="mt-1.5 space-y-1.5">
                    {files.map(file => (
                        <li key={file.id} className={`${WELL} flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${files.length > 1 && file.id === viewingId ? 'ring-1 ring-inset ring-primary' : ''}`}>
                            <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                            <span className="min-w-0 flex-1">
                                <button type="button" onClick={() => (files.length > 1 ? onView(file.id) : openUrl(orgId, file, true))} className="block max-w-full truncate text-left text-sm font-semibold text-text-primary hover:underline" title={files.length > 1 ? `Read ${file.fileName}` : `Open ${file.fileName}`}>
                                    {file.fileName}
                                </button>
                                <span className="block text-xs text-text-tertiary">
                                    {file.matchReason ? `Matched by ${MATCH_REASON_LABELS[file.matchReason].toLowerCase()}` : TEXT_STATUS_LABELS[file.textStatus]}
                                    {file.downloadedAt && <> · downloaded {formatDate(file.downloadedAt)}</>}
                                </span>
                            </span>
                            <span className="flex items-center gap-0.5">
                                <button type="button" onClick={() => openUrl(orgId, file, true)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Open ${file.fileName}`} title="Open original"><ExternalLink className="h-4 w-4" /></button>
                                <button type="button" onClick={() => openUrl(orgId, file, false)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Download ${file.fileName}`} title="Download"><Download className="h-4 w-4" /></button>
                                {confirmDetach === file.id ? (
                                    <>
                                        <button type="button" onClick={() => void change(file, null)} disabled={busy === file.id} className={`${BTN_GHOST} h-8 px-2 text-error`}>
                                            {busy === file.id ? <Spinner /> : 'Detach'}
                                        </button>
                                        <button type="button" onClick={() => setConfirmDetach(null)} className={`${BTN_GHOST} h-8 px-2`}>Keep</button>
                                    </>
                                ) : (
                                    <button type="button" onClick={() => setConfirmDetach(file.id)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Detach ${file.fileName}`} title="Not this person's resume"><Unlink className="h-4 w-4" /></button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {picking && (
                <div className={`${WELL} mt-2 space-y-2 px-3 py-3`}>
                    <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the resumes not linked to anyone yet" aria-label="Search the resumes not linked to anyone yet" className={`${INPUT} pl-9`} />
                    </label>
                    {!options || options.key !== optionsKey ? (
                        <p className="text-sm text-text-tertiary"><Spinner className="mr-1.5 inline h-3.5 w-3.5" />Searching</p>
                    ) : options.files.length === 0 ? (
                        <p className="text-sm text-text-tertiary">No unlinked resume matches. Try part of the file name, or upload the file in the Resumes tab first.</p>
                    ) : (
                        <ul className="divide-y divide-border-subtle">
                            {options.files.map(file => (
                                <li key={file.id} className="flex items-center gap-x-2 gap-y-2 py-1.5">
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-text-primary" title={file.fileName}>{file.fileName}</span>
                                        <span className="block text-xs text-text-tertiary">{TEXT_STATUS_LABELS[file.textStatus]}{file.downloadedAt && <> · downloaded {formatDate(file.downloadedAt)}</>}</span>
                                    </span>
                                    <button type="button" onClick={() => openUrl(orgId, file, true)} className={`${BTN_GHOST} h-8 px-2`}>View</button>
                                    <button type="button" onClick={() => void change(file, candidateId)} disabled={busy === file.id} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
                                        {busy === file.id ? <Spinner /> : 'Attach'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}
