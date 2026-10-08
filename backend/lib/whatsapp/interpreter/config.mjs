import { z } from 'zod';

export const settingsSchema = z.object({
    enabled: z.boolean().default(false),
    bookingEnabled: z.boolean().default(true),
    ticketEnabled: z.boolean().default(true),
    defaultDate: z.enum(['ask', 'today']).default('ask'),
    accessMode: z.enum(['selected', 'all']).default('selected'),
    pilotUserIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();

export const defaultSettings = settingsSchema.parse({});
export function audienceAllows(settings, userId) {
    return !!settings?.enabled && (settings.accessMode === 'all' ||
        ((settings.accessMode === undefined || settings.accessMode === 'selected') && settings.pilotUserIds?.includes(userId)));
}
export function pilotAllowed(settings, userId) {
    const value = settingsSchema.safeParse(settings);
    return value.success && audienceAllows(value.data, userId);
}
