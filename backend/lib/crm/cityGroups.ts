// ── City grouping ─────────────────────────────────────────────────────────────
// Meta/LinkedIn ad forms capture a granular LOCATION (e.g. "Lower Parel",
// "Andheri") which lands in a lead's `city`/`location`. The product filters by
// PARENT metro city (Mumbai / Bangalore / Noida), so a naive exact/`ilike %Mumbai%`
// match silently drops every neighbourhood-tagged lead. This map rolls those
// sub-locations up to their parent city so "Mumbai" matches all of its areas.
//
// Extend freely: add new ad locations under the right parent as campaigns expand.
// Aliases are lowercase substrings, matched with ILIKE against city AND location.

export const CITY_GROUPS: Record<string, string[]> = {
    Mumbai: [
        'mumbai', 'navi mumbai', 'thane', 'lower parel', 'parel', 'andheri',
        'bandra', 'bkc', 'kurla', 'powai', 'worli', 'goregaon', 'malad',
        'borivali', 'dadar', 'chembur', 'ghatkopar', 'vikhroli', 'lbs marg',
    ],
    Bangalore: [
        'bangalore', 'bengaluru', 'koramangala', 'whitefield', 'indiranagar',
        'hsr', 'electronic city', 'marathahalli', 'hebbal', 'jp nagar', 'btm',
        'mg road', 'sarjapur', 'bellandur', 'yelahanka', 'jayanagar',
    ],
    Noida: ['noida', 'greater noida'],
};

/** The canonical parent cities, in display order. */
export const PARENT_CITIES = Object.keys(CITY_GROUPS);

/** Escape a value so it can't break PostgREST filter grammar. */
function esc(s: string): string {
    return s.replace(/[(),*"\\]/g, ' ').trim();
}

/**
 * Area aliases for a city (always includes the city name itself). For a parent
 * city this returns all of its sub-locations; for an unknown value it returns
 * just that value, so exact/contains matching still works.
 */
export function cityAliases(city: string): string[] {
    const c = (city || '').trim().toLowerCase();
    const key = PARENT_CITIES.find((k) => k.toLowerCase() === c);
    if (key) return CITY_GROUPS[key];
    return c ? [c] : [];
}

/**
 * Build a PostgREST `.or()` condition string that matches a lead in ANY of the
 * given cities' areas, across both the `city` and `location` columns.
 * Example: cityFilterOr(['Mumbai']) ->
 *   "city.ilike.%mumbai%,location.ilike.%mumbai%,city.ilike.%lower parel%,..."
 */
export function cityFilterOr(cities: string[]): string {
    const aliases = [...new Set(cities.flatMap(cityAliases).map(esc).filter(Boolean))];
    return aliases
        .flatMap((a) => [`city.ilike.%${a}%`, `location.ilike.%${a}%`])
        .join(',');
}

/**
 * Resolve a granular lead city/location to its parent metro city. Used to roll
 * up dynamically-discovered city lists (e.g. territory_performance) into the
 * parent-city options shown in dropdowns. Unknown values pass through unchanged.
 */
export function parentCity(city: string): string {
    const c = (city || '').trim().toLowerCase();
    if (!c) return city;
    for (const [parent, aliases] of Object.entries(CITY_GROUPS)) {
        if (parent.toLowerCase() === c) return parent;
        if (aliases.some((a) => c.includes(a) || a.includes(c))) return parent;
    }
    return city;
}
