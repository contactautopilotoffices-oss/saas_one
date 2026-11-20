/**
 * Black, white and gold palette shared by the four org super admin mobile designs.
 *
 * Contrast rules baked in:
 *   - Gold is a fill or an accent. Text on gold is always black (8:1), never white (2.4:1).
 *   - Gold as text on white uses DEEP (4.9:1). Gold as text on black uses ON_DARK (10:1).
 *   - Red stays reserved for critical tickets, SLA breaches and late rounds.
 */
export const GOLD = {
    base: '#C9A24A',
    light: '#E6CD8C',
    pale: '#F1E4C0',
    tint: '#F6EFDD',
    deep: '#8B6B22',
    onDark: '#D8B865',
    gradient: 'linear-gradient(135deg, #EED79A 0%, #C9A24A 52%, #A47F2C 100%)',
};

/** Lighter red for text on dark surfaces; the brief's #C8282E fails contrast on black. */
export const RED_ON_DARK = '#FF8B8E';
