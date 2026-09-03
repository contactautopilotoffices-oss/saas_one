/**
 * THE FIVE OEM LEVEL HUES — graphic fills.
 * ---------------------------------------------------------------------------
 * One hue per level of the OEM model (agent, employee, department, tech, org).
 * This module is the source of truth for the five HUE FAMILIES. It holds only
 * the palette: no component, no geometry.
 *
 * These exact hex values are for GRAPHIC FILLS ONLY — arcs, rings, radar
 * vertices and legend swatches sitting on the card surface, judged against the
 * 3:1 non-text minimum, with a direct numeral printed on or beside every mark.
 * Contrast on the white card surface:
 *   agent #d55181 3.94:1 · employee #c98500 3.08:1 · department #199e70 3.40:1
 *   tech  #d95926 3.88:1 · org      #3987e5 3.64:1
 * All five clear 3:1. Worst adjacent CVD dE is 9.1 in light mode, 8.4 in dark;
 * the always-visible direct numerals remain the real mitigation.
 *
 * NOT the only place the five levels are coloured. ./OrgEfficiencyMeter.tsx
 * colours the same five levels as TEXT BADGES (white label on a filled pill),
 * where the bar is 4.5:1 and none of these five clear it. It therefore states
 * the same five hue families at a darker step rather than importing these
 * values, and says so at its own constant. Same hues, two different contrast
 * jobs: if you change a hue FAMILY here, change it there too — but do not copy
 * these hex values there.
 *
 * Current importers: ./OrgProgressRadar.tsx, ./OrgProgressTracker.tsx and
 * ../dashboard/command-center/OrgProgressCard.tsx — all three import this
 * module directly. The ./ConcentricDial re-export shim they used to reach it
 * through is deleted.
 */

/** Innermost -> outermost in the retired ConcentricDial; unordered as a palette. */
export const LEVEL_COLORS: Record<string, string> = {
    agent: '#d55181',      // magenta
    employee: '#c98500',   // yellow
    department: '#199e70', // aqua
    tech: '#d95926',       // orange
    org: '#3987e5',        // blue
};
