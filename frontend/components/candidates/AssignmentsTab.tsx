'use client';

import React, { useEffect, useState } from 'react';
import { FileCheck2, FileText, Link2, Send, Sparkles } from 'lucide-react';
import type { AssignmentView, DocumentView } from '@/backend/lib/candidates/assignments';
import type { OutreachSettings } from '@/backend/lib/candidates/outreach-settings';
import type { ScreeningView } from '@/backend/lib/candidates/screening';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The assignment stage and the documents (owner 2026-11-24, 23 Nov HR meeting). HR sends an assignment (from the
 * department's ready-made ones, or written fresh) with a deadline and a Drive link; the candidate submits through
 * their own link; the AI score against the JD shows here (HR only). After selection, "Ask for documents" sends the
 * documents link; each file comes back here to verify or reject.
 */

const STATUS: Record<AssignmentView['status'], { label: string; tone: 'info' | 'success' | 'neutral' }> = {
    sent: { label: 'Waiting', tone: 'info' }, submitted: { label: 'Submitted', tone: 'success' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const DOC: Record<DocumentView['status'], { label: string; tone: 'info' | 'success' | 'warn' }> = {
    uploaded: { label: 'To check', tone: 'info' }, verified: { label: 'Verified', tone: 'success' }, rejected: { label: 'Rejected', tone: 'warn' },
};
const scoreTone = (n: number) => (n >= 80 ? 'text-success' : n >= 60 ? 'text-text-primary' : n >= 40 ? 'text-warning' : 'text-danger');
const inDays = (d: number) => { const t = new Date(Date.now() + d * 86_400_000); t.setHours(18, 0, 0, 0); return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export default function AssignmentsTab({ orgId, record, onChanged }: { orgId: string; record: CandidateRecord; onChanged?: () => void }) {
    const { notify } = useUi();
    const [data, setData] = useState<{ id: string; assignments: AssignmentView[]; documents: DocumentView[] } | null>(null);
    const [positions, setPositions] = useState<ScreeningView[]>([]);
    const [settings, setSettings] = useState<OutreachSettings | null>(null);
    const [nonce, setNonce] = useState(0);
    const [composing, setComposing] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ assignments: AssignmentView[]; documents: DocumentView[] }>(`/api/candidates/assignments${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setData({ id: record.candidateId, ...res.data });
        });
        return () => ctrl.abort();
    }, [orgId, record.candidateId, nonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ views: ScreeningView[] }>(`/api/candidates/screening${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setPositions(res.data.views); });
        void api<{ settings: OutreachSettings }>(`/api/candidates/outreach/settings${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setSettings(res.data.settings); });
        return () => ctrl.abort();
    }, [orgId, record.candidateId]);

    const d = data?.id === record.candidateId ? data : null;
    const act = async (key: string, json: Record<string, unknown>, done?: string) => {
        setBusy(key);
        const res = await api<{ url?: string; sent?: boolean; note?: string | null }>('/api/candidates/assignments', { json: { orgId, ...json } });
        setBusy(null);
        if (!res.ok) { notify(res.error, 'error'); return null; }
        if (done) notify(done, 'success');
        setNonce(n => n + 1);
        onChanged?.();
        return res.data;
    };
    const open = async (key: string, json: Record<string, unknown>) => {
        const r = await act(key, json);
        if (r?.url) window.open(r.url, '_blank', 'noopener,noreferrer');
    };
    const copyLink = async (id: string) => {
        const r = await act(`link-${id}`, { action: 'link', id });
        if (r?.url) { await navigator.clipboard.writeText(r.url).catch(() => undefined); notify('The candidate\'s link is copied', 'success'); }
    };
    const askDocuments = async () => {
        const r = await act('docs', { action: 'request_documents', applicationId: record.id, positionId: positions[0]?.positionId ?? null });
        if (!r) return;
        if (r.sent) notify('Documents link sent on WhatsApp', 'success');
        else {
            if (r.url) await navigator.clipboard.writeText(r.url).catch(() => undefined);
            notify(`${r.note ?? 'The WhatsApp did not go.'} The link is copied: share it yourself.`, 'info');
        }
    };

    if (!d) return <div className="flex justify-center py-8"><Spinner /></div>;
    return (
        <div className="space-y-4">
            <section className={`${WELL} space-y-3 px-4 py-3`} aria-label="Assignments">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-text-secondary" aria-hidden />
                    <h3 className="text-sm font-semibold text-text-primary">Assignments</h3>
                    <button type="button" disabled={!positions.length} title={positions.length ? undefined : 'Add the person to a position first'} onClick={() => setComposing(true)} className={`${BTN_SECONDARY} ml-auto h-8`}><Send className="h-3.5 w-3.5" />Send an assignment</button>
                </div>
                {!d.assignments.length && <p className="text-sm text-text-secondary">No assignment sent yet.</p>}
                {d.assignments.map(a => (
                    <article key={a.id} className="space-y-2 rounded-lg border border-border px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-text-primary">{a.title}</span>
                            <Tag tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Tag>
                            {a.late && <Tag tone="warn">{a.status === 'sent' ? 'Past the deadline' : 'Submitted late'}</Tag>}
                            <span className="text-xs text-text-tertiary">{a.positionTitle}</span>
                        </div>
                        <p className="text-xs text-text-tertiary">Sent {formatDate(a.sentAt)}{a.sentBy ? ` by ${a.sentBy}` : ''}{a.dueAt ? ` · due ${formatDate(a.dueAt)}` : ''}{a.submittedAt ? ` · submitted ${formatDate(a.submittedAt)}` : ''}</p>
                        {a.sendError && a.status === 'sent' && <p className="text-xs text-warning">The WhatsApp did not go: {a.sendError}</p>}
                        {a.status === 'submitted' && (
                            <div className="space-y-1 text-sm">
                                {a.submissionLink && <p><a href={a.submissionLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline"><Link2 className="h-3.5 w-3.5" />Their link</a></p>}
                                {a.submissionNote && <p className="whitespace-pre-wrap text-text-secondary">{a.submissionNote}</p>}
                                {a.hasFile && <button type="button" onClick={() => void open(`file-${a.id}`, { action: 'file', id: a.id })} disabled={busy === `file-${a.id}`} className={`${BTN_GHOST} h-7 px-0`}>{busy === `file-${a.id}` ? <Spinner /> : <FileText className="h-3.5 w-3.5" />}Open {a.fileName ?? 'the file'}</button>}
                            </div>
                        )}
                        {a.ai && a.status === 'submitted' && (
                            <div className="rounded-lg bg-surface px-3 py-2 text-sm">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary"><Sparkles className="h-3.5 w-3.5" />AI score against the JD (HR only; the hiring manager does not see it)</p>
                                {a.ai.status === 'scored' && a.ai.score !== null ? (
                                    <>
                                        <p className={`mt-1 text-2xl font-bold tabular-nums ${scoreTone(a.ai.score)}`}>{a.ai.score}<span className="text-sm font-normal text-text-tertiary">/100</span></p>
                                        {a.ai.summary && <p className="text-text-secondary">{a.ai.summary}</p>}
                                        {!!a.ai.strengths.length && <p className="mt-1"><span className="font-semibold">Strengths: </span>{a.ai.strengths.join(' · ')}</p>}
                                        {!!a.ai.gaps.length && <p><span className="font-semibold">Gaps: </span>{a.ai.gaps.join(' · ')}</p>}
                                        <p className="mt-1 text-xs text-text-tertiary">Advice only: you decide. {a.ai.model ? `Model: ${a.ai.model}` : ''}</p>
                                    </>
                                ) : a.ai.status === 'pending' ? <p className="mt-1 text-text-secondary">Scoring… open this tab again in a minute.</p> : (
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <p className="text-text-secondary">{a.ai.error ?? 'Not scored.'}</p>
                                        {a.ai.status === 'failed' && <button type="button" onClick={() => void act(`rescore-${a.id}`, { action: 'rescore', id: a.id }, 'Scoring again')} className={`${BTN_GHOST} h-7`}>Try again</button>}
                                    </div>
                                )}
                            </div>
                        )}
                        {a.status === 'sent' && (
                            <div className="flex gap-2">
                                <button type="button" onClick={() => void copyLink(a.id)} className={`${BTN_GHOST} h-7`}>{busy === `link-${a.id}` ? <Spinner /> : <Link2 className="h-3.5 w-3.5" />}Copy their link</button>
                                <button type="button" onClick={() => void act(`cancel-${a.id}`, { action: 'cancel', id: a.id }, 'Assignment cancelled')} className={`${BTN_GHOST} h-7`}>Cancel</button>
                            </div>
                        )}
                    </article>
                ))}
            </section>

            <section className={`${WELL} space-y-3 px-4 py-3`} aria-label="Documents">
                <div className="flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-text-secondary" aria-hidden />
                    <h3 className="text-sm font-semibold text-text-primary">Documents</h3>
                    <button type="button" onClick={() => void askDocuments()} disabled={busy === 'docs'} className={`${BTN_SECONDARY} ml-auto h-8`}>{busy === 'docs' ? <Spinner /> : <Send className="h-3.5 w-3.5" />}Ask for documents</button>
                </div>
                {settings && <p className="text-xs text-text-tertiary">Asks for: {settings.documents.items.join(', ')}. Change the list in Recruitment → Outreach → Documents.</p>}
                {!d.documents.length && <p className="text-sm text-text-secondary">Nothing uploaded yet.</p>}
                {d.documents.map(doc => (
                    <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                        <span className="font-semibold text-text-primary">{doc.item}</span>
                        <Tag tone={DOC[doc.status].tone}>{DOC[doc.status].label}</Tag>
                        <span className="text-xs text-text-tertiary">{formatDate(doc.uploadedAt)}{doc.reviewedBy ? ` · ${doc.reviewedBy}` : ''}</span>
                        {doc.reviewNote && <span className="w-full text-xs text-text-secondary">{doc.reviewNote}</span>}
                        <div className="ml-auto flex gap-1">
                            <button type="button" onClick={() => void open(`doc-${doc.id}`, { action: 'document_file', id: doc.id })} className={`${BTN_GHOST} h-7`}>{busy === `doc-${doc.id}` ? <Spinner /> : null}Open</button>
                            {doc.status !== 'verified' && <button type="button" onClick={() => void act(`v-${doc.id}`, { action: 'review_document', id: doc.id, status: 'verified' }, 'Marked verified')} className={`${BTN_GHOST} h-7`}>Verify</button>}
                            {doc.status !== 'rejected' && <button type="button" onClick={() => setRejecting({ id: doc.id, note: '' })} className={`${BTN_GHOST} h-7`}>Reject</button>}
                        </div>
                    </div>
                ))}
            </section>

            {composing && settings && <AssignmentComposer orgId={orgId} record={record} positions={positions} settings={settings} onClose={() => setComposing(false)} onSent={() => { setComposing(false); setNonce(n => n + 1); onChanged?.(); }} />}
            <Dialog open={Boolean(rejecting)} onClose={() => setRejecting(null)} title="Reject this document" labelId="reject-doc" size="sm"
                footer={<button type="button" disabled={!rejecting?.note.trim()} onClick={() => { if (rejecting) void act(`r-${rejecting.id}`, { action: 'review_document', id: rejecting.id, status: 'rejected', note: rejecting.note }, 'Marked rejected').then(() => setRejecting(null)); }} className={BTN_PRIMARY}>Reject</button>}>
                <label className={LABEL} htmlFor="reject-note">Why (the candidate will need to upload it again)</label>
                <textarea id="reject-note" rows={3} className={`${INPUT} mt-1`} value={rejecting?.note ?? ''} onChange={e => setRejecting(r => (r ? { ...r, note: e.target.value } : r))} maxLength={500} />
            </Dialog>
        </div>
    );
}

function AssignmentComposer({ orgId, record, positions, settings, onClose, onSent }: { orgId: string; record: CandidateRecord; positions: ScreeningView[]; settings: OutreachSettings; onClose: () => void; onSent: () => void }) {
    const { notify } = useUi();
    const [positionId, setPositionId] = useState(positions[0]?.positionId ?? '');
    const [draft, setDraft] = useState({ title: '', brief: '', guidelines: '', driveLink: '', due: inDays(settings.assignment.defaultDueDays) });
    const [busy, setBusy] = useState(false);
    const library = settings.assignment.library;
    const use = (id: string) => {
        const t = library.find(x => x.id === id);
        if (t) setDraft({ title: t.title, brief: t.brief, guidelines: t.guidelines, driveLink: t.driveLink, due: inDays(t.dueDays || settings.assignment.defaultDueDays) });
    };
    const send = async () => {
        setBusy(true);
        const res = await api<{ sent: boolean; note: string | null }>('/api/candidates/assignments', { json: { orgId, action: 'send', applicationId: record.id, positionId, title: draft.title, brief: draft.brief, guidelines: draft.guidelines, driveLink: draft.driveLink, dueAt: draft.due ? new Date(draft.due).toISOString() : null } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(res.data.sent ? 'Assignment sent on WhatsApp; the stakeholders are told' : (res.data.note ?? 'Saved, but not sent'), res.data.sent ? 'success' : 'info');
        onSent();
    };
    const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(x => ({ ...x, [k]: e.target.value }));
    return (
        <Dialog open onClose={onClose} title="Send an assignment" labelId="send-assignment" size="lg"
            description="The candidate gets a WhatsApp with their own link: the brief, your Drive link and the deadline, and where to submit."
            footer={<button type="button" onClick={() => void send()} disabled={busy || !draft.title.trim() || !draft.brief.trim() || !positionId} className={BTN_PRIMARY}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}Send</button>}>
            <div className="space-y-3">
                {positions.length > 1 && (
                    <div><label className={LABEL} htmlFor="as-pos">Position</label>
                        <select id="as-pos" className={`${INPUT} mt-1`} value={positionId} onChange={e => setPositionId(e.target.value)}>{positions.map(p => <option key={p.positionId} value={p.positionId}>{p.positionTitle}</option>)}</select></div>
                )}
                {!!library.length && (
                    <div><label className={LABEL} htmlFor="as-lib">Start from a ready-made assignment</label>
                        <select id="as-lib" className={`${INPUT} mt-1`} defaultValue="" onChange={e => use(e.target.value)}>
                            <option value="">Write a new one…</option>
                            {library.map(t => <option key={t.id} value={t.id}>{t.department ? `${t.department}: ` : ''}{t.name}</option>)}
                        </select></div>
                )}
                <div><label className={LABEL} htmlFor="as-title">Title</label><input id="as-title" className={`${INPUT} mt-1`} value={draft.title} onChange={set('title')} maxLength={200} /></div>
                <div><label className={LABEL} htmlFor="as-brief">The brief</label><textarea id="as-brief" rows={5} className={`${INPUT} mt-1`} value={draft.brief} onChange={set('brief')} maxLength={8000} /></div>
                <div><label className={LABEL} htmlFor="as-guide">Guidelines (optional)</label><textarea id="as-guide" rows={3} className={`${INPUT} mt-1`} value={draft.guidelines} onChange={set('guidelines')} maxLength={4000} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={LABEL} htmlFor="as-drive">Drive link (optional)</label><input id="as-drive" className={`${INPUT} mt-1`} value={draft.driveLink} onChange={set('driveLink')} placeholder="https://drive.google.com/…" /></div>
                    <div><label className={LABEL} htmlFor="as-due">Deadline</label><input id="as-due" type="datetime-local" className={`${INPUT} mt-1`} value={draft.due} onChange={set('due')} /></div>
                </div>
            </div>
        </Dialog>
    );
}
