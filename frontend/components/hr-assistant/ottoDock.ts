export interface OttoDock {
    side: 'left' | 'right';
    height: number;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));

export function parseOttoDock(value: string | null): OttoDock | null {
    try {
        const dock = JSON.parse(value ?? 'null') as Partial<OttoDock> | null;
        if (!dock || (dock.side !== 'left' && dock.side !== 'right') || typeof dock.height !== 'number' || !Number.isFinite(dock.height)) return null;
        return { side: dock.side, height: unit(dock.height) };
    } catch { return null; }
}

export function ottoDockAt(x: number, top: number, width: number, height: number, insetTop: number, insetBottom: number, size: number): OttoDock {
    const available = Math.max(1, height - insetTop - insetBottom - size);
    return { side: x < width / 2 ? 'left' : 'right', height: unit((top - insetTop) / available) };
}
