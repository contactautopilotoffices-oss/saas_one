/**
 * Standard Indian Date and Time Formatting Utilities (DD/MM/YYYY)
 */

/**
 * Format date string or object to DD/MM/YYYY
 * Example: "29/07/2026"
 */
export function formatDateIN(dateInput?: string | Date | null): string {
  if (!dateInput) return 'N/A';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'N/A';

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format date & time string or object to DD/MM/YYYY, hh:mm:ss am/pm
 * Example: "29/07/2026, 11:59:25 am"
 */
export function formatDateTimeIN(dateInput?: string | Date | null): string {
  if (!dateInput) return 'N/A';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Format date & time short version: DD/MM/YYYY, hh:mm am/pm
 * Example: "29/07/2026, 11:59 am"
 */
export function formatDateTimeShortIN(dateInput?: string | Date | null): string {
  if (!dateInput) return 'N/A';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
