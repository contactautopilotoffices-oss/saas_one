'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Status, WAssignable, WAttachment, WDuplicate, Workspace, WorkspaceOk, columnLabel } from './types';

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export interface Toast {
    id: number;
    kind: 'success' | 'error';
    text: string;
    /** Owner 2026-10-26: an optional button on the message, e.g. "Add remark" after a task is marked done. */
    action?: { label: string; taskId: string };
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

    const toast = useCallback((kind: Toast['kind'], text: string, action?: Toast['action']) => {
        const id = ++toastId.current;
        setToasts(t => [...t.slice(-2), { id, kind, text, action }]);
        // A message with a button stays a little longer, so there is time to use it
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 8000 : 3600);
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
        return data;
    }, []);

    /** Owner 2026-10-28: `remark` — what was done, from the comment box shown before a task is marked done. */
    const moveTask = useCallback(async (taskId: string, status: Status, remark?: string) => {
        const before = wsRef.current;
        if (!before || before.state !== 'ok') return;
        const task = before.tasks.find(t => t.id === taskId);
        if (!task || task.status === status || !task.canChange) return;

        // 1. change the screen immediately
        setWs({ ...before, tasks: before.tasks.map(t => (t.id === taskId ? { ...t, status } : t)) });

        // 2. confirm with the server; undo on refusal
        try {
            await post({ action: 'set_status', taskId, status, ...(remark ? { remark } : {}) });
            // Owner 2026-10-28: the comment box comes BEFORE the move (Remark on completion); with it switched off, a remark
            // can still be added from the message, as before
            const mine = task.ownerId === before.actor.userId;
            const offerRemark = status === 'completed' && mine && !remark && before.features?.completionRemark === 'off';
            toast('success', remark ? 'Marked done, with your remark' : `Moved to ${columnLabel(status)}`, offerRemark ? { label: 'Add remark', taskId } : undefined);
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

    /** Edits a task I gave (name and details; owner 2026-10-26: also date and person). Used by "Assigned by me" and the task window. */
    // Owner 2026-10-27: no Details box any more — `description` is left out, so the server keeps the task's notes as they are
    const editTask = useCallback(async (taskId: string, title: string, description?: string, extra?: { date?: string; targetUserId?: string; dueDate?: string | null; dueTime?: string | null }) => {
        try {
            await post({ action: 'edit_task', taskId, title, ...(description !== undefined ? { description } : {}), ...extra });
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
    const giveMany = useCallback(async (taskId: string, people: WAssignable[], note: string, due?: { dueDate?: string | null; dueTime?: string | null }) => {
        const cur = wsRef.current;
        const task = cur && cur.state === 'ok' ? cur.tasks.find(t => t.id === taskId) : undefined;
        if (!task || people.length === 0) return false;
        const [first, ...rest] = people;
        let copied = 0;
        try {
            for (const p of rest) {
                await post({ action: 'assign', targetUserId: p.userId, title: task.title, description: task.description || undefined, note: note || undefined, ...due });
                copied++;
            }
            await post({ action: 'hand_over', taskId, targetUserId: first.userId, note: note || undefined, ...due });
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

    /** Owner 2026-10-27: edit (text) or delete (null) one note of my personal task. `index` / `expected` = as listed. */
    const editNote = useCallback(async (taskId: string, index: number, expected: string, text: string | null) => {
        try {
            await post(text === null ? { action: 'delete_note', taskId, index, expected } : { action: 'edit_note', taskId, index, expected, text });
            toast('success', text === null ? 'Note deleted' : 'Note saved');
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, text === null ? 'Could not delete the note' : 'Could not save the note'));
            return false;
        }
    }, [load, post, toast]);

    /** Owner 2026-10-26: an optional remark on one of MY tasks (saved like a note; the person who gave it is told in the app). */
    const addRemark = useCallback(async (taskId: string, note: string) => {
        try {
            // Owner 2026-10-28: on a finished task this is its completion remark (shown on its own, the giver is told)
            await post({ action: 'set_completion_remark', taskId, remark: note });
            toast('success', 'Remark saved');
            await load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not add the remark'));
            return false;
        }
    }, [load, post, toast]);

    /** Owner 2026-10-26: open tasks that look like this one, for each person. Never blocks giving the task (errors → none). */
    const checkDuplicates = useCallback(async (targetUserIds: string[], title: string): Promise<WDuplicate[]> => {
        try {
            const data = await post({ action: 'check_duplicates', targetUserIds, title });
            return (data.matches || []) as WDuplicate[];
        } catch {
            return [];
        }
    }, [post]);

    /** Owner 2026-10-26: attaches each file to the given tasks. Returns how many files were saved. */
    const uploadFiles = useCallback(async (taskIds: string[], files: File[]) => {
        let saved = 0;
        for (const file of files) {
            const form = new FormData();
            form.append('file', file);
            taskIds.forEach(id => form.append('taskId', id));
            try {
                const res = await fetch('/api/task-manager/attachments', { method: 'POST', body: form });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) throw new Error(data.error || 'Could not attach the file');
                saved++;
            } catch (err) {
                toast('error', `${file.name}: ${messageOf(err, 'could not attach the file')}`);
            }
        }
        return saved;
    }, [toast]);

    /** Owner 2026-10-26: the files on a task (download links work for 10 minutes). */
    /** Owner 2026-10-27: removes a file attached by mistake (the server checks who may). */
    const removeAttachment = useCallback(async (attachmentId: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/task-manager/attachments?id=${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not remove the file');
            toast('success', 'File removed');
            load();
            return true;
        } catch (err) {
            toast('error', messageOf(err, 'Could not remove the file'));
            return false;
        }
    }, [load, toast]);

    const listAttachments = useCallback(async (taskId: string): Promise<WAttachment[]> => {
        const res = await fetch(`/api/task-manager/attachments?taskId=${encodeURIComponent(taskId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not load the files');
        return data.attachments as WAttachment[];
    }, []);

    /**
     * Owner 2026-10-26: one task for one or more people (each gets their own copy), optionally a follow-up of another
     * task, with optional files attached to every copy.
     */
    const addTasks = useCallback(async (input: { targetUserIds: string[]; title: string; description?: string; date?: string; followUpOf?: string | null; files?: File[]; dueDate?: string | null; dueTime?: string | null }) => {
        try {
            const { files, ...rest } = input;
            const data = await post({ action: 'assign_many', ...rest });
            const created = (data.created || []) as Array<{ id: string; name: string }>;
            const failed = (data.failed || []) as Array<{ name: string; error: string }>;
            if (created.length && files?.length) await uploadFiles(created.map(c => c.id), files);
            if (created.length) toast('success', created.length === 1 ? 'Task added' : `Task given to ${created.length} people`);
            failed.forEach(f => toast('error', `${f.name}: ${f.error}`));
            await load();
            return created.length > 0;
        } catch (err) {
            toast('error', messageOf(err, 'Could not add the task'));
            return false;
        }
    }, [load, post, toast, uploadFiles]);

    const ok: WorkspaceOk | null = ws && ws.state === 'ok' ? ws : null;
    return { ws, ok, loading, refreshing, error, toasts, dismissToast, toast, reload: load, moveTask, addTask, addTasks, giveTask, deleteTask, setLocked, flagDependency, editTask, giveMany, addNote, addRemark, checkDuplicates, uploadFiles, listAttachments, removeAttachment, editNote };
}
