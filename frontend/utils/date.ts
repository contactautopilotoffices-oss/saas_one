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

/**
 * Formats a duration in milliseconds to a human readable string (e.g. '2h 15m' or '45m').
 */
export function formatDuration(ms: number): string {
    if (ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
