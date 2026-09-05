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

/**
 * Accurately parses a booking date (YYYY-MM-DD) and time (HH:mm or HH:mm:ss)
 * assuming Asia/Kolkata (IST, UTC+5:30) timezone, returning a UTC Date instance.
 */
export function getBookingDateTimeIST(dateStr: string, timeStr: string): Date {
    if (!dateStr || !timeStr) return new Date(NaN);
    const cleanDate = String(dateStr).split('T')[0];
    const [year, month, day] = cleanDate.split('-').map(Number);
    const [hours, minutes] = String(timeStr).split(':').map(Number);

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
        return new Date(NaN);
    }

    // IST is UTC+5:30 -> UTC is IST minus 5 hours 30 mins
    const utcMillis = Date.UTC(year, month - 1, day, hours - 5, minutes - 30, 0, 0);
    return new Date(utcMillis);
}

/**
 * Checks if a booking start date/time (in IST) is in the past compared to the current moment.
 */
export function isBookingPastIST(dateStr: string, timeStr: string): boolean {
    const bookingDate = getBookingDateTimeIST(dateStr, timeStr);
    if (isNaN(bookingDate.getTime())) return false;
    return bookingDate.getTime() <= Date.now();
}
