/**
 * Pure helpers for showing and speaking rates. No database here, so scoring.ts,
 * the simulator and the browser can import it.
 */

import type { PriceCheck } from './types';

/** "36", "36.5", "1,250" — how a rate is written for people. */
export function formatRate(n: number): string {
    const r = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 2) / 2 : Math.round(n * 100) / 100;
    return r.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const SPOKEN_UNIT: Record<string, string> = {
    nos: 'piece', jar: 'jar', can: 'can', pkt: 'packet', box: 'box', set: 'set', bottle: 'bottle', roll: 'roll', bundle: 'bundle',
    sheet: 'sheet', bag: 'bag', coil: 'coil', kg: 'kilo', ltr: 'litre', m: 'meter', ft: 'running feet', sqft: 'square feet', sqm: 'square meter',
    hr: 'ghanta', day: 'din', month: 'mahina', job: 'job',
};

/** "per jar", "per din" — what Meera says after a rate. Empty when the unit is unknown. */
export function spokenUnit(unit: string): string {
    if (!unit || unit === '-') return '';
    return SPOKEN_UNIT[unit] ?? unit;
}

const MEERA_UNIT: Record<string, string> = {
    nos: 'piece', kg: 'किलो', ltr: 'litre', hr: 'घंटा', day: 'दिन', month: 'महीना', ft: 'running feet', m: 'meter',
};

/** The unit as Meera says it on a call — Devanagari where Hindi is what people say. */
export function meeraUnit(unit: string): string {
    if (!unit || unit === '-') return '';
    return MEERA_UNIT[unit] ?? spokenUnit(unit);
}

export const VERDICT_LABEL: Record<PriceCheck['verdict'], string> = {
    good: 'below what we usually pay',
    fair: 'in line with what we pay',
    slightly_high: 'a little above what we pay',
    high: 'well above what we pay',
    no_benchmark: 'no price history to compare',
};
