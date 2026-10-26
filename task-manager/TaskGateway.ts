/**
 * Step 4 — Natural-language front door (rules-based, PURE: no imports, no I/O).
 *
 * It only DECIDES where a free-text message belongs. It never changes anything itself:
 *   - task messages are handed to the existing Task Manager commands (after a "confirm?" for any change),
 *   - room / ticket messages are handed to the existing facility bot, untouched.
 *
 * Order matters: explicit task actions first, then task questions, then facility signals, else unclear.
 */

export type GatewayDecision =
    | { kind: 'task_query' }
    | { kind: 'task_complete_all' }
    | { kind: 'task_complete'; numbers: number[]; hint: string | null }
    | { kind: 'task_assign'; targetName: string; title: string }   // targetName 'me' = the sender's own list
    | { kind: 'facility'; service: 'room' | 'ticket' }
    | { kind: 'unclear' };

const UNCLEAR: GatewayDecision = { kind: 'unclear' };

const STOP_NAMES = new Set([
    'the', 'a', 'an', 'my', 'our', 'your', 'someone', 'somebody', 'everyone', 'everybody',
    'team', 'him', 'her', 'them', 'us', 'all', 'this', 'that', 'it', 'one'
]);

const NAME = `([a-z][a-z.-]{0,30})`;
const PLEASE = `(?:please\\s+|pls\\s+)?`;

// ── Assigning a task ─────────────────────────────────────────────────────────
const ASSIGN_PATTERNS: RegExp[] = [
    // "give Satej a task to call vendor X" / "assign Satej a task: call vendor X"
    new RegExp(`^${PLEASE}(?:give|assign)\\s+${NAME}\\s+(?:a\\s+|one\\s+)?(?:new\\s+)?task\\s*(?:to|for|:|-|,)?\\s*(.{3,})$`, 'i'),
    // "add a task for Satej to call vendor X" / "create task for Satej: call vendor X"
    new RegExp(`^${PLEASE}(?:give|add|create|assign)\\s+(?:a\\s+|one\\s+)?(?:new\\s+)?task\\s+(?:to|for)\\s+${NAME}\\s*(?:to|:|-|,)?\\s*(.{3,})$`, 'i'),
    // "ask Satej to call vendor X"
    new RegExp(`^${PLEASE}ask\\s+${NAME}\\s+to\\s+(.{3,})$`, 'i'),
];

const SELF_PATTERNS: RegExp[] = [
    // "add a task: call vendor X" / "add task for me to call vendor X"
    /^(?:please\s+|pls\s+)?(?:add|create|put|make|set)\s+(?:a\s+|one\s+)?(?:new\s+)?(?:task|to-?do|todo)\s*(?:for\s+(?:me|myself)|on\s+my\s+(?:list|to-?do))?\s*(?::|-|to)?\s*(.{3,})$/i,
    // "remind me to call vendor X"
    /^(?:please\s+|pls\s+)?remind\s+me\s+to\s+(.{3,})$/i,
    // "add call vendor X to my list"
    /^(?:please\s+|pls\s+)?(?:add|put)\s+(.{3,}?)\s+(?:to|on)\s+my\s+(?:list|to-?do(?:\s+list)?|tasks?)$/i,
];

// ── Completing tasks ─────────────────────────────────────────────────────────
const LEAD = `(?:(?:hey|hi|ok|okay|so|well)[,\\s]+)?(?:i(?:'ve|\\s+have|\\s+am)?\\s+|we(?:'ve)?\\s+)?`;

const COMPLETE_ALL_PATTERNS: RegExp[] = [
    new RegExp(`^${LEAD}(?:finished|completed|done\\s+with|cleared|done)\\s+(?:with\\s+)?(?:everything|all(?:\\s+(?:of\\s+)?(?:my|the|today'?s))?(?:\\s+(?:tasks?|work|items?))?)(?:\\s+(?:for\\s+)?today)?$`),
    /^all\s+(?:my\s+|the\s+)?(?:work|tasks?)\s+(?:is|are|has\s+been|have\s+been)\s+(?:done|completed|finished)$/,
    /^mark\s+(?:all|everything)(?:\s+(?:tasks?|work))?\s+(?:as\s+)?(?:done|complete(?:d)?|finished)$/,
];

const NUMBER_LIST = `#?\\d{1,2}(?:\\s*(?:,|and|&)\\s*#?\\d{1,2})*`;
const COMPLETE_NUMBER_PATTERNS: RegExp[] = [
    new RegExp(`^${LEAD}(?:finished|completed|done(?:\\s+with)?|did|cleared)\\s+(?:tasks?\\s+)?(?:no\\.?\\s*)?(${NUMBER_LIST})$`),
    new RegExp(`^mark\\s+(?:tasks?\\s+)?(${NUMBER_LIST})\\s+(?:as\\s+)?(?:done|complete(?:d)?|finished)$`),
    new RegExp(`^(?:tasks?\\s+)?(${NUMBER_LIST})\\s+(?:is\\s+|are\\s+|has\\s+been\\s+|have\\s+been\\s+)?(?:done|completed|finished)$`),
];

const COMPLETE_HINT_PATTERNS: RegExp[] = [
    new RegExp(`^${LEAD}(?:finished|completed|done\\s+with|cleared|did|done)\\s+(?:with\\s+)?(?:the\\s+|my\\s+)?(.{3,80})$`),
    /^(?:the\s+|my\s+)?(.{3,80}?)\s+(?:is|are|has\s+been|have\s+been)\s+(?:done|completed|finished|complete)$/,
    /^mark\s+(?:the\s+|my\s+)?(.{3,80}?)\s+(?:as\s+)?(?:done|completed|complete|finished)$/,
];

// ── Asking about tasks ───────────────────────────────────────────────────────
const QUERY_PATTERNS: RegExp[] = [
    /\bwhat(?:'s|\s+is|\s+are)?\s+(?:on\s+)?(?:my\s+)?(?:plate|agenda|pending|left|remaining)\b/,
    /\bwhat\s+(?:tasks?|work)\s+do\s+i\s+have\b/,
    /\bwhat\s+do\s+i\s+(?:have|need\s+to\s+do)(?:\s+(?:today|now|pending|left|next))?$/,
    /\b(?:show|list|view|see|check|send|give|tell)\s+(?:me\s+)?(?:all\s+)?(?:my|today'?s|the)\s+(?:pending\s+|remaining\s+|open\s+)?(?:tasks?|to-?do(?:s|\s+list)?|work)\b/,
    /^(?:my\s+|today'?s\s+)?(?:to-?do|todo)(?:\s+list)?$/,
    /^(?:my\s+)?tasks?\s+(?:for\s+)?today$/,
    /\b(?:how\s+many|any)\s+(?:tasks?|work)\s+(?:do\s+i\s+have|pending|left|remaining)\b/,
    /\banything\s+(?:pending|left)\b/,
    /\bhow(?:'s|\s+is)\s+my\s+progress\b|^my\s+progress$/,
];

// ── Facility (room / ticket): handed to the existing bot untouched ───────────
const ROOM_PATTERNS: RegExp[] = [
    /\b(?:book|reserve|schedule|arrange|need|want|get|find)\b.{0,40}\b(?:meeting\s+room|conference\s+room|board\s?room|room)\b/,
    /\b(?:meeting|conference)\s+room\b/,
];
const TICKET_PATTERNS: RegExp[] = [
    /\b(?:raise|create|log|open|file|submit|register)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:ticket|complaint|issue|request)\b/,
    /\bnot\s+working\b/,
    /\b(?:leak(?:s|ing|age)?|broken|damaged|repair(?:ed|s)?|maintenance|housekeeping|plumb\w*|electrician|a\/c|ac|air\s*con(?:ditioner|ditioning)?|wi-?fi|power\s+(?:cut|outage|failure)|lift|elevator|pest|cockroach|mosquito|dirty|stinks?)\b/,
];

function tidy(title: string): string {
    return title.trim().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '').trim();
}

function validName(name: string): boolean {
    return !STOP_NAMES.has(name.toLowerCase());
}

/** Classifies a free-text message. Pure and deterministic. */
export function classifyNaturalLanguage(text: string): GatewayDecision {
    const raw = (text || '').trim();
    if (!raw || raw.length > 300) return UNCLEAR;

    const normalized = raw.replace(/[’]/g, "'").replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();
    const clean = lower.replace(/[.!?]+$/, '').trim();

    // 1. Assigning a task to someone else (or to oneself)
    for (const re of ASSIGN_PATTERNS) {
        const m = re.exec(normalized);
        if (m && validName(m[1])) {
            const title = tidy(m[2]);
            if (title.length >= 3 && title.length <= 200) {
                const who = ['me', 'myself'].includes(m[1].toLowerCase()) ? 'me' : m[1];
                return { kind: 'task_assign', targetName: who, title };
            }
        }
    }
    for (const re of SELF_PATTERNS) {
        const m = re.exec(normalized);
        if (m) {
            const title = tidy(m[1]);
            if (title.length >= 3 && title.length <= 200) return { kind: 'task_assign', targetName: 'me', title };
        }
    }

    // 2. Finished everything
    if (COMPLETE_ALL_PATTERNS.some(re => re.test(clean))) return { kind: 'task_complete_all' };

    // 3. Finished specific task number(s)
    for (const re of COMPLETE_NUMBER_PATTERNS) {
        const m = re.exec(clean);
        if (m) {
            const numbers = [...new Set((m[1].match(/\d+/g) || []).map(Number))].filter(n => n >= 1);
            if (numbers.length > 0 && numbers.length <= 5) return { kind: 'task_complete', numbers, hint: null };
        }
    }

    // 4. Finished a task described in words ("finished the vendor call")
    for (const re of COMPLETE_HINT_PATTERNS) {
        const m = re.exec(clean);
        if (m) {
            const hint = tidy(m[1]);
            if (hint.length >= 3 && !/^(?:it|that|this|them|everything|all)$/.test(hint)) {
                return { kind: 'task_complete', numbers: [], hint };
            }
        }
    }

    // 5. Asking about tasks
    if (QUERY_PATTERNS.some(re => re.test(clean))) return { kind: 'task_query' };

    // 6. Room / ticket: handed over to the existing bot
    if (ROOM_PATTERNS.some(re => re.test(clean))) return { kind: 'facility', service: 'room' };
    if (TICKET_PATTERNS.some(re => re.test(clean))) return { kind: 'facility', service: 'ticket' };

    // 7. Anything else: the caller decides what to do with an unclear message
    return UNCLEAR;
}

/** "yes" / "no" answers to a pending confirmation. Anything else returns null. */
export function parseConfirmAnswer(text: string): 'yes' | 'no' | null {
    const t = (text || '').trim().toLowerCase().replace(/[.!\s]+$/g, '');
    if (/^(?:yes|y|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|please do)$/.test(t)) return 'yes';
    if (/^(?:no|n|nope|nah|stop|don'?t|do not|never\s?mind)$/.test(t)) return 'no';
    return null;
}

/**
 * Finds which of today's tasks a spoken description refers to.
 * Returns the 1-based task number only when exactly ONE task matches best; otherwise null (caller asks).
 */
export function matchTaskByHint(hint: string, titles: string[]): number | null {
    const stop = new Set(['the', 'and', 'for', 'with', 'my', 'our', 'task', 'tasks', 'work', 'that', 'this', 'from', 'about']);
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
    const hintWords = words(hint);
    if (hintWords.length === 0) return null;

    const scores = titles.map(title => {
        const tw = new Set(words(title));
        return hintWords.filter(w => tw.has(w)).length;
    });
    const best = Math.max(...scores, 0);
    if (best === 0) return null;
    const winners = scores.map((s, i) => (s === best ? i : -1)).filter(i => i >= 0);
    return winners.length === 1 ? winners[0] + 1 : null;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Superuser questions (read-only): "how is Procurement doing?", "what is Dev working on?",
 * "who has pending tasks?". Only ever applied for superusers; the caller checks that.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export type InsightKind = 'department_progress' | 'department_tasks' | 'person_tasks' | 'subject_overview' | 'pending_tasks' | 'org_overview';

export interface InsightDecision {
    kind: InsightKind;
    /** What the superuser named: a department or a person (exactly as written). Null for company-wide questions. */
    subject: string | null;
}

const NOT_A_SUBJECT = new Set(['i', 'me', 'my', 'mine', 'we', 'you', 'it', 'this', 'that', 'everyone', 'everybody', 'all', 'everything', 'today', 'now', 'the', 'a']);

export function cleanSubject(raw: string): string | null {
    const s = raw
        .replace(/[?!.,]+$/g, '')
        .replace(/'s$/i, '')
        .replace(/^(?:show|list|get|give|see|send|tell|view|check)\s+(?:me\s+)?/i, '')
        .replace(/^(?:the|our|team)\s+/i, '')
        .replace(/\s+(?:team|department|dept|people|folks|guys)$/i, '')
        .trim();
    if (s.length < 2 || s.length > 60 || NOT_A_SUBJECT.has(s.toLowerCase())) return null;
    // "my", "me", "I": the person is talking about themselves, not about a department or someone else
    if (/\b(?:my|me|i|mine|myself)\b/i.test(s)) return null;
    return s;
}

const INSIGHT_PATTERNS: Array<{ re: RegExp; kind: InsightKind }> = [
    // company-wide first, so "how is everyone doing" is not read as a person called "everyone"
    { re: /\bhow(?:'s|\s+is|\s+are)\s+(?:everyone|everybody|everything|the\s+company|the\s+organi[sz]ation|all\s+departments?)\s+(?:doing|going|looking)\b/, kind: 'org_overview' },
    { re: /\b(?:overall|company|organi[sz]ation|all\s+departments?)\b.*\b(?:progress|status|overview|summary)\b/, kind: 'org_overview' },
    { re: /\b(?:progress|status|overview|summary)\b.*\b(?:overall|company|organi[sz]ation|all\s+departments?)\b/, kind: 'org_overview' },

    // pending across the company
    { re: /\b(?:who|which\s+(?:people|employees|team\s+members))\s+(?:has|have|is|are)\s+(?:not\s+(?:done|finished|completed)|pending|behind|late|lagging|yet\s+to\s+(?:finish|complete))\b/, kind: 'pending_tasks' },
    { re: /\b(?:anyone|anybody|someone)\s+(?:behind|pending|late|lagging)\b/, kind: 'pending_tasks' },
    { re: /\bwho\s+(?:has|have)\s+(?:any\s+)?(?:pending|unfinished|incomplete|overdue)\b/, kind: 'pending_tasks' },
    { re: /\b(?:all|everyone's|everybody's|company(?:-wide)?)\s+(?:pending|unfinished|incomplete|overdue)\s+tasks\b/, kind: 'pending_tasks' },

    // a department or a person: "how is X doing", "what is X working on", "X's tasks"
    // (.{2,60}?) is the name of the department or person; it is cleaned and checked against real data afterwards
    { re: /\bwhat(?:'s|\s+is|\s+are)\s+(.{2,60}?)\s+(?:working\s+on|doing|up\s+to|busy\s+with)\b/, kind: 'subject_overview' },
    { re: /\bhow(?:'s|\s+is|\s+are)\s+(.{2,60}?)\s+(?:doing|going|performing|progressing|getting\s+on)(?:\s+(?:today|now))?$/, kind: 'subject_overview' },
    { re: /\b(?:progress|status|update)\s+(?:of|for|on)\s+(.{2,60}?)$/, kind: 'subject_overview' },
    { re: /^(.{2,60}?)\s+(?:progress|status|update)$/, kind: 'subject_overview' },
    { re: /\b(?:show|list|get|see|send|tell|view)\s+(?:me\s+)?(.{2,60}?)(?:'s)?\s+(?:tasks?|to-?do(?:s)?|work)\b/, kind: 'subject_overview' },
    { re: /\bgive\s+me\s+(.{2,60}?)(?:'s)?\s+(?:tasks?|to-?do(?:s)?|work)\b/, kind: 'subject_overview' },
    { re: /\btasks?\s+(?:of|for|assigned\s+to)\s+(.{2,60}?)$/, kind: 'subject_overview' },
    { re: /^(.{2,60}?)(?:'s)?\s+tasks?$/, kind: 'subject_overview' },
];

/** Recognises a superuser's read-only question. Pure. Returns null when it is not one (the caller may try the AI). */
export function classifyInsight(text: string): InsightDecision | null {
    const raw = (text || '').trim();
    if (!raw || raw.length > 300) return null;
    const clean = raw.replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/[?!.]+$/, '').toLowerCase();

    // "give Satej a task …" is an assignment, never a question
    if (/\b(?:a|one|new)\s+task\b/.test(clean)) return null;

    for (const { re, kind } of INSIGHT_PATTERNS) {
        const m = re.exec(clean);
        if (!m) continue;
        if (kind === 'org_overview' || kind === 'pending_tasks') return { kind, subject: null };
        const subject = cleanSubject(m[1] || '');
        if (subject) return { kind, subject };
    }
    return null;
}

/* ── Matching a spoken name against real people / departments ─────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Best matches for a name, in this order: the exact full name, the exact first name, any name containing it.
 * Returns EVERY candidate at the best level, so two people called Rajesh come back as two (never silently one).
 */
export function matchByName<T extends { name: string }>(query: string, people: T[]): T[] {
    const q = norm(query);
    if (!q) return [];
    const full = people.filter(p => norm(p.name) === q);
    if (full.length) return full;
    const first = people.filter(p => norm(p.name).split(' ')[0] === q);
    if (first.length) return first;
    return people.filter(p => norm(p.name).includes(q));
}

/** A numbered answer ("2") to a "Which one?" question. */
export function parsePick(text: string, max: number): number | null {
    const m = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(text || '');
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 1 && n <= max ? n : null;
}
