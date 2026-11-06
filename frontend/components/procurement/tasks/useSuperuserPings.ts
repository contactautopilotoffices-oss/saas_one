'use client';

import { useCallback, useEffect, useState } from 'react';

/** Everything the "superuser" view needs from /api/task-manager/superuser-pings (the server decides what is allowed). */
export interface PanelTask { id: string; title: string; status: string; assignedDate: string; assignerId: string | null; assignerName: string }
export interface PanelMine { id: string; title: string; status: string }
export interface PanelPing { id: string; status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'; sendAt: string; sentAt: string | null; fromLabel: string; count: number; mine: boolean }
export interface Reminder { enabled: boolean; time: string; days: number[]; recipientId: string | null; lastRunDate: string | null }
export interface Panel {
    enabled: boolean;
    me: { id: string; name: string };
    department: string;
    superusers: Array<{ id: string; name: string }>;
    recipient: { id: string; name: string } | null;
    tasks: PanelTask[];
    myOpen: PanelMine[];
    pings: PanelPing[];
    reminder: Reminder;
}

export type SendOutcome = { ok: true; status: 'sent' | 'scheduled' } | { ok: false; code: string | null; message: string };

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function useSuperuserPings(active: boolean) {
    const [panel, setPanel] = useState<Panel | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/task-manager/superuser-pings');
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load this view');
            setPanel(data.panel);
            setError(null);
        } catch (err) {
            setError(messageOf(err, 'Could not load this view'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (active) load(); }, [active, load]);

    const post = useCallback(async (body: Record<string, unknown>) => {
        const res = await fetch('/api/task-manager/superuser-pings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) { const e: any = new Error(data.error || 'That did not work'); e.code = data.code || null; throw e; }
        return data;
    }, []);

    const send = useCallback(async (input: { taskIds: string[]; fromLabel: string; note: string; sendAt: string | null; force?: boolean }): Promise<SendOutcome> => {
        try {
            const data = await post({ action: 'send', ...input, recipientId: panel?.recipient?.id });
            await load();
            return { ok: true, status: data.status };
        } catch (err: any) {
            return { ok: false, code: err?.code ?? null, message: messageOf(err, 'Could not send') };
        }
    }, [post, load, panel]);

    const cancel = useCallback(async (pingId: string) => {
        try { await post({ action: 'cancel', pingId }); await load(); return null; } catch (err) { return messageOf(err, 'Could not cancel'); }
    }, [post, load]);

    const saveReminder = useCallback(async (r: { enabled: boolean; time: string; days: number[] }) => {
        try { await post({ action: 'save_reminder', ...r, recipientId: panel?.recipient?.id }); await load(); return null; } catch (err) { return messageOf(err, 'Could not save'); }
    }, [post, load, panel]);

    return { panel, loading, error, reload: load, send, cancel, saveReminder };
}
