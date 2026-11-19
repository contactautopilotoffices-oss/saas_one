/**
 * Small, deterministic readings of the person's words that code decides on its own, before or around the model step.
 * Pure. English, Hindi and Hinglish, like backend/lib/aiLayer/language.ts.
 *
 * Added 2026-11-18 (owner's failing chat): "cancel it", "cancel the lan ticket" were not understood as a cancel, because
 * only the bare word "cancel" was. A short cancel phrase now cancels the waiting card in code. Anything longer or less
 * clear goes to the model, which has the close_topic tool for it.
 */

/** Words that name what a card is about. A cancel phrase naming a DIFFERENT thing is not taken by code. */
const NOUNS: Array<{ re: RegExp; skills: RegExp }> = [
    { re: /\b(ticket|complaint|issue|problem|request)\b/i, skills: /^ticket\./ },
    { re: /\b(booking|room|meeting|slot)\b/i, skills: /^room\./ },
    { re: /\b(task|tasks)\b/i, skills: /^task\./ },
    { re: /\b(photo|pic|picture|image|file)\b/i, skills: /^(ticket\.add_photo|task\.add_file|ticket\.create)$/ },
    { re: /\b(memory|remember)\b/i, skills: /^memory\./ },
];

const CANCEL_PHRASES: RegExp[] = [
    // "cancel", "cancel it", "please cancel this", "no, cancel the lan ticket", "drop that", "forget it", "leave it"
    /^(?:(?:no|nah|nope|nahi)[,.! ]+)?(?:please\s+|pls\s+)?(?:cancel|drop|discard|scrap|forget|leave|stop|remove|abort)(?:\s+(?:it|this|that|this one|that one|everything|all|the\s+[\w-]+(?:\s+[\w-]+){0,2}))?(?:\s+(?:please|pls))?[.! ]*$/i,
    // "don't raise it", "do not book that", "dont create the ticket"
    /^(?:no[,. ]+)?(?:don'?t|do not|dont)\s+(?:raise|book|create|add|do|send|attach|make)(?:\s+(?:it|this|that|the\s+[\w-]+(?:\s+[\w-]+){0,2}))?[.! ]*$/i,
    // "I don't want it", "i dont want this ticket"
    /^(?:no[,. ]+)?i\s+(?:don'?t|do not|dont)\s+want\s+(?:it|this|that|the\s+[\w-]+(?:\s+[\w-]+){0,2})(?:\s+any\s*more)?[.! ]*$/i,
    // Hinglish: "cancel kar do", "rehne do", "mat karo", "nahi chahiye", "band karo"
    /^(?:cancel|band|rehne|rahne)\s*(?:kar\s*do|karo|kardo|do)?[.! ]*$/i,
    /^(?:mat\s+(?:karo|banao|bhejo|karna)|nahi\s+chahiye|nahin\s+chahiye|nai\s+chahiye)[.! ]*$/i,
    // Hindi
    /^(?:रद्द\s*(?:करो|कर\s*दो|करें)?|रहने\s*दो|नहीं\s*चाहिए|मत\s*करो)[।.! ]*$/,
];

/**
 * True when the whole message is a short request to cancel what is waiting. `skillId` is the waiting card's skill: a
 * phrase that names something else ("cancel the booking" while a ticket card waits) is left to the model.
 */
export function isCancelPhrase(text: string, skillId: string): boolean {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t || t.length > 60 || t.split(' ').length > 8) return false;
    if (!CANCEL_PHRASES.some(re => re.test(t))) return false;
    const named = NOUNS.filter(n => n.re.test(t));
    return named.length === 0 || named.some(n => n.skills.test(skillId));
}

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1));

/**
 * Is `next` essentially the same question as `previous`? Used for the "questions in a row" limit: only asking the SAME
 * thing again counts as not moving forward. A new question (property, then time, then room) is progress.
 */
export function sameQuestion(previous: string, next: string): boolean {
    const a = words(previous), b = words(next);
    if (!a.size || !b.size) return previous.trim().toLowerCase() === next.trim().toLowerCase();
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / (a.size + b.size - shared) >= 0.6;
}
