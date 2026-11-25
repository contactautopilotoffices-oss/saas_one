'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, FileText, Inbox, Link2, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { ApplicationEntry } from '@/backend/lib/candidates/applications';
import type { CampaignSendEntry, CampaignSummary } from '@/backend/lib/candidates/outreach-campaigns';
import {
    APPLICATION_FIELD_TYPES, REQUIRED_TARGETS,
    type ApplicationField, type ApplicationTarget, type OutreachSettings, type OutreachTemplate, type Placeholder,
} from '@/backend/lib/candidates/outreach-settings';
import type { Position } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { Drawer, Spinner, useUi } from './ui';
import {
    EmptyBlock, K_AREA, K_BTN, K_BTN_GHOST, K_BTN_GHOST_DANGER, K_BTN_PRIMARY, K_CARD, K_FIELD, K_ICON_BTN, K_ICON_BTN_DANGER, K_LABEL, K_WELL,
    Loading, PageHeader, type PillTone, Segmented, SelectPill, StatusPill,
} from './page-kit';

/*
 * Recruitment → Outreach (owner 2026-11-24, from the 23 Nov HR meeting): bulk and automatic outreach and the job
 * application form, all HR's to configure ("keep it configurable"):
 *   Sends            : every bulk or automatic send, with each person's result.
 *   Applications     : the forms candidates submitted; a position's link for job postings.
 *   Application form : the questions (and where each answer goes on the record).
 *   Templates        : the WhatsApp (Meta-approved, through AiSensy) and email messages, with placeholders.
 *   Automatic        : what happens when a hiring request is approved.
 */

type Section = 'sends' | 'applications' | 'form' | 'screening' | 'offer' | 'templates' | 'auto';
const SECTIONS: { id: Section; label: string }[] = [
    { id: 'sends', label: 'Sends' }, { id: 'applications', label: 'Applications' }, { id: 'form', label: 'Application form' },
    { id: 'screening', label: 'Screening & interviews' }, { id: 'offer', label: 'Assignment & offer' }, { id: 'templates', label: 'Templates' }, { id: 'auto', label: 'Automatic' },
];
const TYPE_LABELS: Record<ApplicationField['type'], string> = { text: 'Short answer', textarea: 'Paragraph', number: 'Number', email: 'Email', phone: 'Mobile number', select: 'Choice', date: 'Date', file: 'File (resume)' };
const STATUS_TONE: Record<CampaignSummary['status'], PillTone> = { queued: 'amber', sending: 'blue', done: 'green', cancelled: 'grey' };
const SEND_TONE: Record<CampaignSendEntry['status'], PillTone> = { queued: 'amber', sending: 'blue', sent: 'green', failed: 'red', unknown: 'amber', skipped: 'grey' };
const INPUT = `${K_FIELD} w-full`;
const CHECK = 'h-4 w-4 accent-primary';
const H = 'text-[15px] font-semibold text-text-primary';

interface SettingsResponse { settings: OutreachSettings; placeholders: Record<Placeholder, string>; targets: Record<ApplicationTarget, string> }

export default function OutreachView({ orgId }: { orgId: string }) {
    const [section, setSection] = useState<Section>('sends');
    return (
        <div className="space-y-5">
            <PageHeader title="Outreach" sub="Bulk and automatic sends, applications, the application form and the message templates" />
            <Segmented label="Outreach sections" value={section} onChange={setSection} options={SECTIONS.map(x => ({ value: x.id, label: x.label }))} />
            {section === 'sends' && <SendsPanel orgId={orgId} />}
            {section === 'applications' && <ApplicationsPanel orgId={orgId} />}
            {(section === 'form' || section === 'screening' || section === 'offer' || section === 'templates' || section === 'auto') && <SettingsPanel orgId={orgId} section={section} />}
        </div>
    );
}

// Sends ----------------------------------------------------------------------------------------------------------------

function SendsPanel({ orgId }: { orgId: string }) {
    const { notify } = useUi();
    const [list, setList] = useState<CampaignSummary[] | null>(null);
    const [nonce, setNonce] = useState(0);
    const [openId, setOpenId] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ campaigns: CampaignSummary[] }>(`/api/candidates/outreach/campaigns${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); setList([]); return; }
            setList(res.data.campaigns);
        });
        return () => ctrl.abort();
    }, [orgId, nonce, notify]);
    return (
        <section className={`${K_CARD} overflow-hidden`} aria-label="Sends">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
                <div className="min-w-0">
                    <h2 className={H}>Sends{list ? <span className="ml-2 text-sm font-normal tabular-nums text-text-tertiary">{list.length}</span> : null}</h2>
                    <p className="text-sm text-text-tertiary">Start one from Search: tick the candidates, then <span className="font-semibold text-text-secondary">Send message</span>.</p>
                </div>
                <button type="button" onClick={() => setNonce(n => n + 1)} className={`${K_BTN} ml-auto`}><RotateCcw className="h-4 w-4" aria-hidden />Refresh</button>
            </div>
            {!list ? <div className="px-5"><Loading /></div>
                : !list.length ? <EmptyBlock icon={Send} title="Nothing sent yet">Bulk WhatsApp and email sends, and the automatic ones after a hiring request is approved, appear here.</EmptyBlock>
                    : (
                        <ul className="divide-y divide-border">
                            {list.map(c => (
                                <li key={c.id}>
                                    <button type="button" onClick={() => setOpenId(c.id)} className="flex min-h-[52px] w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-5">
                                        <span className="min-w-0 flex-1 basis-64">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold text-text-primary">{c.positionTitle ?? 'No position'}</span>
                                                <StatusPill tone={STATUS_TONE[c.status]}>{c.status === 'sending' ? 'Sending' : c.status === 'queued' ? 'Queued' : c.status === 'done' ? 'Done' : 'Stopped'}</StatusPill>
                                                {c.source === 'auto' && <StatusPill tone="teal">Automatic</StatusPill>}
                                            </span>
                                            <span className="block text-xs text-text-tertiary">{[c.whatsappTemplateName && `WhatsApp: ${c.whatsappTemplateName}`, c.emailTemplateName && `Email: ${c.emailTemplateName}`, `${c.total} ${c.total === 1 ? 'person' : 'people'}`, c.createdByName, formatDate(c.createdAt)].filter(Boolean).join(' · ')}</span>
                                        </span>
                                        <span className="text-sm tabular-nums text-text-secondary"><span className="font-semibold text-emerald-700 dark:text-emerald-400">{c.counts.sent}</span> sent{c.counts.failed + c.counts.unknown ? <> · <span className="font-semibold text-red-700 dark:text-red-400">{c.counts.failed + c.counts.unknown}</span> failed</> : null}{c.counts.skipped ? ` · ${c.counts.skipped} skipped` : ''}{c.counts.queued + c.counts.sending ? ` · ${c.counts.queued + c.counts.sending} waiting` : ''}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
            <CampaignDrawer orgId={orgId} id={openId} onClose={() => setOpenId(null)} onChanged={() => setNonce(n => n + 1)} />
        </section>
    );
}

function CampaignDrawer({ orgId, id, onClose, onChanged }: { orgId: string; id: string | null; onClose: () => void; onChanged: () => void }) {
    const { notify } = useUi();
    const [state, setState] = useState<{ campaign: CampaignSummary; sends: CampaignSendEntry[] } | null>(null);
    const [nonce, setNonce] = useState(0);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!id) return;
        const ctrl = new AbortController();
        void api<{ campaign: CampaignSummary; sends: CampaignSendEntry[] }>(`/api/candidates/outreach/campaigns/${encodeURIComponent(id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setState(res.data);
        });
        return () => ctrl.abort();
    }, [id, orgId, nonce]);
    const s = state && state.campaign.id === id ? state : null;
    const act = async (action: 'continue' | 'cancel') => {
        if (!id) return;
        setBusy(true);
        const res = await api<{ waiting?: string }>(`/api/candidates/outreach/campaigns/${encodeURIComponent(id)}`, { json: { orgId, action } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        if (res.data.waiting === 'hours') notify('Automatic sends go out between 9 am and 7 pm IST, Monday to Saturday.', 'info');
        setNonce(n => n + 1);
        onChanged();
    };
    const open = s && (s.campaign.status === 'queued' || s.campaign.status === 'sending');
    return (
        <Drawer open={!!id} onClose={onClose} labelId="campaign-title" title={s ? (s.campaign.positionTitle ?? 'Send') : 'Send'}
            footer={open ? <>
                <button type="button" onClick={() => void act('cancel')} disabled={busy} className={`${K_BTN_GHOST_DANGER} mr-auto`}>Stop the rest</button>
                <button type="button" onClick={() => void act('continue')} disabled={busy} className={K_BTN_PRIMARY}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}Send the next ones</button>
            </> : undefined}>
            {!s ? <Loading /> : (
                <ul className="divide-y divide-border">
                    {s.sends.map(x => (
                        <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                            <span className="min-w-0 flex-1 font-medium text-text-primary">{x.name}</span>
                            <span className="text-xs text-text-tertiary">{x.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                            <StatusPill tone={SEND_TONE[x.status]}>{x.status === 'unknown' ? 'Not confirmed' : x.status[0].toUpperCase() + x.status.slice(1)}</StatusPill>
                            {x.reason && <p className="basis-full text-xs text-text-secondary">{x.reason}</p>}
                        </li>
                    ))}
                </ul>
            )}
        </Drawer>
    );
}

// Applications ---------------------------------------------------------------------------------------------------------

function ApplicationsPanel({ orgId }: { orgId: string }) {
    const { notify } = useUi();
    const [data, setData] = useState<{ applications: ApplicationEntry[]; total: number; form: OutreachSettings['applicationForm'] } | null>(null);
    const [positions, setPositions] = useState<Position[]>([]);
    const [positionId, setPositionId] = useState('');
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);
    const [linkFor, setLinkFor] = useState('');
    const [link, setLink] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setPositions(res.data.positions); });
        return () => ctrl.abort();
    }, [orgId]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<NonNullable<typeof data>>(`/api/candidates/applications${qs({ orgId, positionId, page })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); return; }
            setData(res.data);
        });
        return () => ctrl.abort();
    }, [orgId, positionId, page, notify]);
    const makeLink = async () => {
        const res = await api<{ link: { url: string } }>('/api/candidates/applications', { json: { orgId, action: 'open-link', positionId: linkFor || null } });
        if (!res.ok) { notify(res.error, 'error'); return; }
        setLink(res.data.link.url);
    };
    const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); notify('Link copied', 'success'); } catch { notify('Copy it from the box.', 'info'); } };
    const openResume = async (id: string) => {
        const tab = window.open('about:blank', '_blank');
        const res = await api<{ url: string }>(`/api/candidates/applications${qs({ orgId, resume: id })}`);
        if (!res.ok) { tab?.close(); notify(res.error, 'error'); return; }
        if (tab) tab.location.href = res.data.url;
    };
    const current = data?.applications.find(a => a.id === openId) ?? null;
    return (
        <div className="space-y-4">
            <section className={`${K_CARD} px-4 py-4 sm:px-5`} aria-label="Link for job postings">
                <h2 className={H}>A link for job postings</h2>
                <p className="mt-0.5 text-sm text-text-secondary">One link per position, to paste in a LinkedIn or portal post. Everyone who applies through it lands in that position&apos;s pipeline. (WhatsApp and email outreach give each person their own link.)</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <SelectPill label="Position for the link" value={linkFor} onChange={v => { setLinkFor(v); setLink(null); }} className="min-w-[220px] max-w-full">
                        <option value="">General (no position)</option>
                        {positions.map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}</option>)}
                    </SelectPill>
                    <button type="button" onClick={() => void makeLink()} className={K_BTN}><Link2 className="h-4 w-4" />Get the link</button>
                </div>
                {link && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input readOnly value={link} aria-label="Application link" className={`${K_FIELD} min-w-0 flex-1 font-mono text-xs`} onFocus={e => e.currentTarget.select()} />
                        <button type="button" onClick={() => void copy(link)} className={K_BTN}><Copy className="h-4 w-4" />Copy</button>
                        <a href={link} target="_blank" rel="noopener noreferrer" className={K_BTN_GHOST}><ExternalLink className="h-4 w-4" />Open</a>
                    </div>
                )}
            </section>
            <section className={`${K_CARD} overflow-hidden`} aria-label="Applications received">
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
                    <h2 className={H}>Applications received{data ? <span className="ml-2 text-sm font-normal tabular-nums text-text-tertiary">{data.total}</span> : null}</h2>
                    <SelectPill label="Filter by position" value={positionId} onChange={v => { setPositionId(v); setPage(1); }} className="ml-auto min-w-[180px] max-w-full">
                        <option value="">All positions</option>
                        {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </SelectPill>
                </div>
                {!data ? <div className="px-5"><Loading /></div>
                    : !data.applications.length ? <EmptyBlock icon={Inbox} title="No applications yet">Applications from the form&apos;s links appear here, and the person is added (or updated) in Candidates.</EmptyBlock>
                        : (
                            <ul className="divide-y divide-border">
                                {data.applications.map(a => (
                                    <li key={a.id}>
                                        <button type="button" onClick={() => setOpenId(a.id)} className="flex min-h-[52px] w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-5">
                                            <span className="min-w-0 flex-1 basis-56"><span className="font-semibold text-text-primary">{a.name}</span><span className="block truncate text-xs text-text-tertiary">{[a.positionTitle ?? 'General', a.email, a.phone].filter(Boolean).join(' · ')}</span></span>
                                            {a.hasResume && <StatusPill tone="grey">Resume</StatusPill>}
                                            <span className="text-xs text-text-tertiary">{formatDate(a.createdAt)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                {data && data.total > 30 && (
                    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                        <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className={K_BTN}>Newer</button>
                        <button type="button" disabled={page * 30 >= data.total} onClick={() => setPage(p => p + 1)} className={K_BTN}>Older</button>
                    </div>
                )}
            </section>
            <Drawer open={!!current} onClose={() => setOpenId(null)} labelId="application-title" title={current?.name ?? 'Application'} subtitle={current ? `${current.positionTitle ?? 'General'} · ${formatDate(current.createdAt)}` : undefined}
                footer={current?.hasResume ? <button type="button" onClick={() => void openResume(current.id)} className={K_BTN_PRIMARY}><FileText className="h-4 w-4" />Open the resume</button> : undefined}>
                {current && data && (
                    <dl className="space-y-3 text-sm">
                        {data.form.fields.filter(f => f.type !== 'file').map(f => (
                            <div key={f.id}><dt className={K_LABEL}>{f.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-text-primary">{current.answers[f.id] === null || current.answers[f.id] === undefined || current.answers[f.id] === '' ? <span className="text-text-tertiary">—</span> : String(current.answers[f.id])}</dd></div>
                        ))}
                    </dl>
                )}
            </Drawer>
        </div>
    );
}

// Settings: form, templates, automatic ----------------------------------------------------------------------------------

function SettingsPanel({ orgId, section }: { orgId: string; section: 'form' | 'screening' | 'offer' | 'templates' | 'auto' }) {
    const { notify } = useUi();
    const [meta, setMeta] = useState<Omit<SettingsResponse, 'settings'> | null>(null);
    const [saved, setSaved] = useState<OutreachSettings | null>(null);
    const [draft, setDraft] = useState<OutreachSettings | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<SettingsResponse>(`/api/candidates/outreach/settings${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { notify(res.error, 'error'); return; }
            setMeta({ placeholders: res.data.placeholders, targets: res.data.targets });
            setSaved(res.data.settings);
            setDraft(res.data.settings);
        });
        return () => ctrl.abort();
    }, [orgId, notify]);
    const dirty = useMemo(() => !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
    const save = async () => {
        if (!draft) return;
        setBusy(true);
        const res = await api<{ settings: OutreachSettings }>('/api/candidates/outreach/settings', { method: 'PATCH', json: { orgId, settings: draft } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        setSaved(res.data.settings);
        setDraft(res.data.settings);
        notify('Saved', 'success');
    };
    if (!draft || !meta) return <Loading />;
    return (
        <div className="space-y-4 pb-16">
            {section === 'form' && <FormEditor value={draft.applicationForm} targets={meta.targets} onChange={applicationForm => setDraft(d => d && { ...d, applicationForm })} />}
            {section === 'screening' && <ScreeningEditor orgId={orgId} value={draft} targets={meta.targets} onChange={setDraft} />}
            {section === 'offer' && <OfferSettingsEditor value={draft} onChange={setDraft} />}
            {section === 'templates' && <TemplatesEditor value={draft.templates} placeholders={meta.placeholders} onChange={templates => setDraft(d => d && { ...d, templates })} />}
            {section === 'auto' && <AutoEditor value={draft} onChange={setDraft} />}
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface/95 px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(16,24,40,0.18)] backdrop-blur">
                <span className="mr-auto">{dirty ? <StatusPill tone="amber">Unsaved changes</StatusPill> : <span className="text-sm text-text-tertiary">All changes saved</span>}</span>
                <button type="button" onClick={() => setDraft(saved)} disabled={!dirty || busy} className={K_BTN}><RotateCcw className="h-4 w-4" />Discard</button>
                <button type="button" onClick={() => void save()} disabled={!dirty || busy} className={K_BTN_PRIMARY}>{busy && <Spinner />}Save</button>
            </div>
        </div>
    );
}

const slug = (s: string, taken: string[]) => {
    const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'question';
    let id = base;
    for (let i = 2; taken.includes(id); i += 1) id = `${base}_${i}`;
    return id;
};

/**
 * The questions of a form (the application form, or the screening questions): text, answer type, where the answer goes
 * on the record, required, order. `screening`: no file upload and no name / email / mobile (the person is known).
 */
function FieldsEditor({ fields, targets, onChange, screening = false }: { fields: ApplicationField[]; targets: Record<ApplicationTarget, string>; onChange: (f: ApplicationField[]) => void; screening?: boolean }) {
    const setField = (i: number, patch: Partial<ApplicationField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const move = (i: number, by: -1 | 1) => { const next = [...fields]; const [f] = next.splice(i, 1); next.splice(i + by, 0, f); onChange(next); };
    const used = fields.map(f => f.target).filter(Boolean);
    const locked = (f: ApplicationField) => !screening && !!f.target && REQUIRED_TARGETS.includes(f.target);
    const allowedTargets = (Object.keys(targets) as ApplicationTarget[]).filter(t => !screening || (t !== 'resume' && !REQUIRED_TARGETS.includes(t)));
    return (
        <>
            <ol className="space-y-2">
                {fields.map((f, i) => (
                    <li key={f.id} className={`${K_WELL} grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-end`}>
                        <label className="block"><span className={K_LABEL}>Question</span><input value={f.label} onChange={e => setField(i, { label: e.target.value })} maxLength={200} className={`${INPUT} mt-1`} /></label>
                        <label className="block"><span className={K_LABEL}>Answer type</span>
                            <select value={f.type} disabled={locked(f) || f.target === 'resume'} onChange={e => setField(i, { type: e.target.value as ApplicationField['type'], ...(e.target.value === 'select' && !f.options?.length ? { options: ['Yes', 'No'] } : {}) })} className={`${INPUT} mt-1`}>
                                {APPLICATION_FIELD_TYPES.filter(t => t !== 'file' || f.target === 'resume').map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                            </select>
                        </label>
                        <label className="block"><span className={K_LABEL}>Fills on the record</span>
                            <select value={f.target ?? ''} disabled={locked(f)} onChange={e => setField(i, { target: (e.target.value || null) as ApplicationTarget | null, ...(e.target.value === 'resume' ? { type: 'file' } : f.type === 'file' ? { type: 'text' } : {}) })} className={`${INPUT} mt-1`}>
                                <option value="">{screening ? 'Kept with the answers only' : 'Kept with the application only'}</option>
                                {allowedTargets.filter(t => t === f.target || !used.includes(t)).map(t => <option key={t} value={t}>{targets[t]}</option>)}
                            </select>
                        </label>
                        <div className="flex items-center gap-1">
                            <label className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary"><input type="checkbox" checked={f.required} disabled={locked(f)} onChange={e => setField(i, { required: e.target.checked })} className={CHECK} />Required</label>
                            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className={K_ICON_BTN}><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)} className={K_ICON_BTN}><ArrowDown className="h-4 w-4" /></button>
                            <button type="button" aria-label={`Remove "${f.label}"`} disabled={locked(f)} onClick={() => onChange(fields.filter((_, j) => j !== i))} className={K_ICON_BTN_DANGER} title={locked(f) ? 'Always asked' : undefined}><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <label className="block md:col-span-2"><span className={K_LABEL}>Hint (optional)</span><input value={f.help ?? ''} onChange={e => setField(i, { help: e.target.value || undefined })} maxLength={200} className={`${INPUT} mt-1`} /></label>
                        {f.type === 'select' && <label className="block md:col-span-2"><span className={K_LABEL}>Options, comma-separated</span><input value={(f.options ?? []).join(', ')} onChange={e => setField(i, { options: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} className={`${INPUT} mt-1`} /></label>}
                    </li>
                ))}
            </ol>
            <button type="button" onClick={() => onChange([...fields, { id: slug('question', fields.map(x => x.id)), label: '', type: 'text', required: false, target: null }])} className={K_BTN}><Plus className="h-4 w-4" />Add a question</button>
        </>
    );
}

function FormEditor({ value, targets, onChange }: { value: OutreachSettings['applicationForm']; targets: Record<ApplicationTarget, string>; onChange: (v: OutreachSettings['applicationForm']) => void }) {
    const set = (patch: Partial<OutreachSettings['applicationForm']>) => onChange({ ...value, ...patch });
    return (
        <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Application form">
            <div>
                <h2 className={H}>Application form</h2>
                <p className="mt-0.5 text-sm text-text-secondary">The questions candidates answer from the link in WhatsApp, email or a job posting. &quot;Fills on the record&quot; puts the answer on the candidate&apos;s record (so Search finds it); other answers are kept with the application. Name, email and mobile are always asked.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={K_LABEL}>Title</span><input value={value.title} onChange={e => set({ title: e.target.value })} maxLength={120} className={`${INPUT} mt-1`} /></label>
                <label className="block"><span className={K_LABEL}>Thank-you message</span><input value={value.thanks} onChange={e => set({ thanks: e.target.value })} maxLength={500} className={`${INPUT} mt-1`} /></label>
                <label className="block sm:col-span-2"><span className={K_LABEL}>Introduction</span><textarea value={value.intro} onChange={e => set({ intro: e.target.value })} rows={2} maxLength={1000} className={`${K_AREA} mt-1`} /></label>
            </div>
            <FieldsEditor fields={value.fields} targets={targets} onChange={fields => set({ fields })} />
            <label className="block"><span className={K_LABEL}>Consent (the candidate must tick it)</span><textarea value={value.consentText} onChange={e => set({ consentText: e.target.value })} rows={2} maxLength={1000} className={`${K_AREA} mt-1`} /></label>
        </section>
    );
}

/**
 * Screening and interviews (owner 2026-11-24): the screening questions sent on WhatsApp when someone moves to the
 * screening stage, the interview invite and reminder templates and guidelines, the company profile link, and the
 * rejection email. "Keep it configurable": all of it is HR's.
 */
function ScreeningEditor({ orgId, value, targets, onChange }: { orgId: string; value: OutreachSettings; targets: Record<ApplicationTarget, string>; onChange: (v: OutreachSettings) => void }) {
    const s = value.screening;
    const iv = value.interview;
    const setS = (patch: Partial<OutreachSettings['screening']>) => onChange({ ...value, screening: { ...s, ...patch } });
    const setI = (patch: Partial<OutreachSettings['interview']>) => onChange({ ...value, interview: { ...iv, ...patch } });
    const [stages, setStages] = useState<{ key: string; name: string }[]>([]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ stages: { key: string; name: string; hidden?: boolean }[] }>(`/api/candidates/stages${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setStages(res.data.stages.filter(x => !x.hidden)); });
        return () => ctrl.abort();
    }, [orgId]);
    const wa = value.templates.filter(t => t.channel === 'whatsapp');
    const em = value.templates.filter(t => t.channel === 'email');
    const lines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean);
    const stageOptions = (current: string) => [...stages, ...(current && !stages.some(x => x.key === current) ? [{ key: current, name: current }] : [])];
    return (
        <div className="space-y-4">
            <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Screening">
                <div>
                    <h2 className={H}>Screening questions</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">When someone moves to the screening stage, they get a WhatsApp from the person who moved them, with their own link to these questions. Their answers fill their record and show on their Calls tab, beside the job description, for the screening call. No answer: a reminder at 24 h and 48 h, then &quot;No response&quot;.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={s.enabled} onChange={e => setS({ enabled: e.target.checked })} className={CHECK} />Send the screening questions on the move</label>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={K_LABEL}>The stage that sends them</span>
                        <select value={s.stageKey} onChange={e => setS({ stageKey: e.target.value })} className={`${INPUT} mt-1`}>{stageOptions(s.stageKey).map(x => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
                    </label>
                    <label className="block"><span className={K_LABEL}>WhatsApp template</span>
                        <select value={s.whatsappTemplateId} onChange={e => setS({ whatsappTemplateId: e.target.value })} className={`${INPUT} mt-1`}>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    </label>
                    <label className="block"><span className={K_LABEL}>Most questions per position (standard ones included)</span><input type="number" min={5} max={40} value={s.maxQuestions} onChange={e => setS({ maxQuestions: Math.max(5, Math.min(40, Number(e.target.value) || 25)) })} className={`${INPUT} mt-1`} /></label>
                    <label className="block"><span className={K_LABEL}>No answer after (hours)</span><input type="number" min={24} max={336} value={s.noResponseAfterHours} onChange={e => setS({ noResponseAfterHours: Math.max(24, Math.min(336, Number(e.target.value) || 72)) })} className={`${INPUT} mt-1`} /></label>
                    <label className="block"><span className={K_LABEL}>Then move them to</span>
                        <select value={s.noResponseStageKey} onChange={e => setS({ noResponseStageKey: e.target.value })} className={`${INPUT} mt-1`}>
                            <option value="">Leave them where they are</option>
                            {stageOptions(s.noResponseStageKey).filter(x => x.key !== s.stageKey).map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                        </select>
                    </label>
                    <label className="block sm:col-span-2"><span className={K_LABEL}>Introduction on the questions page</span><input value={s.intro} onChange={e => setS({ intro: e.target.value })} maxLength={1000} className={`${INPUT} mt-1`} /></label>
                </div>
                <FieldsEditor fields={s.fields} targets={targets} onChange={fields => setS({ fields })} screening />
            </section>
            <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Interviews">
                <div>
                    <h2 className={H}>Interviews</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">Each interview gets its own page for the candidate: the job description, your company profile, these guidelines, how to join (or the address), and &quot;Will you attend? Yes / No&quot;. The WhatsApp invite and the reminder (the day before) link to it. A &quot;No&quot; tells whoever booked the interview.</p>
                </div>
                <label className="block"><span className={K_LABEL}>Company profile link ({'{{company_profile}}'})</span><input value={value.companyProfileUrl} onChange={e => onChange({ ...value, companyProfileUrl: e.target.value })} maxLength={500} placeholder="https://…" className={`${INPUT} mt-1`} /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={K_LABEL}>WhatsApp invite</span>
                        <select value={iv.inviteTemplateId} onChange={e => setI({ inviteTemplateId: e.target.value })} className={`${INPUT} mt-1`}><option value="">The standard invite</option>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    </label>
                    <label className="block"><span className={K_LABEL}>WhatsApp reminder (the day before)</span>
                        <select value={iv.reminderTemplateId} onChange={e => setI({ reminderTemplateId: e.target.value })} className={`${INPUT} mt-1`}><option value="">No WhatsApp reminder</option>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                    </label>
                    <label className="block"><span className={K_LABEL}>Guidelines for a video interview, one per line</span><textarea value={iv.guidelinesOnline.join('\n')} onChange={e => setI({ guidelinesOnline: lines(e.target.value) })} rows={5} className={`${K_AREA} mt-1`} /></label>
                    <label className="block"><span className={K_LABEL}>Guidelines for an in-person interview, one per line</span><textarea value={iv.guidelinesInPerson.join('\n')} onChange={e => setI({ guidelinesInPerson: lines(e.target.value) })} rows={5} className={`${K_AREA} mt-1`} /></label>
                </div>
            </section>
            <section className={`${K_CARD} space-y-3 px-4 py-4 sm:px-5`} aria-label="Rejection email">
                <h2 className={H}>Rejection email</h2>
                <p className="text-sm text-text-secondary">Offered after someone is moved to a rejected stage. HR presses Send; nothing goes on its own. Edit its wording under Templates.</p>
                <select aria-label="Rejection email template" value={value.rejectionEmailTemplateId} onChange={e => onChange({ ...value, rejectionEmailTemplateId: e.target.value })} className={`${INPUT} sm:max-w-md`}>
                    <option value="">Don&apos;t offer an email</option>{em.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
            </section>
        </div>
    );
}

/** Owner 2026-11-24: the ready-made assignments, the documents to ask for, and the offer's breakup rows and approvals. */
function OfferSettingsEditor({ value, onChange }: { value: OutreachSettings; onChange: (v: OutreachSettings) => void }) {
    const a = value.assignment;
    const docs = value.documents;
    const o = value.offer;
    const setA = (patch: Partial<OutreachSettings['assignment']>) => onChange({ ...value, assignment: { ...a, ...patch } });
    const setO = (patch: Partial<OutreachSettings['offer']>) => onChange({ ...value, offer: { ...o, ...patch } });
    const setLib = (i: number, patch: Partial<OutreachSettings['assignment']['library'][number]>) => setA({ library: a.library.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
    const wa = value.templates.filter(t => t.channel === 'whatsapp');
    const lines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean);
    const rows = (label: string, list: string[], set: (v: string[]) => void) => (
        <label className="block"><span className={K_LABEL}>{label}, one per line</span><textarea value={list.join('\n')} onChange={e => set(lines(e.target.value).slice(0, 20))} rows={5} className={`${K_AREA} mt-1`} /></label>
    );
    return (
        <div className="space-y-4">
            <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Assignments">
                <div>
                    <h2 className={H}>Assignments</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">Ready-made assignments per department: HR picks one when sending (Candidate → Assignment &amp; documents) and can still edit it. The candidate gets a WhatsApp with their own page: the brief, the Drive link, the deadline, and where to submit. The AI score against the JD shows to HR only.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={K_LABEL}>WhatsApp template</span>
                        <select value={a.whatsappTemplateId} onChange={e => setA({ whatsappTemplateId: e.target.value })} className={`${INPUT} mt-1`}>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                    <label className="block"><span className={K_LABEL}>Days to submit (default)</span><input type="number" min={1} max={30} value={a.defaultDueDays} onChange={e => setA({ defaultDueDays: Math.max(1, Math.min(30, Number(e.target.value) || 3)) })} className={`${INPUT} mt-1`} /></label>
                </div>
                <ol className="space-y-3">
                    {a.library.map((t, i) => (
                        <li key={t.id} className={`${K_WELL} grid gap-2 px-3 py-3 sm:grid-cols-2`}>
                            <input aria-label="Name" placeholder="Name (for HR)" value={t.name} onChange={e => setLib(i, { name: e.target.value })} maxLength={80} className={INPUT} />
                            <input aria-label="Department" placeholder="Department" value={t.department} onChange={e => setLib(i, { department: e.target.value })} maxLength={80} className={INPUT} />
                            <input aria-label="Title" placeholder="Title the candidate sees" value={t.title} onChange={e => setLib(i, { title: e.target.value })} maxLength={200} className={`${INPUT} sm:col-span-2`} />
                            <textarea aria-label="Brief" placeholder="The brief" value={t.brief} onChange={e => setLib(i, { brief: e.target.value })} rows={4} maxLength={8000} className={`${K_AREA} sm:col-span-2`} />
                            <textarea aria-label="Guidelines" placeholder="Guidelines (optional)" value={t.guidelines} onChange={e => setLib(i, { guidelines: e.target.value })} rows={2} maxLength={4000} className={`${K_AREA} sm:col-span-2`} />
                            <input aria-label="Drive link" placeholder="Drive link (optional)" value={t.driveLink} onChange={e => setLib(i, { driveLink: e.target.value })} maxLength={500} className={INPUT} />
                            <div className="flex items-center gap-2">
                                <input aria-label="Days to submit" type="number" min={1} max={30} value={t.dueDays} onChange={e => setLib(i, { dueDays: Math.max(1, Math.min(30, Number(e.target.value) || 3)) })} className={`${K_FIELD} w-24`} /><span className="text-sm text-text-secondary">days</span>
                                <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setA({ library: a.library.filter((_, j) => j !== i) })} className={`${K_ICON_BTN_DANGER} ml-auto`}><Trash2 className="h-4 w-4" /></button>
                            </div>
                        </li>
                    ))}
                </ol>
                <button type="button" disabled={a.library.length >= 50} onClick={() => setA({ library: [...a.library, { id: slug('assignment', a.library.map(t => t.id)), name: 'New assignment', department: '', title: '', brief: '', guidelines: '', driveLink: '', dueDays: a.defaultDueDays }] })} className={K_BTN}><Plus className="h-4 w-4" />Add a ready-made assignment</button>
            </section>
            <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Documents">
                <div>
                    <h2 className={H}>Documents after selection</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">&quot;Ask for documents&quot; on a candidate sends a WhatsApp with their own upload page; each file comes straight into the system for HR to verify.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={K_LABEL}>WhatsApp template</span>
                        <select value={docs.whatsappTemplateId} onChange={e => onChange({ ...value, documents: { ...docs, whatsappTemplateId: e.target.value } })} className={`${INPUT} mt-1`}>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                    {rows('Documents to ask for', docs.items, items => onChange({ ...value, documents: { ...docs, items } }))}
                </div>
            </section>
            <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Offer">
                <div>
                    <h2 className={H}>Offer: salary breakup and approvals</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">The breakup (annexure) is approved before the candidate sees it: the hiring manager first (who raised the request), then the HR Head, then the Director. Once released, the candidate gets the letter of intent with the breakup by email and WhatsApp, and accepts or declines on its page.</p>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={o.hiringManagerApproves} onChange={e => setO({ hiringManagerApproves: e.target.checked })} className={CHECK} />The hiring manager approves first</label>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={o.directorAlways} onChange={e => setO({ directorAlways: e.target.checked })} className={CHECK} />The Director approves every offer (not only those above the budget)</label>
                </div>
                <label className="block sm:max-w-md"><span className={K_LABEL}>Letter of intent WhatsApp template</span>
                    <select value={o.loiTemplateId} onChange={e => setO({ loiTemplateId: e.target.value })} className={`${INPUT} mt-1`}>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <div className="grid gap-3 sm:grid-cols-3">
                    {rows('Earnings (per month)', o.earnings, earnings => setO({ earnings }))}
                    {rows('Deductions (per month)', o.deductions, deductions => setO({ deductions }))}
                    {rows('Benefits (per year)', o.benefits, benefits => setO({ benefits }))}
                </div>
            </section>
        </div>
    );
}

function TemplatesEditor({ value, placeholders, onChange }: { value: OutreachTemplate[]; placeholders: Record<Placeholder, string>; onChange: (v: OutreachTemplate[]) => void }) {
    const setT = (i: number, patch: Partial<OutreachTemplate>) => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    const keys = Object.keys(placeholders) as Placeholder[];
    const add = (channel: 'whatsapp' | 'email') => onChange([...value, channel === 'whatsapp'
        ? { id: slug('wa_template', value.map(t => t.id)), name: 'New WhatsApp template', channel, campaign: '', params: ['first_name'], body: 'Hello {{first_name}},' }
        : { id: slug('email_template', value.map(t => t.id)), name: 'New email template', channel, subject: '{{role}} at {{company}}', body: 'Hello {{first_name}},' }]);
    return (
        <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Message templates">
            <div>
                <h2 className={H}>Message templates</h2>
                <p className="mt-0.5 text-sm text-text-secondary">WhatsApp and email each have their own. Placeholders: {keys.map(k => <code key={k} title={placeholders[k]} className="mr-1 rounded bg-surface-elevated px-1 py-0.5 text-[12px] text-text-primary ring-1 ring-inset ring-border">{`{{${k}}}`}</code>)}. A message whose placeholders cannot all be filled is not sent to that person.</p>
                <p className="mt-1 text-xs text-text-tertiary">WhatsApp only sends templates Meta approved: submit the wording in AiSensy, then enter its campaign name and its variables {'{{1}}, {{2}}, …'} in order here. The text below is what the preview shows; it must say what the approved template says.</p>
            </div>
            <ol className="space-y-3">
                {value.map((t, i) => (
                    <li key={t.id} className={`${K_WELL} space-y-2 px-3 py-3`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={t.channel === 'whatsapp' ? 'green' : 'blue'}>{t.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</StatusPill>
                            <input aria-label="Template name" value={t.name} onChange={e => setT(i, { name: e.target.value })} maxLength={80} className={`${K_FIELD} min-w-0 flex-1`} />
                            <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className={K_ICON_BTN_DANGER}><Trash2 className="h-4 w-4" /></button>
                        </div>
                        {t.channel === 'whatsapp' ? (
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                                <label className="block"><span className={K_LABEL}>AiSensy campaign name</span><input value={t.campaign ?? ''} onChange={e => setT(i, { campaign: e.target.value })} maxLength={120} placeholder="hr_candidate_job_opening_v1" className={`${INPUT} mt-1 font-mono`} /></label>
                                <div><span className={K_LABEL}>Variables in order</span>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        {(t.params ?? []).map((p, j) => (
                                            <span key={j} className="inline-flex items-center gap-1">
                                                <span className="text-xs text-text-tertiary">{`{{${j + 1}}}`}</span>
                                                <select aria-label={`Variable ${j + 1}`} value={p} onChange={e => setT(i, { params: (t.params ?? []).map((x, k) => (k === j ? e.target.value as Placeholder : x)) })} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                                                    {keys.map(k => <option key={k} value={k}>{k}</option>)}
                                                </select>
                                                <button type="button" aria-label={`Remove variable ${j + 1}`} onClick={() => setT(i, { params: (t.params ?? []).filter((_, k) => k !== j) })} className="inline-flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-red-500/10 dark:hover:text-red-400">×</button>
                                            </span>
                                        ))}
                                        {(t.params?.length ?? 0) < 10 && <button type="button" onClick={() => setT(i, { params: [...(t.params ?? []), 'first_name'] })} className={K_BTN_GHOST}><Plus className="h-3.5 w-3.5" />Variable</button>}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label className="block"><span className={K_LABEL}>Subject</span><input value={t.subject ?? ''} onChange={e => setT(i, { subject: e.target.value })} maxLength={250} className={`${INPUT} mt-1`} /></label>
                        )}
                        <label className="block"><span className={K_LABEL}>{t.channel === 'whatsapp' ? 'What the approved template says (preview)' : 'Message'}</span><textarea value={t.body} onChange={e => setT(i, { body: e.target.value })} rows={6} maxLength={5000} className={`${K_AREA} mt-1`} /></label>
                    </li>
                ))}
            </ol>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => add('whatsapp')} className={K_BTN}><Plus className="h-4 w-4" />WhatsApp template</button>
                <button type="button" onClick={() => add('email')} className={K_BTN}><Plus className="h-4 w-4" />Email template</button>
            </div>
        </section>
    );
}

function AutoEditor({ value, onChange }: { value: OutreachSettings; onChange: (v: OutreachSettings) => void }) {
    const a = value.auto;
    const set = (patch: Partial<OutreachSettings['auto']>) => onChange({ ...value, auto: { ...a, ...patch } });
    const wa = value.templates.filter(t => t.channel === 'whatsapp');
    const em = value.templates.filter(t => t.channel === 'email');
    return (
        <section className={`${K_CARD} space-y-4 px-4 py-4 sm:px-5`} aria-label="Automatic outreach">
            <div>
                <h2 className={H}>When a hiring request is approved</h2>
                <p className="mt-0.5 text-sm text-text-secondary">Search the database for the new position (its skills and experience{a.matchLocation ? ', and its location' : ''}) and send the matches the job opening with their own application link. Blacklisted people, and anyone messaged about a job lately, are left out. Messages go between 9 am and 7 pm IST, Monday to Saturday.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={a.enabled} onChange={e => set({ enabled: e.target.checked })} className={CHECK} />Contact matching candidates automatically</label>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={K_LABEL}>WhatsApp template</span>
                    <select value={a.whatsappTemplateId ?? ''} onChange={e => set({ whatsappTemplateId: e.target.value || null })} className={`${INPUT} mt-1`}>
                        <option value="">No WhatsApp</option>{wa.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </label>
                <label className="block"><span className={K_LABEL}>Email template (needs Zoho Mail connected)</span>
                    <select value={a.emailTemplateId ?? ''} onChange={e => set({ emailTemplateId: e.target.value || null })} className={`${INPUT} mt-1`}>
                        <option value="">No email</option>{em.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </label>
                <label className="block"><span className={K_LABEL}>At most this many people per request</span><input type="number" min={1} max={500} value={a.maxPerRequest} onChange={e => set({ maxPerRequest: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} className={`${INPUT} mt-1`} /></label>
                <label className="block"><span className={K_LABEL}>Skip anyone messaged in the last (days)</span><input type="number" min={0} max={365} value={a.skipContactedDays} onChange={e => set({ skipContactedDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} className={`${INPUT} mt-1`} /></label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={a.matchLocation} onChange={e => set({ matchLocation: e.target.checked })} className={CHECK} />Only people in the role&apos;s location (or willing to move there)</label>
            <label className="block max-w-md"><span className={K_LABEL}>Company name in messages ({'{{company}}'})</span><input value={value.companyName} onChange={e => onChange({ ...value, companyName: e.target.value })} maxLength={120} className={`${INPUT} mt-1`} /></label>
        </section>
    );
}

/** The bulk send dialog's data, loaded once per opening. */
export function useOutreachChoices(orgId: string, open: boolean) {
    const [state, setState] = useState<{ settings: OutreachSettings; mailboxes: { id: string; address: string }[]; positions: Position[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        void Promise.all([
            api<SettingsResponse>(`/api/candidates/outreach/settings${qs({ orgId })}`, { signal }),
            api<{ mailboxes: { id: string; address: string }[] }>(`/api/candidates/outreach/campaigns${qs({ orgId })}`, { signal }),
            api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal }),
        ]).then(([s, c, p]) => {
            if (signal.aborted) return;
            if (!s.ok) { setError(s.error); return; }
            setState({ settings: s.data.settings, mailboxes: c.ok ? c.data.mailboxes : [], positions: p.ok ? p.data.positions : [] });
        });
        return () => ctrl.abort();
    }, [open, orgId]);
    return { state, error };
}
