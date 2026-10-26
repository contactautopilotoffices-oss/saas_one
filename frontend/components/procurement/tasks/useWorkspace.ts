'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Status, WAssignable, Workspace, WorkspaceOk, columnLabel } from './types';

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export interface Toast {
    id: number;
    kind: 'success' | 'error';
    text: string;
}

/**
 * All talking to the server lives here, so the visual components stay dumb.
 *  - loads the board for a date (keeps showing the old data while a new date loads)
 *  - moves a card OPTIMISTICALLY: the UI changes at once, and snaps back with a message if the server refuses
 *  - adds / assigns tasks
 */
/** `date` … `to`: the days shown (owner 2026-10-15: a range of up to 31 days; `to` = `date` for one day). */
export function useWorkspace(date: string, departmentName: string, to: string = date) {
    const [ws, setWs] = useState<Workspace | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const wsRef = useRef<Workspace | null>(null);
    wsRef.current = ws;
    const toastId = useRef(0);

    const toast = useCallback((kind: Toast['kind'], text: string) => {
        const id = ++toastId.current;
        setToasts(t => [...t.slice(-2), { id, kind, text }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600);
    }, []);

    const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

    const load = useCallback(async () => {
        if (wsRef.current) setRefreshing(true); else setLoading(true);
        try {
            const res = await fetch(`/api/task-manager/workspace?from=${date}&to=${to}&department=${encodeURIComponent(departmentName)}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load tasks');
            setWs(data.workspace);
            setError(null);
        } catch (err) {
            setError(messageOf(err, 'Could not load tasks'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [date, to, departmentName]);

    useEffect(() => { load(); }, [load]);

    const post = useCallback(async (body: Record<string, unknown>) => {
        const res = await fetch('/api/task-manager/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'That did not work');
    }, []);

    const moveTask = useCallback(async (taskId: string, status: Status) => {
        const before = wsRef.current;
        if (!before || before.state !== 'ok') return;
        const task = before.tasks.find(t => t.id === taskId);
        if (!task || task.status === status || !task.canChange) return;

        // 1. change the screen immediately
        setWs({ ...before, tasks: before.tasks.map(t => (t.id === taskId ? { ...t, status } : t)) });

        // 2. confirm with the server; undo on refusal
        try {
            await post({ action: 'set_status', taskId, status });
            toast('success', `Moved to ${columnLabel(status)}`);
            load();
        } catch (err) {
            setWs(before);
            toast('error', messageOf(err, 'Could not move that task'));
        }
    }, [load, post, toast]);

    const addTask = useCallback(async (input: { targetUserId: string; title: string; description?: string; date?: string }) => {
        try {
            await post({ action: 'assign', ...input });
            toast('success', 'Task added');
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not add the task'));
            return false;
        }
    }, [load, post, toast]);

    /** Gives one of MY tasks to a teammate. Not optimistic: the server checks the rules, then the board reloads. */
    const giveTask = useCallback(async (taskId: string, targetUserId: string, toName: string) => {
        try {
            await post({ action: 'hand_over', taskId, targetUserId });
            toast('success', `Given to ${toName}`);
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not give that task'));
            load(); // the board may be out of date (e.g. the task just changed)
            return false;
        }
    }, [load, post, toast]);

    /** Deletes a task for good. No confirmation by design; the server checks who may do it, then the board reloads. */
    const deleteTask = useCallback(async (taskId: string) => {
        try {
            await post({ action: 'delete_task', taskId });
            toast('success', 'Task deleted');
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not delete that task'));
            load();
            return false;
        }
    }, [load, post, toast]);

    /** Locks (comes back every working day) or unlocks one of MY tasks. The screen changes at once and snaps back if the server refuses. */
    const setLocked = useCallback(async (taskId: string, locked: boolean) => {
        const before = wsRef.current;
        if (!before || before.state !== 'ok') return;
        setWs({ ...before, tasks: before.tasks.map(t => (t.id === taskId ? { ...t, locked } : t)) });
        try {
            await post({ action: 'set_locked', taskId, locked });
            toast('success', locked ? 'Locked. This task comes back every working day.' : 'Unlocked. It will not come back.');
            load();
        } catch (err) {
            setWs(before);
            toast('error', messageOf(err, 'Could not change that task'));
        }
    }, [load, post, toast]);

    /** "Pending on…" (owner 2026-10-19): tells a colleague one of my tasks is waiting on them. Nothing on the board changes. */
    const flagDependency = useCallback(async (taskId: string, targetUserId: string, toName: string) => {
        try {
            await post({ action: 'flag_dependency', taskId, targetUserId });
            toast('success', `${toName} has been told`);
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not send that'));
            return false;
        }
    }, [post, toast]);

    /** Edits a task I gave (name and details). Used by "Assigned by me". */
    const editTask = useCallback(async (taskId: string, title: string, description: string) => {
        try {
            await post({ action: 'edit_task', taskId, title, description });
            toast('success', 'Task saved');
            load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not save the task'));
            return false;
        }
    }, [load, post, toast]);

    /**
     * Owner 2026-10-21: "Give to" from the task window, with an optional note.
     * One person → hand over (the task moves). Several → everyone after the first gets their own copy first,
     * then the task moves to the first person, so a failed copy leaves the task safely with me.
     */
    const giveMany = useCallback(async (taskId: string, people: WAssignable[], note: string) => {
        const cur = wsRef.current;
        const task = cur && cur.state === 'ok' ? cur.tasks.find(t => t.id === taskId) : undefined;
        if (!task || people.length === 0) return false;
        const [first, ...rest] = people;
        let copied = 0;
        try {
            for (const p of rest) {
                await post({ action: 'assign', targetUserId: p.userId, title: task.title, description: task.description || undefined, note: note || undefined });
                copied++;
            }
            await post({ action: 'hand_over', taskId, targetUserId: first.userId, note: note || undefined });
            toast('success', people.length === 1 ? `Given to ${first.name}` : `Given to ${people.length} people`);
            await load();
            return true;
        } catch (err) {
            const done = copied > 0 ? ` (${copied} cop${copied === 1 ? 'y' : 'ies'} already sent)` : '';
            toast('error', messageOf(err, 'Could not give that task') + done);
            load();
            return false;
        }
    }, [load, post, toast]);

    /** Owner 2026-10-21: adds a note to a task (saved as a "Remark:" line; the holder is told). */
    const addNote = useCallback(async (taskId: string, note: string) => {
        try {
            await post({ action: 'add_note', taskId, note });
            toast('success', 'Note added');
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not add the note'));
            return false;
        }
    }, [load, post, toast]);

    const ok: WorkspaceOk | null = ws && ws.state === 'ok' ? ws : null;
    return { ws, ok, loading, refreshing, error, toasts, dismissToast, toast, reload: load, moveTask, addTask, giveTask, deleteTask, setLocked, flagDependency, editTask, giveMany, addNote };
}
