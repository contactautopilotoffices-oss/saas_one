/**
 * Pick each generator's active DG tariff for a date from the property's full tariff list
 * (GET /api/properties/{id}/dg-tariffs without generatorId, newest effective_from first).
 *
 * Same rule as the database function get_active_dg_tariff (utilities_v2_schema.sql):
 *   effective_from <= date AND (effective_to IS NULL OR effective_to >= date), newest effective_from first, one row.
 * Returns the same fields that function returns, so one request replaces one request per generator
 * (performance plan Phase 5.1). Dates are 'YYYY-MM-DD' strings, so string comparison matches the database's.
 */
export interface ActiveDgTariff {
    id: string;
    cost_per_litre: number;
    effective_from: string;
}

export function pickActiveTariffs(allTariffs: unknown, date: string): Record<string, ActiveDgTariff> {
    const active: Record<string, ActiveDgTariff> = {};
    if (!Array.isArray(allTariffs)) return active;
    const sorted = [...allTariffs].sort((a, b) => String(b?.effective_from ?? '').localeCompare(String(a?.effective_from ?? '')));
    for (const t of sorted) {
        if (!t?.generator_id || !t.id || active[t.generator_id]) continue;
        const from = String(t.effective_from ?? '').slice(0, 10);
        const to = t.effective_to == null ? null : String(t.effective_to).slice(0, 10);
        if (from && from <= date && (to === null || to >= date)) {
            active[t.generator_id] = { id: t.id, cost_per_litre: t.cost_per_litre, effective_from: t.effective_from };
        }
    }
    return active;
}
