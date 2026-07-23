/**
 * Safely parses a date string (ISO or otherwise) into a Date object.
 * Handles cases where the 'T' separator or 'Z' suffix might be missing.
 * Returns null if the input is null, undefined, or an invalid date string.
 */
export const parseDate = (d: string | null | undefined): Date | null => {
    if (!d) return null;
    try {
        // If it looks like an ISO string already
        if (d.includes('T')) {
            const date = new Date(d.endsWith('Z') || d.includes('+') ? d : `${d}Z`);
            return isNaN(date.getTime()) ? null : date;
        }
        // Handle database-style "YYYY-MM-DD HH:MM:SS" strings
        const date = new Date(`${d.replace(' ', 'T')}Z`);
        return isNaN(date.getTime()) ? null : date;
    } catch {
        return null;
    }
};
