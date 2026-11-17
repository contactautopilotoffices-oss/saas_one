/**
 * The kind of problem a flagged row has, without the row's own values (owner 2026-11-12: act on one kind of issue at
 * a time in View issues). `Expected in-hand "0.3" read as thousands` and `Expected in-hand "0.5" read as thousands`
 * are one kind: quoted values become "..." and bare numbers become #.
 */
export function issueKind(issue: string): string {
    return issue
        .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '"..."')
        .replace(/\d+(?:[.,]\d+)*/g, '#')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Every kind among these rows' issues with how many rows have it, most rows first. */
export function issueKinds(rows: { issues: string[] }[]): [kind: string, rows: number][] {
    const counts = new Map<string, number>();
    for (const row of rows) for (const kind of new Set(row.issues.map(issueKind))) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
