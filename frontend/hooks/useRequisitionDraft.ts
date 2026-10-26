'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { draftSchema, draftStorageKey, draftPeriodKey, newestDraft } from '../lib/requisitionDrafts';
import type { DraftPayload, SavedDraft } from '../lib/requisitionDrafts';

function readBackup(key: string): SavedDraft[] {
    try {
        const rows = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(rows) ? rows.filter(row => draftSchema.safeParse(row?.payload).success && Number.isFinite(Date.parse(row?.updated_at))) : [];
    } catch { return []; }
}

function fingerprint(payload: DraftPayload) {
    const parsed = draftSchema.safeParse(payload);
    return JSON.stringify(parsed.success ? parsed.data : payload);
}

export function useRequisitionDraft({ userId, orgId, propertyId, ready, payload, onRestore }: {
    userId: string; orgId: string; propertyId: string; ready: boolean;
    payload: DraftPayload; onRestore: (payload: DraftPayload) => void;
}) {
    const key = userId && orgId && propertyId ? draftStorageKey(userId, orgId, propertyId) : '';
    const [loadedKey, setLoadedKey] = useState('');
    const [status, setStatus] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [drafts, setDrafts] = useState<SavedDraft[]>([]);
    const baseline = useRef('');
    const revisions = useRef<Record<string, string | null>>({});
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const blocked = useRef(false);
    const completed = useRef(false);
    const currentKey = useRef(key);
    currentKey.current = key;
    const payloadRef = useRef(payload);
    payloadRef.current = payload;
    const params = new URLSearchParams({ user_id: userId, organization_id: orgId, property_id: propertyId }).toString();

    useEffect(() => {
        if (!key || !ready) return;
        let cancelled = false;
        setLoadedKey('');
        blocked.current = false;
        completed.current = false;
        setIsSaving(false);
        setStatus('Loading saved drafts…');
        const local = readBackup(key);
        void (async () => {
            let remote: SavedDraft[] = [];
            let unavailable = false;
            try {
                const response = await fetch(`/api/procurement/requisitions/drafts?${params}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Drafts unavailable');
                const body = await response.json();
                remote = (body.drafts || []).filter((row: SavedDraft) => draftSchema.safeParse(row.payload).success);
            } catch { unavailable = true; }
            if (cancelled) return;
            const combined = new Map<string, SavedDraft>();
            for (const row of remote) {
                const period = draftPeriodKey(row.payload);
                revisions.current[`${key}:${period}`] = row.updated_at;
                combined.set(period, row);
            }
            for (const row of local) {
                const period = draftPeriodKey(row.payload);
                const stored = combined.get(period);
                if (!stored || Date.parse(row.updated_at) > Date.parse(stored.updated_at)) {
                    combined.set(period, row);
                    revisions.current[`${key}:${period}`] = row.base_updated_at ?? null;
                }
            }
            const all = [...combined.values()];
            const latest = newestDraft(all);
            try {
                localStorage.setItem(key, JSON.stringify(all.map(row => ({ ...row,
                    base_updated_at: revisions.current[`${key}:${draftPeriodKey(row.payload)}`] ?? null }))));
            } catch { /* Keep cloud restoration usable if browser storage is full. */ }
            setDrafts(all);
            const restored = latest ? draftSchema.parse(latest.payload) : payloadRef.current;
            baseline.current = fingerprint(restored);
            if (latest) onRestore(restored);
            setStatus(unavailable ? 'Cloud drafts unavailable. Recent edits are kept in this browser.' : latest ? 'Draft restored. Continue editing or submit when ready.' : 'Changes will be saved automatically.');
            setLoadedKey(key);
        })();
        return () => { cancelled = true; };
    }, [key, ready, params, onRestore]);

    const keepLocal = useCallback((snapshot: DraftPayload) => {
        const period = draftPeriodKey(snapshot);
        const row = { payload: snapshot, updated_at: new Date().toISOString(), base_updated_at: revisions.current[`${key}:${period}`] ?? null };
        const rows = [...readBackup(key).filter(draft => draftPeriodKey(draft.payload) !== period), row];
        localStorage.setItem(key, JSON.stringify(rows));
        // Compare subsequent edits with the last backed-up payload, including
        // reversions to the initially restored values.
        if (currentKey.current === key) baseline.current = fingerprint(snapshot);
        setDrafts(rows);
    }, [key]);

    const save = useCallback(async (snapshot: DraftPayload = payloadRef.current) => {
        if (!key || loadedKey !== key || !ready || completed.current || blocked.current) return false;
        let backedUp = false;
        try { keepLocal(snapshot); backedUp = true; } catch { setStatus('Browser backup unavailable. Saving online…'); }
        const period = draftPeriodKey(snapshot);
        setIsSaving(true);
        const operation = queue.current.catch(() => {}).then(async () => {
            if (completed.current || blocked.current || currentKey.current !== key) return false;
            try {
                const response = await fetch('/api/procurement/requisitions/drafts', {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, organization_id: orgId, property_id: propertyId,
                        payload: snapshot, expected_updated_at: revisions.current[`${key}:${period}`] ?? null }),
                });
                const body = await response.json();
                if (!response.ok) {
                    if (response.status === 409) blocked.current = true;
                    throw new Error(body.error || 'Could not save online. Edits remain in this browser.');
                }
                revisions.current[`${key}:${period}`] = body.draft.updated_at;
                try {
                    const local = readBackup(key).map(row => draftPeriodKey(row.payload) === period
                        ? { ...row, base_updated_at: body.draft.updated_at } : row);
                    localStorage.setItem(key, JSON.stringify(local));
                } catch { /* Online save succeeded; do not misreport it. */ }
                if (currentKey.current === key) {
                    if (fingerprint(payloadRef.current) === fingerprint(snapshot)) baseline.current = fingerprint(snapshot);
                    setStatus(`Draft saved at ${new Date(body.draft.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
                }
                return true;
            } catch (error) {
                if (currentKey.current === key) setStatus(`${error instanceof Error ? error.message : 'Could not save draft.'} ${backedUp ? 'Your edits remain in this browser.' : 'Keep this form open until saving succeeds.'}`);
                return false;
            }
        });
        queue.current = operation;
        const result = await operation;
        if (currentKey.current === key) setIsSaving(false);
        return result;
    }, [key, loadedKey, ready, keepLocal, userId, orgId, propertyId]);

    const serialized = fingerprint(payload);
    useEffect(() => {
        if (!key || loadedKey !== key || !ready || completed.current || serialized === baseline.current) return;
        const snapshot = draftSchema.safeParse(JSON.parse(serialized));
        if (!snapshot.success) { setStatus('Check the draft fields before saving.'); return; }
        try { keepLocal(snapshot.data); if (!blocked.current) setStatus('Changes kept in this browser. Saving online…'); }
        catch { setStatus('Browser backup unavailable. Saving online…'); }
        const timer = setTimeout(() => { void save(snapshot.data); }, 800);
        return () => clearTimeout(timer);
    }, [key, loadedKey, ready, serialized, keepLocal, save]);

    const restore = useCallback((period: string) => {
        const row = drafts.find(draft => draftPeriodKey(draft.payload) === period);
        if (!row) return;
        onRestore(row.payload);
        setStatus('Draft restored.');
    }, [drafts, onRestore]);

    const reloadSaved = useCallback(async () => {
        await queue.current.catch(() => {});
        try {
            const response = await fetch(`/api/procurement/requisitions/drafts?${params}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Could not reload the saved version.');
            const body = await response.json();
            const rows: SavedDraft[] = (body.drafts || []).filter((row: SavedDraft) => draftSchema.safeParse(row.payload).success);
            const row = rows.find(row => draftPeriodKey(row.payload) === draftPeriodKey(payloadRef.current));
            if (!row) throw new Error('No online draft exists for this month and floor.');
            if (currentKey.current !== key) return;
            revisions.current[`${key}:${draftPeriodKey(row.payload)}`] = row.updated_at;
            blocked.current = false;
            baseline.current = fingerprint(row.payload);
            onRestore(row.payload);
            keepLocal(row.payload);
            setStatus('Saved version restored. Review it before continuing.');
        } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not reload draft.'); }
    }, [key, params, onRestore, keepLocal]);

    const clearAfterSubmit = useCallback(async (submitted: DraftPayload = payloadRef.current) => {
        const snapshot = structuredClone(submitted);
        if (currentKey.current === key) completed.current = true;
        await queue.current.catch(() => {});
        const revision = revisions.current[`${key}:${draftPeriodKey(snapshot)}`];
        let hasOtherEdits = false;
        try {
            const remaining = readBackup(key).filter(row => {
                if (draftPeriodKey(row.payload) !== draftPeriodKey(snapshot)) return true;
                if (fingerprint(row.payload) === fingerprint(snapshot)) return false;
                hasOtherEdits = true;
                return true;
            });
            localStorage.setItem(key, JSON.stringify(remaining));
        } catch { hasOtherEdits = true; /* Keep the cloud copy if browser cleanup could not be verified. */ }
        // Another tab's offline edits may still depend on this cloud revision.
        if (!revision || hasOtherEdits) return;
        try {
            const query = new URLSearchParams({ user_id: userId, organization_id: orgId, property_id: propertyId,
                month: String(snapshot.month), year: String(snapshot.year), floor: snapshot.floorTag, expected_updated_at: revision });
            const response = await fetch(`/api/procurement/requisitions/drafts?${query}`, { method: 'DELETE' });
            if (!response.ok) console.warn('Submitted successfully; saved draft cleanup failed');
        } catch { console.warn('Submitted successfully; saved draft cleanup failed'); }
    }, [key, userId, orgId, propertyId]);

    return { save, restore, reloadSaved, drafts, status, isSaving, isLoadingDraft: !!key && loadedKey !== key, clearAfterSubmit };
}
