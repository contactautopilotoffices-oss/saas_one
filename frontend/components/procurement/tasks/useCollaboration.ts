'use client';

import { useCallback, useEffect, useState } from 'react';
import { Status } from './types';

/** Owner 2026-10-26 — cross-department collaboration (the Send tab's "Other departments"). The server decides everything. */
export type CollabKind = 'task' | 'support' | 'together';
export interface CollabPerson { userId: string; name: string; department: string }
export interface CollabSent {
    kind: 'task' | 'request'; id: string; title: string; toName: string; department: string;
    status: 'awaiting' | 'declined' | Status; since: string; reason: string | null; canRemind: boolean; supportRequest: boolean;
}
export interface CollabIncoming { id: string; title: string; description: string | null; fromName: string; fromDepartment: string; neededBy: string | null; createdAt: string }
export interface CollabData { people: CollabPerson[]; sent: CollabSent[]; incoming: CollabIncoming[]; requestsReady: boolean; /** Owner 2026-10-27: my team may work with other departments. */ enabled: boolean }

type Result<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T>(body: Record<string, unknown>): Promise<Result<T>> {
    try {
        const res = await fetch('/api/task-manager/collaboration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return { ok: false, error: data.error || 'That did not work' };
        return { ok: true, ...(data as T) };
    } catch {
        return { ok: false, error: 'Could not reach the server. Please try again.' };
    }
}

export function useCollaboration(enabled = true) {
    const [data, setData] = useState<CollabData | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const res = await fetch('/api/task-manager/collaboration');
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.success) throw new Error(body.error || 'Could not load');
            setData({ people: body.people || [], sent: body.sent || [], incoming: body.incoming || [], requestsReady: body.requestsReady !== false, enabled: body.enabled !== false });
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);

    const send = useCallback((input: { targetUserId: string; kind: CollabKind; title: string; description: string; neededBy: string; dueTime?: string }) =>
        post<{ taskIds: string[]; requestId: string | null }>({ action: 'send', ...input }), []);
    const respond = useCallback((requestId: string, accept: boolean, reason?: string) =>
        post<{ taskId: string | null }>({ action: 'respond', requestId, accept, reason }), []);
    const remind = useCallback((taskIds: string[]) =>
        post<{ reminded: Array<{ name: string; count: number }>; skipped: Array<{ title: string; why: string }> }>({ action: 'remind', taskIds }), []);
    const checkDuplicate = useCallback(async (targetUserId: string, title: string) => {
        const r = await post<{ match: { assignedDate: string; status: Status } | null }>({ action: 'check_duplicate', targetUserId, title });
        return r.ok ? r.match : null;   // a failed check never blocks sending
    }, []);
    /** Files sent with a support request (stored against the request; they move onto the task when it is accepted). */
    const uploadToRequest = useCallback(async (requestId: string, files: File[]) => {
        const failed: string[] = [];
        for (const file of files) {
            const form = new FormData();
            form.append('file', file);
            form.append('requestId', requestId);
            const res = await fetch('/api/task-manager/attachments', { method: 'POST', body: form }).catch(() => null);
            const body = res ? await res.json().catch(() => ({})) : {};
            if (!res?.ok || !body.success) failed.push(`${file.name}: ${body.error || 'could not attach'}`);
        }
        return failed;
    }, []);

    return { data, loading, error, reload, send, respond, remind, checkDuplicate, uploadToRequest };
}
