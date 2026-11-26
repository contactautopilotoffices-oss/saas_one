'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { ResumeMailConnection, ResumeMailItem } from '@/backend/lib/candidates/resume-mail';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, FIELD, LABEL, Spinner } from './ui';
import { formatDate } from './format';

const ENDPOINT = '/api/candidates/resume-mail';
export default function ResumeMail(props: { orgId: string; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className={`${CARD} p-4 sm:p-6`} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Zoho Mail — import resumes from email</summary>
    {open && <MailPanel {...props} />}
  </details>;
}
function MailPanel({ orgId, onImported }: { orgId: string; onImported: () => void }) {
  const [connections, setConnections] = useState<ResumeMailConnection[]>([]);
  const [id, setId] = useState('');
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<{ folderId: string; folderName: string }[]>([]);
  const [folderId, setFolderId] = useState('');
  const [sinceDate, setSinceDate] = useState('');
  const [role, setRole] = useState('');
  const [importRole, setImportRole] = useState('');
  const [frequency, setFrequency] = useState<'manual' | 'hourly'>('manual');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [loadedItems, setLoadedItems] = useState<{ key: string; items: ResumeMailItem[]; total: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const c = connections.find(c => c.id === id);
  const itemsKey = JSON.stringify([orgId, id, nonce, status, page]);
  const items = loadedItems?.key === itemsKey ? loadedItems.items : [];
  const total = loadedItems?.key === itemsKey ? loadedItems.total : 0;
  const applySettings = useCallback((c?: ResumeMailConnection) => {
    setFolderId(c?.folder_id ?? ''); setSinceDate(c?.since_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
    setRole(c?.sourced_role ?? ''); setFrequency(c?.sync_every ?? 'manual'); setConfirmAuto(false);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void api<{ connections: ResumeMailConnection[] }>(`${ENDPOINT}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
      if (ctrl.signal.aborted) return;
      setLoading(false);
      if (!res.ok) { setError(res.error); return; }
      setConnections(res.data.connections);
      const chosen = res.data.connections.find(c => c.id === id) ?? res.data.connections[0];
      if (chosen?.id !== id) setImportRole(chosen?.sourced_role ?? '');
      setId(chosen?.id ?? ''); applySettings(chosen);
    });
    return () => ctrl.abort();
  }, [orgId, nonce, id, applySettings]);
  useEffect(() => {
    const ctrl = new AbortController();
    if (c?.connected) void api<{ folders: typeof folders }>(`${ENDPOINT}${qs({ orgId, id, view: 'folders' })}`, { signal: ctrl.signal }).then(res => {
      if (ctrl.signal.aborted) return;
      if (res.ok) setFolders(res.data.folders); else setError(res.error);
    });
    return () => ctrl.abort();
  }, [orgId, id, c?.connected]);
  useEffect(() => {
    const ctrl = new AbortController();
    if (id) void api<{ items: ResumeMailItem[]; total: number }>(`${ENDPOINT}${qs({ orgId, id, view: 'items', status, page })}`, { signal: ctrl.signal }).then(res => {
      if (ctrl.signal.aborted) return;
      setSelected([]);
      if (res.ok) setLoadedItems({ key: itemsKey, ...res.data }); else setError(res.error);
    });
    return () => ctrl.abort();
  }, [orgId, id, itemsKey, status, page]);

  const act = async (action: string, extra = {}) => {
    setBusy(true); setError(''); setMessage('');
    const res = await api<{ complete?: boolean; imported?: number; duplicates?: number; skipped?: number; failed?: number }>(ENDPOINT, { json: { orgId, id, action, ...extra } });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    if (action === 'preview') setMessage(res.data.complete ? 'Preview finished. Tick the attachments you want and click Import selected.' : 'There are more emails to check. Click Continue preview. You can import the files already shown.');
    else if (action === 'import') {
      setMessage(`${res.data.imported ?? 0} imported, ${res.data.duplicates ?? 0} already stored, ${res.data.skipped ?? 0} skipped, ${res.data.failed ?? 0} failed. Failed files stay here for retry.`);
      onImported();
    } else setMessage(action === 'disconnect' ? 'Disconnected. Imported resumes and email details are kept.' : 'Saved.');
    if (action === 'settings') setImportRole(role);
    setSelected([]); setNonce(n => n + 1);
  };
  const connect = async () => {
    const tab = window.open('', '_blank');
    if (!tab) { setError('Allow pop-ups for this site, then click Connect Zoho Mail again.'); return; }
    tab.opener = null;
    setBusy(true); setError('');
    const res = await api<{ url?: string }>(ENDPOINT, { json: { orgId, action: 'connect', reconnect: connections.some(box => box.connected) } });
    setBusy(false);
    if (!res.ok) { tab.close(); setError(res.error); return; }
    if (!res.data.url) { tab.close(); setMessage('The shared HR mailbox is already connected.'); setNonce(n => n + 1); return; }
    tab.location.href = res.data.url;
    setMessage('Finish connecting in the Zoho tab, then click Refresh connections here.');
  };
  const dirty = Boolean(c && (folderId !== (c.folder_id ?? '') || sinceDate !== (c.since_date?.slice(0, 10) ?? '') || role !== (c.sourced_role ?? '') || frequency !== c.sync_every));
  const usable = Boolean(c?.connected && c.active && c.folder_id && !dirty);
  return <div className="mt-4 min-w-0 space-y-4">
    <p className="text-sm text-text-secondary">This mailbox is shared by Recruitment users in your organization. Read resume attachments from a selected Zoho folder. Connecting and previewing create no resumes. PDF and Word files up to 15 MB are supported; other attachments are left out.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void connect()} className={BTN_PRIMARY}>{connections.some(box => box.connected) ? 'Reconnect shared mailbox' : 'Connect Zoho Mail'}</button>
      <button type="button" disabled={busy} onClick={() => { setError(''); setNonce(n => n + 1); }} className={BTN_SECONDARY}>Refresh connections</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
    {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
    {loading && <Spinner />}
    {!!connections.length && <label className="block"><span className={LABEL}>Recruitment mailbox</span>
      <select aria-label="Recruitment mailbox" disabled={busy} className={`${FIELD} mt-1 w-full`} value={id} onChange={e => { setId(e.target.value); setSelected([]); setFolders([]); const chosen = connections.find(c => c.id === e.target.value); applySettings(chosen); setImportRole(chosen?.sourced_role ?? ''); setPage(1); setError(''); }}>
        {connections.map(c => <option key={c.id} value={c.id}>{c.address}{!c.connected ? ' (disconnected)' : !c.active ? ' (paused)' : ''}</option>)}
      </select>
    </label>}
    {c?.connected && <fieldset disabled={busy} className="min-w-0 space-y-3">
      <legend className="mb-2 font-medium">Import settings</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0"><span className={LABEL}>Folder</span><select aria-label="Mail folder" className={`${FIELD} mt-1 w-full`} value={folderId} onChange={e => { setFolderId(e.target.value); setFrequency('manual'); }}>
          <option value="">Choose a folder</option>{folders.map(f => <option key={f.folderId} value={f.folderId}>{f.folderName}</option>)}
        </select></label>
        <label className="min-w-0"><span className={LABEL}>Emails from this date (UTC)</span><input aria-label="Emails from date" type="date" className={`${FIELD} mt-1 w-full`} value={sinceDate} onChange={e => { setSinceDate(e.target.value); setFrequency('manual'); }} /></label>
        <label className="min-w-0"><span className={LABEL}>Default designation</span><input aria-label="Mail default designation" maxLength={200} className={`${FIELD} mt-1 w-full`} value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Facility Manager" /></label>
        <label className="min-w-0"><span className={LABEL}>Sync frequency</span><select aria-label="Mail sync frequency" className={`${FIELD} mt-1 w-full`} value={frequency} onChange={e => { setFrequency(e.target.value as 'manual' | 'hourly'); setConfirmAuto(false); }}>
          <option value="manual">Only when I press Sync now</option><option value="hourly" disabled={!c.scan_complete}>Every hour — automatic import</option>
        </select></label>
      </div>
      {frequency === 'hourly' && <p className="text-sm text-text-secondary">Hourly sync imports all pending and new supported attachments from this folder, using the default designation. Skip unwanted files before enabling it. Larger queues continue on later runs.</p>}
      {frequency === 'hourly' && c.sync_every !== 'hourly' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmAuto} onChange={e => setConfirmAuto(e.target.checked)} />Allow automatic import of all pending and future attachments in this folder.</label>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} disabled={!folderId || !sinceDate || (frequency === 'hourly' && c.sync_every !== 'hourly' && !confirmAuto)} onClick={() => void act('settings', { folderId, sinceDate, sourcedRole: role, syncEvery: frequency, active: c.active })}>Save mail settings</button>
        <button type="button" className={BTN_GHOST} onClick={() => void act(c.active ? 'pause' : 'resume')}>{c.active ? 'Pause' : 'Resume'}</button>
        <button type="button" className={BTN_GHOST} onClick={() => void act('disconnect')}>Disconnect</button>
      </div>
    </fieldset>}
    {c && <>
      {c.last_error && <p className="text-sm text-red-700" role="alert">{c.last_error}</p>}
      {c.last_synced_at && <p className="text-xs text-text-secondary">Last checked: {formatDate(c.last_synced_at)} · {c.scan_complete ? 'Preview pass complete' : `Checked ${Math.max(0, c.scan_start - 1)} emails in this pass`}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !usable} className={BTN_PRIMARY} onClick={() => void act('preview')}>{busy ? <Spinner /> : null}{c.scan_start > 1 ? 'Continue preview' : 'Sync now — preview'}</button>
        <select aria-label="Mail attachment history" className={`${FIELD} max-w-full`} disabled={busy} value={status} onChange={e => { setSelected([]); setStatus(e.target.value); setPage(1); }}>
          <option value="pending">Waiting for import</option><option value="imported">Imported</option><option value="duplicate">Already stored</option><option value="skipped">Skipped</option>
        </select>
      </div>
      {dirty && <p className="text-sm text-text-secondary">Save the settings before previewing or importing.</p>}
      <p className="text-xs text-text-secondary">{total} attachments in this view. A matching filename means a possible duplicate; exact duplicates are checked during import. Imported attachments use Zoho Mail as their source.</p>
      <ul className="space-y-2">
        {items.map(item => <li key={item.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start gap-3">
            {status === 'pending' && <input type="checkbox" className="mt-1" aria-label={`Import ${item.file_name}`} disabled={busy || (!selected.includes(item.id) && selected.length >= 10)} checked={selected.includes(item.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />}
            <div className="min-w-0 flex-1 break-words text-sm">
              <p className="font-medium">{item.file_name}</p>
              <p>{item.sender} · {formatDate(item.received_at)}</p><p className="text-text-secondary">{item.subject || '(No subject)'}</p>
              <p className="text-xs text-text-secondary">Zoho Mail · {Math.ceil(item.file_size / 1024)} KB{item.possibleDuplicate && status === 'pending' ? ' · Possible duplicate — same filename' : ''}</p>
              {item.last_error && <p className="mt-1 text-red-700">{item.last_error}</p>}
              {item.file_id && <a className="text-primary-dark underline" target="_blank" rel="noopener noreferrer" href={`/api/candidates/resumes/${encodeURIComponent(item.file_id)}${qs({ orgId, inline: true })}`}>Open stored resume</a>}
            </div>
          </div>
        </li>)}
      </ul>
      {status === 'pending' && <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0"><span className={LABEL}>Designation for selected resumes</span><input aria-label="Designation for email imports" className={`${FIELD} mt-1 w-full`} maxLength={200} value={importRole} disabled={busy} onChange={e => setImportRole(e.target.value)} /></label>
        <button type="button" disabled={busy || !usable || !selected.length} className={BTN_PRIMARY} onClick={() => void act('import', { ids: selected, sourcedRole: importRole })}>Import selected ({selected.length}/10)</button>
        <button type="button" disabled={busy || !usable || !selected.length} className={BTN_GHOST} onClick={() => void act('import', { ids: selected, skip: true })}>Skip selected</button>
      </div>}
      {total > 50 && <div className="flex items-center gap-3"><button type="button" className={BTN_GHOST} disabled={busy || page === 1} onClick={() => { setSelected([]); setPage(p => p - 1); }}>Previous attachments</button><span className="text-sm">Page {page}</span><button type="button" className={BTN_GHOST} disabled={busy || page * 50 >= total} onClick={() => { setSelected([]); setPage(p => p + 1); }}>Next attachments</button></div>}
    </>}
  </div>;
}
