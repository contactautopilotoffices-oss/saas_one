/**
 * Helper utility for extracting actual image timestamps from:
 * 1. File names (e.g., WhatsApp, Android/iOS Camera, Screenshots)
 * 2. EXIF metadata buffer (if present)
 * 3. File lastModified timestamps
 *
 * Used to detect actual image age on gallery uploads and display accurate
 * timestamp feedback when photos are uploaded from gallery instead of live camera.
 */

export interface ParsedImageTimestamp {
    timestampStr: string;      // e.g. "20/10/2026, 12:01:49 PM"
    date: Date;
    source: 'filename_whatsapp' | 'filename_camera' | 'filename_screenshot' | 'filename_generic' | 'exif' | 'last_modified';
    isLiveCapture: boolean;
}

/**
 * Pads a number with leading zeroes
 */
function pad(num: number, size = 2): string {
    return String(num).padStart(size, '0');
}

/**
 * Format a Date object into standard "DD/MM/YYYY, hh:mm:ss A" string
 */
export function formatDisplayTimestamp(date: Date): string {
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // '0' should be '12'

    return `${day}/${month}/${year}, ${pad(hours)}:${minutes}:${seconds} ${ampm}`;
}

/**
 * Parse timestamp directly from image filename
 */
export function parseFilenameTimestamp(filename: string): ParsedImageTimestamp | null {
    if (!filename || typeof filename !== 'string') return null;

    // Check if filename indicates a live capture created by our in-app camera
    const isLive = filename.startsWith('LIVE_CAPTURE_') || filename.startsWith('LIVE_AUDIT_');

    // 1. WhatsApp format: "WhatsApp Image 2026-10-20 at 12.01.49 PM.jpeg" or "WhatsApp Image 2026-10-20 at 12.01.49.jpeg"
    const waMatch = filename.match(/WhatsApp\s*Image\s*(\d{4})-(\d{2})-(\d{2})\s*at\s*(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?\s*(AM|PM)?/i);
    if (waMatch) {
        const year = parseInt(waMatch[1], 10);
        const month = parseInt(waMatch[2], 10) - 1;
        const day = parseInt(waMatch[3], 10);
        let hour = parseInt(waMatch[4], 10);
        const min = parseInt(waMatch[5], 10);
        const sec = waMatch[6] ? parseInt(waMatch[6], 10) : 0;
        const ampm = waMatch[7]?.toUpperCase();

        if (ampm === 'PM' && hour < 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        const date = new Date(year, month, day, hour, min, sec);
        if (!isNaN(date.getTime())) {
            return {
                timestampStr: formatDisplayTimestamp(date),
                date,
                source: 'filename_whatsapp',
                isLiveCapture: false,
            };
        }
    }

    // 2. Camera format: "IMG_20261020_120149.jpg", "PHOTO_20261020_120149.jpg", "PXL_20261020_120149.jpg"
    const camMatch = filename.match(/(?:IMG|PHOTO|PXL|VID|DSC|LIVE_CAPTURE)[-_](\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/i);
    if (camMatch) {
        const year = parseInt(camMatch[1], 10);
        const month = parseInt(camMatch[2], 10) - 1;
        const day = parseInt(camMatch[3], 10);
        const hour = parseInt(camMatch[4], 10);
        const min = parseInt(camMatch[5], 10);
        const sec = parseInt(camMatch[6], 10);

        const date = new Date(year, month, day, hour, min, sec);
        if (!isNaN(date.getTime())) {
            return {
                timestampStr: formatDisplayTimestamp(date),
                date,
                source: 'filename_camera',
                isLiveCapture: isLive,
            };
        }
    }

    // 3. Screenshot format: "Screenshot 2026-10-20 at 12.01.49 PM.png" or "Screenshot_20261020-120149.png"
    const screenMatch = filename.match(/Screenshot[-_ ]*(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_ .]*(?:at[-_ .]*)?(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?\s*(AM|PM)?/i);
    if (screenMatch) {
        const year = parseInt(screenMatch[1], 10);
        const month = parseInt(screenMatch[2], 10) - 1;
        const day = parseInt(screenMatch[3], 10);
        let hour = parseInt(screenMatch[4], 10);
        const min = parseInt(screenMatch[5], 10);
        const sec = screenMatch[6] ? parseInt(screenMatch[6], 10) : 0;
        const ampm = screenMatch[7]?.toUpperCase();

        if (ampm === 'PM' && hour < 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        const date = new Date(year, month, day, hour, min, sec);
        if (!isNaN(date.getTime())) {
            return {
                timestampStr: formatDisplayTimestamp(date),
                date,
                source: 'filename_screenshot',
                isLiveCapture: false,
            };
        }
    }

    // 4. Generic YYYYMMDD_HHMMSS or YYYY-MM-DD_HH-MM-SS
    const genericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_ ](\d{2})[-_.:](\d{2})[-_.:](\d{2})/);
    if (genericMatch) {
        const year = parseInt(genericMatch[1], 10);
        const month = parseInt(genericMatch[2], 10) - 1;
        const day = parseInt(genericMatch[3], 10);
        const hour = parseInt(genericMatch[4], 10);
        const min = parseInt(genericMatch[5], 10);
        const sec = parseInt(genericMatch[6], 10);

        const date = new Date(year, month, day, hour, min, sec);
        if (!isNaN(date.getTime())) {
            return {
                timestampStr: formatDisplayTimestamp(date),
                date,
                source: 'filename_generic',
                isLiveCapture: isLive,
            };
        }
    }

    return null;
}

/**
 * Scan binary buffer for EXIF standard DateTimeOriginal tag: "YYYY:MM:DD HH:MM:SS"
 */
export function parseExifBuffer(buffer?: Buffer | null): ParsedImageTimestamp | null {
    if (!buffer || typeof Buffer === 'undefined') return null;

    try {
        // Fast search in buffer for "20xx:xx:xx xx:xx:xx" ASCII string pattern
        const bufStr = buffer.toString('latin1');
        const exifMatch = bufStr.match(/\b(20\d{2}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\b/);
        if (exifMatch) {
            const year = parseInt(exifMatch[1], 10);
            const month = parseInt(exifMatch[2], 10) - 1;
            const day = parseInt(exifMatch[3], 10);
            const hour = parseInt(exifMatch[4], 10);
            const min = parseInt(exifMatch[5], 10);
            const sec = parseInt(exifMatch[6], 10);

            const date = new Date(year, month, day, hour, min, sec);
            if (!isNaN(date.getTime())) {
                return {
                    timestampStr: formatDisplayTimestamp(date),
                    date,
                    source: 'exif',
                    isLiveCapture: false,
                };
            }
        }
    } catch {
        // Ignore binary scan errors
    }

    return null;
}

/**
 * Resolve the actual image timestamp from available hints (EXIF, filename, lastModified).
 */
export function extractActualImageTimestamp(options: {
    filename?: string | null;
    lastModified?: number | string | Date | null;
    buffer?: Buffer | null;
}): ParsedImageTimestamp | null {
    // 1. Try EXIF from binary buffer
    const fromExif = parseExifBuffer(options.buffer);
    if (fromExif) return fromExif;

    // 2. Try parsing from filename
    if (options.filename) {
        const fromFilename = parseFilenameTimestamp(options.filename);
        if (fromFilename) return fromFilename;
    }

    // 3. Fallback to lastModified timestamp
    if (options.lastModified) {
        const date = options.lastModified instanceof Date
            ? options.lastModified
            : new Date(options.lastModified);

        // Sanity check: must be a valid date after Jan 1, 2020
        if (!isNaN(date.getTime()) && date.getFullYear() >= 2020) {
            return {
                timestampStr: formatDisplayTimestamp(date),
                date,
                source: 'last_modified',
                isLiveCapture: Boolean(options.filename && options.filename.startsWith('LIVE_CAPTURE_')),
            };
        }
    }

    return null;
}

/**
 * Compute allowed inspection dates for watermark verification.
 * Supports midnight / overnight cross-shift checklists (e.g. 23:00 to 04:00 at SS Plaza):
 * - If slot_time is night/midnight (>= 20:00 or <= 06:00), or title mentions night/midnight:
 *   returns [scheduledDate, nextDay, prevDay] so captures taken just before or after midnight pass.
 * - Always provides a small cross-midnight buffer for shifts ending around midnight.
 */
export function getAllowedInspectionDates(options: {
    completionDate: string; // YYYY-MM-DD or DD/MM/YYYY
    slotTime?: string | null; // e.g. "23:00" or "00:30"
    title?: string | null;
}): { allowedDates: string[]; isNightShift: boolean; description: string } {
    let year: number, month: number, day: number;

    if (options.completionDate.includes('-')) {
        [year, month, day] = options.completionDate.split('-').map(Number);
    } else if (options.completionDate.includes('/')) {
        [day, month, year] = options.completionDate.split('/').map(Number);
    } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
        day = now.getDate();
    }

    const scheduledDate = new Date(year, month - 1, day);
    const scheduledStr = `${pad(day)}/${pad(month)}/${year}`;

    let isNightShift = false;
    if (options.slotTime) {
        const hour = parseInt(options.slotTime.split(':')[0], 10);
        if (!isNaN(hour) && (hour >= 20 || hour <= 6)) {
            isNightShift = true;
        }
    }
    if (options.title && /night|midnight|graveyard|overnight/i.test(options.title)) {
        isNightShift = true;
    }

    const nextDay = new Date(scheduledDate.getTime() + 24 * 60 * 60 * 1000);
    const prevDay = new Date(scheduledDate.getTime() - 24 * 60 * 60 * 1000);

    const nextDayStr = `${pad(nextDay.getDate())}/${pad(nextDay.getMonth() + 1)}/${nextDay.getFullYear()}`;
    const prevDayStr = `${pad(prevDay.getDate())}/${pad(prevDay.getMonth() + 1)}/${prevDay.getFullYear()}`;

    // For midnight / night-shifts, both the scheduled calendar date and the next/prev boundary are valid
    const allowedDates = isNightShift
        ? [scheduledStr, nextDayStr, prevDayStr]
        : [scheduledStr, nextDayStr]; // crossover buffer for late evening tasks

    const description = isNightShift
        ? `Night/Midnight Shift (${options.slotTime || 'Overnight'}): captures stamped with ${scheduledStr} or ${nextDayStr} (cross-midnight) are valid.`
        : `Scheduled: ${scheduledStr}`;

    return { allowedDates, isNightShift, description };
}
