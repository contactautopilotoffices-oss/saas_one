import catalogJson from './catalog.generated.json';

export type CatalogRoute = {
    path: string;          // e.g. /api/properties/{propertyId}/vendor-summary
    module: string;        // first segment, e.g. properties
    pathParams: string[];
    queryParams: string[];
    description: string;
};

type CompiledRoute = CatalogRoute & { regex: RegExp; staticSegments: number };

/**
 * Routes the automatic scan leaves out but a person has reviewed and allowed, with the reason.
 * Only add a route here after reading its GET handler.
 */
export const REVIEWED_ROUTES: (CatalogRoute & { reason: string })[] = [
    {
        path: '/api/hr/tickets',
        module: 'hr',
        pathParams: [],
        queryParams: ['orgId', 'propertyId', 'type', 'status'],
        description: 'GET /api/hr/tickets?orgId= HR tickets (grievance, hr_query, confidential_feedback, anonymous_feedback) the caller may see: org super admins all, HR roles all except anonymous and confidential, everyone else their own, their team\'s and those assigned to them.',
        reason: 'Excluded by the scan because the GET also starts the throttled SLA escalation check (at most every 5 minutes). That is the same thing that happens whenever anyone opens the HR tickets screen; the route checks sign-in and derives the role from the caller\'s memberships (PR #184).',
    },
    {
        path: '/api/hr/admin/categories',
        module: 'hr',
        pathParams: [],
        queryParams: [],
        description: 'GET /api/hr/admin/categories The active HR ticket categories (grievance, HR query, confidential, anonymous) with their ids, needed to raise an HR ticket.',
        reason: 'Excluded by the scan because the GET also inserts any missing DEFAULT categories (idempotent seeding, the same as opening the HR ticket form). Signed-in users only since the MCP create-tools change.',
    },
];
const REVIEWED_PATHS = new Set(REVIEWED_ROUTES.map(r => r.path));

const ROUTES: CatalogRoute[] = [
    ...(catalogJson as { routes: CatalogRoute[] }).routes,
    ...REVIEWED_ROUTES.map(r => ({ path: r.path, module: r.module, pathParams: r.pathParams, queryParams: r.queryParams, description: r.description })),
];
const EXCLUDED: { path: string }[] = (catalogJson as { excluded: { path: string }[] }).excluded
    .filter(e => !REVIEWED_PATHS.has(e.path));

// One path segment value: ids, slugs, dates. No slashes, no dots-only, no encoded characters.
const SEGMENT_VALUE = '([A-Za-z0-9_\\-:@][A-Za-z0-9_\\-.:@]{0,127})';

function compile(route: CatalogRoute): CompiledRoute {
    const parts = route.path.split('/').filter(Boolean);
    const regexBody = parts
        .map(p => (/^\{[\w-]+\}$/.test(p) ? SEGMENT_VALUE : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
    return {
        ...route,
        regex: new RegExp(`^/${regexBody}$`),
        staticSegments: parts.filter(p => !p.startsWith('{')).length,
    };
}

// More specific routes first, so /api/tickets/flow wins over /api/tickets/{id}.
const COMPILED: CompiledRoute[] = ROUTES.map(compile).sort((a, b) => b.staticSegments - a.staticSegments);

// Excluded routes, compiled the same way. Next.js serves a static segment before a dynamic one, so
// /api/petty-cash/wallet (excluded) would be served even though it also fits /api/petty-cash/{id}
// (included). A path that fits an excluded route at least as specifically is therefore refused.
const COMPILED_EXCLUDED = EXCLUDED.map(e =>
    compile({ path: e.path, module: '', pathParams: [...e.path.matchAll(/\{([\w-]+)\}/g)].map(m => m[1]), queryParams: [], description: '' }),
);

export function allRoutes(): CatalogRoute[] {
    return ROUTES;
}

export function modules(): { module: string; routes: number }[] {
    const counts = new Map<string, number>();
    for (const r of ROUTES) counts.set(r.module, (counts.get(r.module) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([module, routes]) => ({ module, routes }));
}

/**
 * Match a concrete path (e.g. /api/properties/1234/vendor-summary) against the catalogue.
 * Returns the route and its path parameters, or null when the path is not exposed.
 */
export function matchRoute(path: string): { route: CatalogRoute; params: Record<string, string> } | null {
    if (typeof path !== 'string' || path.length > 512) return null;
    if (!path.startsWith('/api/') || path.includes('?') || path.includes('#') || path.includes('%')) return null;
    if (path.includes('//') || path.includes('\\') || /\/\.\.?(\/|$)/.test(path)) return null;
    const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    for (const r of COMPILED) {
        const m = clean.match(r.regex);
        if (!m) continue;
        if (COMPILED_EXCLUDED.some(x => x.staticSegments >= r.staticSegments && x.regex.test(clean))) return null;
        const params: Record<string, string> = {};
        r.pathParams.forEach((name, i) => {
            params[name] = m[i + 1];
        });
        const route: CatalogRoute = { path: r.path, module: r.module, pathParams: r.pathParams, queryParams: r.queryParams, description: r.description };
        return { route, params };
    }
    return null;
}

/** Keyword search over the catalogue, for the find_endpoints tool. */
export function searchRoutes(query: string, module?: string, limit = 25): CatalogRoute[] {
    const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const pool = module ? ROUTES.filter(r => r.module === module) : ROUTES;
    if (!words.length) return pool.slice(0, limit);
    return pool
        .map(r => {
            const hay = `${r.path} ${r.description} ${r.queryParams.join(' ')}`.toLowerCase();
            const score = words.reduce((s, w) => s + (hay.includes(w) ? (r.path.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
            return { r, score };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => x.r);
}
