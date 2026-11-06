/**
 * Voice Note Intake — Phase 5 evaluation cases.
 *
 * The spoken text (ground truth) is read from tests/voice_samples/transcripts.md, the owner's file, so there is one source.
 * What THIS file adds was fixed BEFORE the first run, so it cannot be tuned to the results:
 *   • fillers    — words the owner's file says the tidy-up should drop (they are removed from the truth before comparing)
 *   • mustKeep   — the key details from the owner's "Key Elements" column; "a|b" = either spelling counts
 *   • brainIntent — what the brain should understand; null = the brain has no such intent today (reported, not scored)
 */
import fs from 'node:fs';
import path from 'node:path';

export interface VoiceEvalCase {
    id: number;
    file: string;
    language: 'English' | 'Hinglish' | 'Hindi';
    truth: string;
    fillers: string[];
    mustKeep: string[];
    brainIntent: string | null;
}

const EXTRA: Record<number, Pick<VoiceEvalCase, 'fillers' | 'mustKeep' | 'brainIntent'>> = {
    1: { fillers: [], mustKeep: ['amit', 'procurement', 'invoice', 'tomorrow', '5'], brainIntent: 'create_tasks' },
    2: { fillers: ['umm'], mustKeep: ['open tasks', 'today'], brainIntent: 'view_tasks' },
    3: { fillers: [], mustKeep: ['office chair', 'delivery', 'completed'], brainIntent: 'complete_tasks' },
    4: { fillers: [], mustKeep: ['vendor review', 'tuesday', 'thursday', '11'], brainIntent: null },            // reschedule: no brain intent
    5: { fillers: ['uh'], mustKeep: ['sharma', '45000|45 000|45 thousand', 'po'], brainIntent: 'create_tasks' },
    6: { fillers: [], mustKeep: ['kal', 'subah', '10|das', 'rohit', 'vendor call'], brainIntent: 'create_tasks' },
    7: { fillers: ['arre'], mustKeep: ['priya', 'office supplies'], brainIntent: 'create_tasks' },
    8: { fillers: [], mustKeep: ['aaj', 'pending', 'list'], brainIntent: 'view_tasks' },
    9: { fillers: ['umm', 'na'], mustKeep: ['ac repair', 'completed'], brainIntent: 'complete_tasks' },
    10: { fillers: [], mustKeep: ['25000|25 000|pachees hazaar|pachis hazar', 'invoice', 'approve', 'friday'], brainIntent: 'create_tasks' },
    11: { fillers: [], mustKeep: ['sunil', 'quotation', 'draft', '3|teen'], brainIntent: 'create_tasks' },
    12: { fillers: ['uh'], mustKeep: ['housekeeping', 'supplies', 'deadline', 'kal', '6|chhe|che'], brainIntent: null }, // reschedule
    13: { fillers: [], mustKeep: ['urgent', 'pending', 'aaj'], brainIntent: 'view_tasks' },
    14: { fillers: [], mustKeep: ['vendor payment', 'rohan', 'deepa'], brainIntent: 'hand_over_task' },
    15: { fillers: [], mustKeep: ['cafeteria', 'vendor', 'meeting', 'close'], brainIntent: 'complete_tasks' },
    16: { fillers: [], mustKeep: ['kal', 'shaam|sham', 'chaar|char|4', 'list'], brainIntent: 'create_tasks' },
    17: { fillers: [], mustKeep: ['kitne', 'kaam', 'baaki|baki', 'list'], brainIntent: 'view_tasks' },
    18: { fillers: [], mustKeep: ['pankaj', 'kal', 'subah', 'office'], brainIntent: null },                    // pass a message on: no brain intent
    19: { fillers: [], mustKeep: ['bijli', 'bill', 'tick'], brainIntent: 'complete_tasks' },
    20: { fillers: [], mustKeep: ['somwar|somvar|monday', 'inventory', 'audit'], brainIntent: 'create_tasks' },
};

/** Reads the owner's ground-truth table: | `N.ogg` | Language | "spoken text" | … | */
export function loadVoiceEvalCases(root: string): VoiceEvalCase[] {
    const md = fs.readFileSync(path.join(root, 'tests', 'voice_samples', 'transcripts.md'), 'utf8');
    const rows = [...md.matchAll(/^\|\s*`(\d+)\.ogg`\s*\|\s*(English|Hinglish|Hindi)\s*\|\s*"([^"]+)"\s*\|/gm)];
    const cases = rows.map(m => {
        const id = Number(m[1]);
        const extra = EXTRA[id];
        if (!extra) throw new Error(`no evaluation details for ${id}.ogg`);
        return { id, file: path.join(root, 'tests', 'voice_samples', 'voice', `${id}.ogg`), language: m[2] as VoiceEvalCase['language'], truth: m[3], ...extra };
    }).sort((a, b) => a.id - b.id);
    if (cases.length !== Object.keys(EXTRA).length) throw new Error(`expected ${Object.keys(EXTRA).length} cases in transcripts.md, found ${cases.length}`);
    return cases;
}
