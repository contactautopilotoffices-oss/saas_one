/**
 * Per-property configuration of the client support intake form (the form a client fills in after
 * scanning a facility QR code, at /q/request).
 *
 * One property may want only "Your Name" + "Process Name"; another only "Process Name" + "ID".
 * The field list is stored per property in `property_ticket_form_configs.fields` and resolved on
 * both sides from the helpers here, so the public form, the submit API and the config editor all
 * agree on one shape. A property with no stored row falls back to DEFAULT_GUEST_FORM_FIELDS, which
 * is exactly the form that shipped before this was configurable.
 *
 * This module is intentionally dependency-free so client components and route handlers can both
 * import it.
 */

export type GuestFormFieldType = 'text' | 'textarea' | 'tel' | 'email' | 'photos' | 'select';

export interface GuestFormField {
    /** Stable identifier. Built-in keys come from BUILTIN_FIELD_KEYS; custom ones start with `custom_`. */
    key: string;
    /** Label shown above the input on the public form. */
    label: string;
    type: GuestFormFieldType;
    enabled: boolean;
    required: boolean;
    placeholder?: string;
    /** Options for `select` fields. Ignored for every other type. */
    options?: string[];
}

/** Built-in fields, in the order the editor lists them. */
export const BUILTIN_FIELD_KEYS = [
    'guest_name',
    'client_id',
    'process_name',
    'description',
    'guest_phone',
    'guest_email',
    'photos',
] as const;

export type BuiltinFieldKey = (typeof BUILTIN_FIELD_KEYS)[number];

export function isBuiltinFieldKey(key: string): key is BuiltinFieldKey {
    return (BUILTIN_FIELD_KEYS as readonly string[]).includes(key);
}

export function isCustomFieldKey(key: string): boolean {
    return /^custom_[a-z0-9_]{1,40}$/.test(key);
}

/**
 * The fixed properties of each built-in field. `type` is not configurable for these: the submit API
 * writes them into real `guest_requests` columns and relies on the shape. Label, placeholder,
 * enabled and required are all configurable.
 */
export const BUILTIN_FIELDS: Record<BuiltinFieldKey, {
    type: GuestFormFieldType;
    defaultLabel: string;
    defaultPlaceholder: string;
    /** Short line shown under the field in the config editor. */
    hint: string;
    /** The `guest_requests` column this field is written to, or null when it goes into `form_data`. */
    column: 'guest_name' | 'ai_category' | 'description' | 'guest_phone' | 'guest_email' | 'photo_urls' | null;
}> = {
    guest_name: {
        type: 'text',
        defaultLabel: 'Your Name',
        defaultPlaceholder: 'Enter your full name',
        hint: 'Who is reporting the issue.',
        column: 'guest_name',
    },
    client_id: {
        type: 'text',
        defaultLabel: 'ID',
        defaultPlaceholder: 'Enter your employee / client ID',
        hint: 'Employee or client ID, for properties that identify people by number.',
        column: null,
    },
    process_name: {
        type: 'text',
        defaultLabel: 'Process Name',
        defaultPlaceholder: 'Enter process name (e.g. Housekeeping, AC Repair)',
        hint: 'Becomes the ticket category.',
        column: 'ai_category',
    },
    description: {
        type: 'textarea',
        defaultLabel: 'Issue Description',
        defaultPlaceholder: 'Describe the issue in detail (e.g. A/C cooling issue, water leak near washbasin...)',
        hint: 'Free text, up to 1000 characters.',
        column: 'description',
    },
    guest_phone: {
        type: 'tel',
        defaultLabel: 'Phone Number',
        defaultPlaceholder: 'Enter your phone number',
        hint: 'Optional contact number.',
        column: 'guest_phone',
    },
    guest_email: {
        type: 'email',
        defaultLabel: 'Email',
        defaultPlaceholder: 'Enter your email address',
        hint: 'Optional contact email.',
        column: 'guest_email',
    },
    photos: {
        type: 'photos',
        defaultLabel: 'Attach Photos',
        defaultPlaceholder: '',
        hint: 'Up to 3 photos taken on the phone.',
        column: 'photo_urls',
    },
};

/** Maximum number of photos the public form accepts. */
export const MAX_GUEST_PHOTOS = 3;
/** Maximum length of the description field. */
export const MAX_DESCRIPTION_LENGTH = 1000;
/** Maximum length of any single-line answer. */
export const MAX_TEXT_LENGTH = 200;
/** Maximum number of custom fields a property may add. */
export const MAX_CUSTOM_FIELDS = 6;

/**
 * The form as it behaved before it became configurable: name, process name and description all
 * required, photos optional. Every property without a stored config keeps exactly this.
 */
export const DEFAULT_GUEST_FORM_FIELDS: GuestFormField[] = [
    { key: 'guest_name', label: 'Your Name', type: 'text', enabled: true, required: true },
    { key: 'process_name', label: 'Process Name', type: 'text', enabled: true, required: true },
    { key: 'description', label: 'Issue Description', type: 'textarea', enabled: true, required: true },
    { key: 'photos', label: 'Attach Photos', type: 'photos', enabled: true, required: false },
];

/** A field list covering every built-in key, for the config editor to render rows from. */
export function editorFieldList(stored: GuestFormField[]): GuestFormField[] {
    const byKey = new Map(stored.map(f => [f.key, f]));
    const builtins: GuestFormField[] = BUILTIN_FIELD_KEYS.map(key => {
        const existing = byKey.get(key);
        if (existing) return existing;
        return {
            key,
            label: BUILTIN_FIELDS[key].defaultLabel,
            type: BUILTIN_FIELDS[key].type,
            enabled: false,
            required: false,
            placeholder: BUILTIN_FIELDS[key].defaultPlaceholder || undefined,
        };
    });
    // Keep the stored order for built-ins that are present, then append the rest, then customs.
    const storedBuiltinOrder = stored.filter(f => isBuiltinFieldKey(f.key)).map(f => f.key);
    builtins.sort((a, b) => {
        const ia = storedBuiltinOrder.indexOf(a.key);
        const ib = storedBuiltinOrder.indexOf(b.key);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return BUILTIN_FIELD_KEYS.indexOf(a.key as BuiltinFieldKey) - BUILTIN_FIELD_KEYS.indexOf(b.key as BuiltinFieldKey);
    });
    const customs = stored.filter(f => isCustomFieldKey(f.key));
    return [...builtins, ...customs];
}

function cleanString(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Turn whatever is stored in the `fields` JSONB (or posted by the editor) into a valid, ordered
 * field list. Unknown keys, bad types and duplicates are dropped rather than trusted. Returns the
 * default list when nothing usable survives, so a property can never end up with an unusable form.
 */
export function normalizeGuestFormFields(raw: unknown): GuestFormField[] {
    if (!Array.isArray(raw)) return [...DEFAULT_GUEST_FORM_FIELDS];

    const seen = new Set<string>();
    const fields: GuestFormField[] = [];
    let customCount = 0;

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const key = cleanString(item.key, 50);
        if (!key || seen.has(key)) continue;

        const builtin = isBuiltinFieldKey(key);
        if (!builtin) {
            if (!isCustomFieldKey(key)) continue;
            if (customCount >= MAX_CUSTOM_FIELDS) continue;
            customCount += 1;
        }

        let type: GuestFormFieldType;
        if (isBuiltinFieldKey(key)) {
            type = BUILTIN_FIELDS[key].type;
        } else {
            const posted = cleanString(item.type, 20);
            type = posted === 'textarea' || posted === 'select' ? posted : 'text';
        }

        const label = cleanString(item.label, 60)
            || (isBuiltinFieldKey(key) ? BUILTIN_FIELDS[key].defaultLabel : key.replace(/^custom_/, '').replace(/_/g, ' '));

        const options = type === 'select' && Array.isArray(item.options)
            ? item.options.map(o => cleanString(o, 60)).filter(Boolean).slice(0, 20)
            : undefined;

        // A select with no options would be an unanswerable field.
        if (type === 'select' && (!options || options.length === 0)) continue;

        const placeholder = cleanString(item.placeholder, 120)
            || (isBuiltinFieldKey(key) ? BUILTIN_FIELDS[key].defaultPlaceholder : '');

        seen.add(key);
        fields.push({
            key,
            label,
            type,
            enabled: item.enabled !== false,
            required: item.required === true,
            ...(placeholder ? { placeholder } : {}),
            ...(options ? { options } : {}),
        });
    }

    const enabled = fields.filter(f => f.enabled);
    // A form with nothing to fill in cannot raise a ticket; fall back rather than ship a dead QR code.
    if (enabled.length === 0) return [...DEFAULT_GUEST_FORM_FIELDS];
    return fields;
}

/** Only the fields the client actually sees, in order. */
export function visibleGuestFormFields(fields: GuestFormField[]): GuestFormField[] {
    return fields.filter(f => f.enabled);
}

/** Max length accepted for a given field, used by both the form and the submit API. */
export function maxLengthForField(field: GuestFormField): number {
    if (field.key === 'description' || field.type === 'textarea') return MAX_DESCRIPTION_LENGTH;
    return MAX_TEXT_LENGTH;
}

/**
 * Validate one answer against its field. Returns an error message, or null when the answer is fine.
 * Shared by the public form (so the client sees the message before submitting) and the submit API
 * (so a crafted request cannot skip a required field).
 */
export function validateGuestFormAnswer(field: GuestFormField, value: string): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) {
        return field.required ? `${field.label} is required.` : null;
    }
    if (trimmed.length > maxLengthForField(field)) {
        return `${field.label} must be ${maxLengthForField(field)} characters or fewer.`;
    }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return `${field.label} must be a valid email address.`;
    }
    if (field.type === 'tel' && !/^[0-9+\-()\s]{6,20}$/.test(trimmed)) {
        return `${field.label} must be a valid phone number.`;
    }
    if (field.type === 'select' && field.options && !field.options.includes(trimmed)) {
        return `Select a valid option for ${field.label}.`;
    }
    return null;
}
