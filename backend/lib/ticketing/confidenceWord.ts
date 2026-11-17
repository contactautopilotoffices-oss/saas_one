/**
 * The words for the AI's own 0–100 rating of a ticket sorting (owner 2026-11-15: "percentage and words both, words in
 * bracket", e.g. "72% (Medium)"). Pure, so the ticket page can use it without pulling server code into the browser.
 * A sorting below High is sent to Brain → Review → Tickets for the Tech team to check.
 */
export const CONFIDENCE_HIGH = 85;
export const CONFIDENCE_MEDIUM = 60;

export type ConfidenceWord = 'High' | 'Medium' | 'Low';

export function confidenceWord(n: number): ConfidenceWord {
    return n >= CONFIDENCE_HIGH ? 'High' : n >= CONFIDENCE_MEDIUM ? 'Medium' : 'Low';
}

/** "72% (Medium)". */
export function confidenceLabel(n: number): string {
    return `${Math.round(n)}% (${confidenceWord(n)})`;
}
