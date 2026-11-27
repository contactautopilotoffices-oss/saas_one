// Shared surfaces and stage colors for the recruitment hub.

export const GLASS = 'relative rounded-[26px] border border-white/95 bg-white/65 shadow-[0_14px_38px_rgba(45,45,40,.1)] backdrop-blur-[26px] dark:border-white/[.13] dark:bg-white/[.07] dark:shadow-[0_14px_38px_rgba(0,0,0,.45)]';
export const INK2 = 'text-[#575757] dark:text-[#d6d3d1]';
export const INK3 = 'text-[#737373] dark:text-[#a8a29e]';
export const H2 = 'm-0 text-lg font-extrabold tracking-[-0.01em]';
export const ROW_HOVER = 'hover:bg-[#262626]/5 dark:hover:bg-white/[.07]';
export const TRACK = 'bg-[#262626]/10 dark:bg-white/[.14]';
export const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/95 bg-white/65 px-[18px] text-sm font-bold transition-transform hover:-translate-y-0.5 active:scale-[.96] dark:border-white/[.13] dark:bg-white/[.07]';
export const BTN_PRI = 'recruitment-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#353535] bg-[#353535] px-[18px] text-sm font-bold text-white shadow-[0_10px_24px_rgba(53,53,53,.22)] transition-transform hover:-translate-y-0.5 active:scale-[.96]';

export const TONE = {
    v: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
    b: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
    p: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
    a: 'bg-[#fef3c7] text-[#92400e] dark:bg-[rgba(245,158,11,.18)] dark:text-[#fcd34d]',
    c: 'bg-[#fee2e2] text-[#b91c1c] dark:bg-[rgba(239,68,68,.2)] dark:text-[#fca5a5]',
} as const;
export type Tone = keyof typeof TONE;
export const ROTATE: Tone[] = ['v', 'b', 'p', 'a', 'c'];

/**
 * One solid colour per board column, in order (the design's stage colours, then two more for longer boards), with a
 * text colour that reads on it at 4.5:1 or better.
 */
const STAGE_FILLS: Array<[string, string]> = [
    ['#4335c8', '#ffffff'], ['#5548df', '#ffffff'], ['#782ee9', '#ffffff'],
    ['#f59e0b', '#321700'], ['#f87171', '#400d15'], ['#6373d7', '#10132f'],
];
export const stageFill = (i: number) => STAGE_FILLS[i % STAGE_FILLS.length];

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?';

/**
 * Stage to stage (owner 2026-11-25): of the people who reached a column, the share who reached the next one. A person
 * reached every column up to the one they are in now (a rejected person, the one they were rejected in), so "reached"
 * is everyone in that column or a later one, rejected included. Null when nobody reached the earlier column.
 */
export function conversions(columns: string[], inRunning: number[], rejected: number[]): Array<{ from: string; to: string; pct: number | null }> {
    const here = columns.map((_, i) => (inRunning[i] ?? 0) + (rejected[i] ?? 0));
    const reached = here.map((_, i) => here.slice(i).reduce((n, c) => n + c, 0));
    return columns.slice(0, -1).map((from, i) => ({ from, to: columns[i + 1], pct: reached[i] ? Math.round((reached[i + 1] / reached[i]) * 100) : null }));
}
