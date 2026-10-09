/**
 * Shared types, constants and tiny helpers for the Procurement Tasks tab.
 * The server (/api/task-manager/workspace) decides what each person may see and do;
 * these types only describe what it returns.
 */

export type Status = 'pending' | 'in_progress' | 'completed';

export interface WTask {
    id: string;
    title: string;
    description: string | null;
    ownerId: string;
    ownerName: string;
    status: Status;
    assignedDate: string;
    isCarriedForward: boolean;
    canChange: boolean;
    /** Server decision: I hold this task and it is not finished, so I may give it to a teammate. */
    canHandOver?: boolean;
    /** A personal fixed task: comes back every working day, and cannot be deleted until unlocked. */
    locked?: boolean;
    /** The holder may lock or unlock it. */
    canLock?: boolean;
    /** Console view only: who gave it and from which department */
    meta?: { from: string; department: string };
}

export interface WMember {
    userId: string;
    name: string;
    isMe: boolean;
    openCount: number;
    completedCount: number;
}

export interface WAssignable {
    userId: string;
    name: string;
    isMe: boolean;
}

export interface WorkspaceOk {
    state: 'ok';
    actor: { userId: string; name: string; role: string; departmentName: string | null };
    teamSharing: boolean;
    date: string;
    members: WMember[];
    tasks: WTask[];
    assignable: WAssignable[];
    /** Working with a superuser: present when the server has it (shown only for a team whose switch is ON). */
    superuserCollab?: { enabled: boolean; superusers: Array<{ userId: string; name: string }> };
}

export type Workspace =
    | { state: 'no_profile'; message: string }
    | { state: 'locked'; reason: string; message: string }
    | WorkspaceOk;

export interface ColumnDef {
    id: Status;
    label: string;
    empty: string;
    dot: string;     // status dot
    pill: string;    // count pill
    glow: string;    // drop-target highlight
}

export const COLUMNS: ReadonlyArray<ColumnDef> = [
    {
        id: 'pending', label: 'To do', empty: 'Nothing waiting. Add a task or drag one back here.',
        dot: 'bg-zinc-400',
        pill: 'bg-zinc-200/70 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
        glow: 'ring-zinc-400/50 bg-zinc-100/80 dark:bg-zinc-800/60',
    },
    {
        id: 'in_progress', label: 'In progress', empty: 'Drag a task here when you start on it.',
        dot: 'bg-indigo-500',
        pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
        glow: 'ring-indigo-400/60 bg-indigo-50/80 dark:bg-indigo-950/30',
    },
    {
        id: 'completed', label: 'Done', empty: 'Finished tasks land here.',
        dot: 'bg-emerald-500',
        pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        glow: 'ring-emerald-400/60 bg-emerald-50/80 dark:bg-emerald-950/30',
    },
];

export const columnLabel = (s: Status) => COLUMNS.find(c => c.id === s)?.label ?? s;

/** The easing the superuser console uses for its slides, so both screens feel the same. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const initials = (name: string) =>
    name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';

const GRADIENTS = [
    'from-indigo-500 to-indigo-700',
    'from-emerald-500 to-teal-700',
    'from-sky-500 to-blue-700',
    'from-fuchsia-500 to-purple-700',
    'from-rose-500 to-pink-700',
    'from-amber-500 to-orange-600',
];

/** A stable colour per person, so the same face looks the same on every card. */
export function avatarGradient(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return GRADIENTS[h % GRADIENTS.length];
}

export function todayIST(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function shortDate(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function longDate(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
