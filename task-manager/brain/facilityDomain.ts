import type { DomainHandler } from './domain';
import type { Intent, Slots } from './types';

/**
 * The language brain — the FACILITY domain (a hand-off only, for now).
 *
 * Room and ticket requests keep running in the existing facility assistant, untouched. This domain only
 * RECOGNISES them so the brain can say "not mine, pass it on". Joining the two assistants into one later means
 * replacing this file's `decide` with real facility logic; the core does not change.
 */
export const facilityDomain: DomainHandler = {
    id: 'facility',
    intents: [
        {
            name: 'facility_request',
            description: 'wants to BOOK a meeting room / boardroom, or REPORT a maintenance or facility problem (AC, leak, cleaning, repair ticket). This is NOT task management.',
            slots: '{"service":"room"|"ticket"|"other"}',
        },
    ],
    validateSlots(intent: Intent, raw: Record<string, unknown>): Slots | null {
        if (intent !== 'facility_request') return null;
        const service = raw.service === 'room' || raw.service === 'ticket' ? raw.service : 'other';
        return { intent: 'facility_request', service };
    },
    checkGrounding: () => true,
    decide(interp) {
        const service = interp.slots.intent === 'facility_request' ? interp.slots.service : 'other';
        return { outcome: 'HANDOFF', domain: 'facility', service };
    },
    replyFacts: () => null,
};
