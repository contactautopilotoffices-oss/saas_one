'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, FileUp, FolderPlus, History, Search, Trash2 } from 'lucide-react';
import type { JdDetail, JdSummary } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_DANGER_FILLED } from './Remarks';
import { BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, EmptyState, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The JD library (owner 2026-11-17; Stage 3 of the Recruitment Module spec). One job description per role, every
 * saved text kept as a numbered version (never edited, never lost), copies for similar roles, and "Open a position"
 * from any JD: the position form is filled from it by the same reader as a pasted JD, and the position remembers
 * which version it came from.
 */

/** What "Open a position from this JD" hands to the Positions view. */
export interface JdPick { jdId: string; version: number; title: string; content: string; fileName: string | null }

const JD_FILE_TYPES = '.pdf,.docx,.txt,.md';

export default function JdLibrary({ orgId, onUse }: { orgId: string; onUse: (pick: JdPick) => void }) {
    const { notify, reportError } = useUi();
    const [jds, setJds] = useState<JdSummary[] | null>(null);
    const [q, setQ] = useState('');
    const [nonce, setNonce] = useState(0);
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ jds: JdSummary[] }>(`/api/candidates/jds${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); else notify(res.error, 'error'); setJds([]); return; }
            setJds(res.data.jds);
        });
        return () => ctrl.abort();
    }, [orgId, nonce, reportError, notify]);
    const refresh = () => setNonce(n => n + 1);
    const needle = q.trim().toLowerCase();
    const shown = (jds ?? []).filter(j => !needle || `${j.title} ${j.department ?? ''} ${j.preview}`.toLowerCase().includes(needle));

    return (
        <section className={`${CARD} overflow-hidden`} aria-label="JD library">
            <JdDialog orgId={orgId} jdId={openId} onClose={() => setOpenId(null)} onChanged={refresh} onOpened={id => setOpenId(id)} onUse={pick => { setOpenId(null); onUse(pick); }} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
                <h2 className="flex items-center gap-x-2 font-display text-base font-semibold text-text-primary"><BookOpen className="h-4 w-4 text-primary-dark" aria-hidden />JD library</h2>
                <label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-sm">
                    <span className="sr-only">Find a JD</span>
                    <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Role, department or a word in the JD" className={`${INPUT} h-9 pl-9 text-sm`} />
                </label>
                <button type="button" onClick={() => setAdding(a => !a)} aria-expanded={adding} className={`${BTN_PRIMARY} ml-auto`}><FolderPlus className="h-4 w-4" />Add a JD</button>
            </div>
            {adding && <AddJd orgId={orgId} onCancel={() => setAdding(false)} onSaved={jd => { setAdding(false); refresh(); setOpenId(jd.id); }} />}

            {jds === null ? (
                <p className="flex items-center gap-x-2 px-4 py-6 text-sm text-text-tertiary sm:px-6"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : shown.length === 0 ? (
                <EmptyState icon={BookOpen} title={jds.length ? 'No JD matches that' : 'The library is empty'}>
                    {jds.length ? 'Try another word.' : 'Add a JD here, or tick "Save this JD to the library" when you save a position. Each role’s JD is then picked from here, and every edit is kept as a version.'}
                </EmptyState>
            ) : (
                <ul className="divide-y divide-border-subtle">
                    {shown.map(j => (
                        <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
                            <button type="button" onClick={() => setOpenId(j.id)} className="min-w-0 flex-1 basis-80 text-left">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-display text-[15px] font-semibold text-text-primary hover:underline">{j.title}</span>
                                    <Tag tone="info">v{j.currentVersion}</Tag>
                                    {j.department && <span className="text-xs text-text-secondary">{j.department}</span>}
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-text-secondary" title={j.preview}>{j.preview}</span>
                                <span className="mt-0.5 block text-xs text-text-tertiary">
                                    {[`edited ${formatDate(j.updatedAt)}${j.updatedByName ? ` by ${j.updatedByName}` : ''}`, j.positions ? `${j.positions} ${j.positions === 1 ? 'position' : 'positions'}` : 'not used yet', j.lastUsedAt ? `last used ${formatDate(j.lastUsedAt)}` : null].filter(Boolean).join(' · ')}
                                </span>
                            </button>
                            <span className="flex shrink-0 items-center gap-x-1">
                                <button type="button" onClick={() => setOpenId(j.id)} className={BTN_GHOST}><History className="h-4 w-4" />Open</button>
                                <UseButton orgId={orgId} jd={j} onUse={onUse} />
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/** "Open a position" from the list: the current version's text is fetched, then handed over. */
function UseButton({ orgId, jd, onUse }: { orgId: string; jd: JdSummary; onUse: (pick: JdPick) => void }) {
    const { notify, reportError } = useUi();
    const [busy, setBusy] = useState(false);
    const use = async () => {
        setBusy(true);
        const res = await api<{ jd: JdDetail }>(`/api/candidates/jds/${encodeURIComponent(jd.id)}${qs({ orgId })}`);
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        const v = res.data.jd.versions.find(x => x.version === res.data.jd.currentVersion) ?? res.data.jd.versions[0];
        if (!v) { notify('That JD has no text yet.', 'error'); return; }
        onUse({ jdId: jd.id, version: v.version, title: res.data.jd.title, content: v.content, fileName: v.fileName });
    };
    return <button type="button" onClick={() => void use()} disabled={busy} className={BTN_SECONDARY}>{busy ? <Spinner /> : <FolderPlus className="h-4 w-4" />}Open a position</button>;
}

/** A new JD: the role, the department, and the text pasted or read from a file. */
function AddJd({ orgId, onCancel, onSaved }: { orgId: string; onCancel: () => void; onSaved: (jd: JdDetail) => void }) {
    const { notify, reportError } = useUi();
    const [title, setTitle] = useState('');
    const [department, setDepartment] = useState('');
    const [content, setContent] = useState('');
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const save = async (file?: File) => {
        if (!title.trim()) { notify('Give the JD a title (the role) first.', 'error'); return; }
        setBusy(true);
        let res;
        if (file) {
            const form = new FormData();
            form.set('orgId', orgId); form.set('title', title.trim()); form.set('department', department.trim()); form.set('file', file, file.name);
            res = await api<{ jd: JdDetail }>('/api/candidates/jds', { form });
        } else {
            res = await api<{ jd: JdDetail }>('/api/candidates/jds', { json: { orgId, title: title.trim(), department: department.trim() || null, content } });
        }
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`${res.data.jd.title} added to the library as v1`, 'success');
        onSaved(res.data.jd);
    };
    return (
        <div className={`${WELL} mx-4 mb-3 space-y-3 px-4 py-4 sm:mx-6`}>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-text-secondary">Role (title) <span className="text-error">*</span>
                    <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Senior Technical Executive" className={`${INPUT} mt-1`} autoFocus />
                </label>
                <label className="block text-xs font-medium text-text-secondary">Department
                    <input value={department} onChange={e => setDepartment(e.target.value)} maxLength={80} placeholder="e.g. Facilities" className={`${INPUT} mt-1`} />
                </label>
            </div>
            <label className="block text-xs font-medium text-text-secondary">Job description
                <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} maxLength={20000} placeholder="Paste the JD here, or upload the file" className={`${INPUT} mt-1 h-auto min-h-[120px] resize-y py-2.5 leading-relaxed`} />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <input ref={fileRef} type="file" accept={JD_FILE_TYPES} className="sr-only" aria-label="Upload a JD file" onChange={e => { const f = e.target.files?.[0]; if (f) void save(f); }} />
                <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !title.trim()} className={BTN_SECONDARY} title={title.trim() ? 'PDF, Word or text' : 'Type the role first'}><FileUp className="h-4 w-4" />Upload a file instead</button>
                <button type="button" onClick={() => void save()} disabled={busy || !title.trim() || content.trim().length < 40} className={BTN_PRIMARY}>{busy && <Spinner />}Save to the library</button>
            </div>
        </div>
    );
}

/** One JD: its text and every version, edit (a changed text becomes the next version), copy, delete, open a position. */
function JdDialog({ orgId, jdId, onClose, onChanged, onOpened, onUse }: {
    orgId: string; jdId: string | null; onClose: () => void; onChanged: () => void; onOpened: (id: string) => void; onUse: (pick: JdPick) => void;
}) {
    const { notify, reportError } = useUi();
    const [jd, setJd] = useState<JdDetail | null>(null);
    const [viewing, setViewing] = useState<number | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState({ title: '', department: '', content: '', note: '' });
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => {
        if (!jdId) return;
        const ctrl = new AbortController();
        void api<{ jd: JdDetail }>(`/api/candidates/jds/${encodeURIComponent(jdId)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
            setJd(res.data.jd); setViewing(null); setEditing(false); setConfirmDelete(false);
        });
        return () => ctrl.abort();
    }, [jdId, orgId, notify, reportError]);
    const shown = jd && jd.id === jdId ? jd : null;
    const current = shown?.versions.find(v => v.version === shown.currentVersion) ?? shown?.versions[0] ?? null;
    const version = shown && viewing !== null ? shown.versions.find(v => v.version === viewing) ?? current : current;

    const startEdit = (content?: string) => {
        if (!shown || !current) return;
        setDraft({ title: shown.title, department: shown.department ?? '', content: content ?? current.content, note: content ? `Restored from v${viewing}` : '' });
        setEditing(true);
    };
    const save = async () => {
        if (!shown) return;
        setBusy(true);
        const res = await api<{ jd: JdDetail }>(`/api/candidates/jds/${encodeURIComponent(shown.id)}`, { method: 'PATCH', json: { orgId, title: draft.title.trim(), department: draft.department.trim() || null, content: draft.content, note: draft.note.trim() || null } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(res.data.jd.currentVersion > shown.currentVersion ? `Saved as v${res.data.jd.currentVersion}; earlier versions are kept` : 'Saved (the text did not change, so no new version)', 'success');
        setJd(res.data.jd); setEditing(false); setViewing(null);
        onChanged();
    };
    const duplicate = async () => {
        if (!shown) return;
        setBusy(true);
        const res = await api<{ jd: JdDetail }>(`/api/candidates/jds/${encodeURIComponent(shown.id)}/duplicate`, { json: { orgId } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`Copied as ${res.data.jd.title}. Rename it and edit the text.`, 'success');
        onChanged();
        onOpened(res.data.jd.id);
    };
    const remove = async () => {
        if (!shown) return;
        setBusy(true);
        const res = await api<{ ok: true }>(`/api/candidates/jds/${encodeURIComponent(shown.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`${shown.title} taken out of the library`, 'success');
        onChanged();
        onClose();
    };

    return (
        <Dialog
            open={!!jdId} onClose={() => { if (!busy) onClose(); }} labelId="cand-jd-title" size="xl"
            title={shown ? shown.title : 'JD'}
            description={shown ? [shown.department, `v${shown.currentVersion} current`, `${shown.versions.length} ${shown.versions.length === 1 ? 'version' : 'versions'} kept`].filter(Boolean).join(' · ') : undefined}
            footer={shown ? (editing ? <>
                <button type="button" onClick={() => setEditing(false)} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !draft.title.trim() || draft.content.trim().length < 40} className={BTN_PRIMARY}>{busy && <Spinner />}Save</button>
            </> : confirmDelete ? <>
                <span className="mr-auto text-sm text-text-secondary">Take it out of the library? Its versions and the positions opened from it stay.</span>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className={BTN_SECONDARY}>Keep</button>
                <button type="button" onClick={() => void remove()} disabled={busy} className={BTN_DANGER_FILLED}>{busy ? <Spinner /> : <Trash2 className="h-4 w-4" />}Delete</button>
            </> : <>
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className={`${BTN_DANGER_GHOST} mr-auto`}><Trash2 className="h-4 w-4" />Delete</button>
                <button type="button" onClick={() => void duplicate()} disabled={busy} className={BTN_GHOST}><Copy className="h-4 w-4" />Duplicate</button>
                <button type="button" onClick={() => startEdit()} disabled={busy} className={BTN_SECONDARY}>Edit</button>
                {current && <button type="button" onClick={() => onUse({ jdId: shown.id, version: version?.version ?? current.version, title: shown.title, content: (version ?? current).content, fileName: (version ?? current).fileName })} disabled={busy} className={BTN_PRIMARY}><FolderPlus className="h-4 w-4" />Open a position from v{version?.version ?? current.version}</button>}
            </>) : undefined}
        >
            {!shown ? (
                <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : editing ? (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-xs font-medium text-text-secondary">Role (title)
                            <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} maxLength={120} className={`${INPUT} mt-1`} />
                        </label>
                        <label className="block text-xs font-medium text-text-secondary">Department
                            <input value={draft.department} onChange={e => setDraft(d => ({ ...d, department: e.target.value }))} maxLength={80} className={`${INPUT} mt-1`} />
                        </label>
                    </div>
                    <label className="block text-xs font-medium text-text-secondary">Job description
                        <textarea value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} rows={14} maxLength={20000} className={`${INPUT} mt-1 h-auto min-h-[260px] resize-y py-2.5 leading-relaxed`} />
                    </label>
                    <label className="block text-xs font-medium text-text-secondary">What changed (optional)
                        <input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} maxLength={200} placeholder="e.g. Licence requirement added" className={`${INPUT} mt-1`} />
                    </label>
                    <p className="text-xs text-text-tertiary">A changed text is saved as v{shown.currentVersion + 1}. v{shown.currentVersion} and every earlier version stay as they are.</p>
                </div>
            ) : (
                <div className="grid gap-4 @container md:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="min-w-0">
                        {version && version.version !== shown.currentVersion && (
                            <div role="status" className={`${WELL} mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm`}>
                                <span className="min-w-0 flex-1 text-text-primary">You are reading <strong>v{version.version}</strong>, an earlier version. v{shown.currentVersion} is current.</span>
                                <button type="button" onClick={() => startEdit(version.content)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>Restore as v{shown.currentVersion + 1}</button>
                            </div>
                        )}
                        <pre className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-elevated px-4 py-3 font-body text-sm leading-relaxed text-text-primary">{version?.content ?? ''}</pre>
                    </div>
                    <aside className="space-y-4">
                        <div>
                            <p className={LABEL}>Versions</p>
                            <ol className="mt-1.5 space-y-1">
                                {shown.versions.map(v => (
                                    <li key={v.version}>
                                        <button type="button" onClick={() => setViewing(v.version === shown.currentVersion ? null : v.version)} aria-pressed={(version?.version ?? 0) === v.version}
                                            className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs ${(version?.version ?? 0) === v.version ? 'bg-surface-elevated ring-1 ring-inset ring-primary' : 'hover:bg-surface-elevated'}`}>
                                            <span className="font-semibold text-text-primary">v{v.version}{v.version === shown.currentVersion ? ' · current' : ''}</span>
                                            <span className="block text-text-secondary">{formatDate(v.at)}{v.byName ? ` · ${v.byName}` : ''}</span>
                                            {v.note && <span className="block italic text-text-tertiary">{v.note}</span>}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </div>
                        <div>
                            <p className={LABEL}>Positions opened from it</p>
                            {shown.usedBy.length === 0 ? <p className="mt-1 text-xs text-text-tertiary">None yet.</p> : (
                                <ul className="mt-1 space-y-1 text-xs">
                                    {shown.usedBy.map(u => (
                                        <li key={u.positionId} className="text-text-primary">{u.title} <span className="text-text-secondary">· v{u.version}{u.status === 'closed' ? ' · closed' : ''}</span></li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </Dialog>
    );
}
