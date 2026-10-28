/**
 * Owner 2026-10-28: personal exceptions to a team switch, for code that works with a set of departments (the WhatsApp
 * gates). Pure — no database here, so the gates keep loading the access service lazily.
 */

/** The department set as one person sees it: their department added (personal ON) or removed (personal OFF). */
export function withPersonalSwitch(departments: ReadonlySet<string>, departmentId: string | null | undefined, own: boolean | null): ReadonlySet<string> {
    if (own === null || !departmentId) return departments;
    const out = new Set(departments);
    if (own) out.add(departmentId); else out.delete(departmentId);
    return out;
}
