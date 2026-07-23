/**
 * Helper to get exact UTC boundaries for the "Asia/Kolkata" (IST) timezone.
 * Used for accurate date filtering when the Next.js server runs in UTC.
 */

export function getISTDateBounds(dateFilter: 'today' | 'yesterday' | 'week' | 'month' | 'custom', customDateStr?: string) {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: 'numeric', day: 'numeric'
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find(p => p.type === type)!.value;

    const currentYear = parseInt(getPart('year'));
    const currentMonth = parseInt(getPart('month')) - 1;
    const currentDay = parseInt(getPart('day'));

    let startUtc: Date;
    let endUtc: Date;

    if (dateFilter === 'custom' && customDateStr) {
        const d = new Date(customDateStr);
        // Custom dates from input type="date" are usually local YYYY-MM-DD
        startUtc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 18, 29, 59, 999));
    } else if (dateFilter === 'yesterday') {
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 1, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 1, 18, 29, 59, 999));
    } else if (dateFilter === 'week') {
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 7, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
    } else if (dateFilter === 'month') {
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 30, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
    } else {
        // today
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
    }

    return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}
