/**
 * Utility to sanitize template parameters before passing them to Meta WhatsApp Business API / AiSensy.
 *
 * Meta WhatsApp Cloud API strict parameter validation rules:
 * 1. Parameters cannot contain newline characters (\n, \r, \r\n).
 * 2. Parameters cannot contain tabs (\t).
 * 3. Parameters must not contain multiple consecutive spaces or leading/trailing whitespace.
 * 4. Parameters must never be empty string or whitespace-only (must contain at least 1 character).
 * 5. Parameter values must not exceed 1024 characters.
 */

export function sanitizeWhatsAppParam(param: any, key?: string): string {
    const isPhoneKey = Boolean(key && (key.includes('phone') || key.includes('mobile')));
    if (param === null || param === undefined) return isPhoneKey ? 'Not Available' : 'N/A';
    let str = String(param);

    // If key indicates priority, format nicely to standard title case
    if (key === 'priority') {
        const lower = str.trim().toLowerCase();
        if (lower === '1' || lower === 'low') return 'Low';
        if (lower === '2' || lower === 'medium') return 'Medium';
        if (lower === '3' || lower === 'high') return 'High';
        if (lower === '4' || lower === 'urgent' || lower === 'critical') return 'Urgent';
        if (str.trim().length > 0) {
            return str.trim().charAt(0).toUpperCase() + str.trim().slice(1);
        }
    }

    // Replace all line breaks (\r\n, \r, \n) and tabs (\t) with a single space
    str = str.replace(/[\r\n\t]+/g, ' ');

    // Collapse multiple consecutive spaces to a single space
    str = str.replace(/\s{2,}/g, ' ');

    // Trim leading and trailing whitespace
    str = str.trim();

    // If empty after trimming or raw 'n/a' for phone field, provide safe fallback
    if (str.length === 0) {
        return isPhoneKey ? 'Not Available' : 'N/A';
    }
    if (isPhoneKey && str.toLowerCase() === 'n/a') {
        return 'Not Available';
    }

    // Truncate to safe Meta parameter length (max 1000 chars)
    if (str.length > 1000) {
        str = str.slice(0, 997) + '...';
    }

    return str;
}

export function sanitizeWhatsAppParams(params: any[]): string[] {
    if (!Array.isArray(params)) return [];
    return params.map(p => sanitizeWhatsAppParam(p));
}
