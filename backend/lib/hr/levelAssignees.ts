// Shared lookup for HR ticket escalation level assignees.
//
// Admin Config stores, per ticket type and level:
//   flow_assignees[type][level]              -> default people for every property
//   flow_assignees_by_property[type][level]  -> [{ property_ids, assignees }] rules
//   primary_property_id                      -> property used for org-level employees
//
// Property rules apply only to PROPERTY_ROUTED_TICKET_TYPES. A level with no matching
// rule falls back to the default people, so with no rules configured this behaves
// exactly like the old flow_assignees[type][level] lookup.
//
// Pure functions only (no DB access) so every caller resolves the same people.

export const PROPERTY_ROUTED_TICKET_TYPES = ['grievance', 'hr_query'] as const;

export interface PropertyAssigneeRule {
    property_ids: string[];
    assignees: string[];
}

// Loosely-typed shapes: the config is JSONB and ticket rows come from many different selects.
type UnknownRecord = Record<string, unknown>;

export interface TicketLike {
    ticket_type?: string | null;
    category?: { ticket_type?: string | null } | null;
    employee_snapshot?: { property_id?: unknown } | null;
}

function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function levelValue(byLevel: unknown, level: number | string): unknown {
    const rec = asRecord(byLevel);
    return rec[String(level)] ?? rec[String(Number(level))];
}

export function isPropertyRoutedTicketType(ticketType: string | null | undefined): boolean {
    return !!ticketType && (PROPERTY_ROUTED_TICKET_TYPES as readonly string[]).includes(ticketType);
}

// Older saves nested flow_assignees inside itself; unwrap to the real map.
export function unwrapFlowAssignees(configObj: unknown): UnknownRecord {
    let flowAssignees = asRecord(asRecord(configObj).flow_assignees);
    while (flowAssignees.flow_assignees) {
        flowAssignees = asRecord(flowAssignees.flow_assignees);
    }
    return flowAssignees;
}

function cleanIdList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

// Rules for one type and level, dropping malformed entries.
export function getPropertyRules(configObj: unknown, ticketType: string, level: number | string): PropertyAssigneeRule[] {
    const byType = asRecord(asRecord(configObj).flow_assignees_by_property)[ticketType];
    const rawRules = levelValue(byType, level);
    if (!Array.isArray(rawRules)) return [];
    return rawRules
        .map((rule: unknown) => ({
            property_ids: cleanIdList(asRecord(rule).property_ids),
            assignees: cleanIdList(asRecord(rule).assignees)
        }))
        .filter(rule => rule.property_ids.length > 0 && rule.assignees.length > 0);
}

// The property frozen on the ticket when it was raised (null for old tickets).
export function getTicketPropertyId(ticket: TicketLike | null | undefined): string | null {
    const pid = ticket?.employee_snapshot?.property_id;
    return typeof pid === 'string' && pid.trim() ? pid : null;
}

// People configured for a ticket type at a level, for the given ticket property.
export function getLevelAssigneeIds(
    configObj: unknown,
    ticketType: string,
    level: number | string,
    propertyId: string | null | undefined
): string[] {
    if (propertyId && isPropertyRoutedTicketType(ticketType)) {
        const rule = getPropertyRules(configObj, ticketType, level)
            .find(r => r.property_ids.includes(propertyId));
        if (rule) return [...rule.assignees];
    }
    return cleanIdList(levelValue(unwrapFlowAssignees(configObj)[ticketType], level));
}

// Convenience wrapper reading type and property straight from a ticket row.
export function getTicketLevelAssigneeIds(configObj: unknown, ticket: TicketLike | null | undefined, level: number | string): string[] {
    const ticketType = ticket?.ticket_type || ticket?.category?.ticket_type || 'grievance';
    return getLevelAssigneeIds(configObj, ticketType, level, getTicketPropertyId(ticket));
}

// Everyone configured anywhere in a ticket type's chain: default people plus every
// property rule. Used by the ticket access check, which stays type-wide by design.
export function getAllConfiguredAssigneeIds(configObj: unknown, ticketType: string): Set<string> {
    const ids = new Set<string>();
    const defaults = asRecord(unwrapFlowAssignees(configObj)[ticketType]);
    Object.values(defaults).forEach(val => cleanIdList(val).forEach(id => ids.add(id)));
    if (isPropertyRoutedTicketType(ticketType)) {
        const byType = asRecord(asRecord(asRecord(configObj).flow_assignees_by_property)[ticketType]);
        Object.keys(byType).forEach(level => {
            getPropertyRules(configObj, ticketType, level).forEach(rule => rule.assignees.forEach(id => ids.add(id)));
        });
    }
    return ids;
}

// Property used for routing a new ticket:
//   exactly one active property membership -> that property
//   none (org-level roles) or several      -> org primary property
//   no primary property configured         -> null (default chain)
export function pickTicketPropertyId(
    membershipPropertyIds: string[],
    primaryPropertyId: string | null | undefined
): string | null {
    const unique = Array.from(new Set(membershipPropertyIds.filter(Boolean)));
    if (unique.length === 1) return unique[0];
    return primaryPropertyId || null;
}

// Validation for saving rules: returns an error message, or null when valid.
// A property may appear in only one rule per type and level.
export function validatePropertyRules(byProperty: unknown): string | null {
    if (byProperty === undefined || byProperty === null) return null;
    if (typeof byProperty !== 'object' || Array.isArray(byProperty)) return 'Invalid property routing config.';
    const byType = byProperty as UnknownRecord;
    for (const ticketType of Object.keys(byType)) {
        if (!isPropertyRoutedTicketType(ticketType)) {
            return `Property routing is only supported for Grievance and HR Query (got "${ticketType}").`;
        }
        const levels = byType[ticketType] ?? {};
        if (typeof levels !== 'object' || Array.isArray(levels)) return 'Invalid property routing config.';
        for (const [level, rules] of Object.entries(levels as UnknownRecord)) {
            if (!Array.isArray(rules)) return `Invalid property rules at level ${level}.`;
            const seen = new Set<string>();
            for (const rule of rules) {
                const propertyIds = cleanIdList(asRecord(rule).property_ids);
                const assignees = cleanIdList(asRecord(rule).assignees);
                if (propertyIds.length === 0 || assignees.length === 0) {
                    return `Each property rule at level ${level} needs at least one property and one person.`;
                }
                for (const pid of propertyIds) {
                    if (seen.has(pid)) {
                        return `A property is used in more than one rule at level ${level}. Each property can be in only one rule per level.`;
                    }
                    seen.add(pid);
                }
            }
        }
    }
    return null;
}
