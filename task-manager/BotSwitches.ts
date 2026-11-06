import { TaskDatabaseService } from './TaskDatabaseService';

/**
 * On/off switches for the WhatsApp bot upgrades (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md), stored in the Task Manager settings
 * (the same row as Pretend Mode), so an admin can flip them from the Task Access panel WITHOUT a redeploy.
 *
 *   neverSilent         Phase 1 — note each message, apologise when no reply came
 *   conversationMemory  Phase 2 — remember the last 20 messages of each chat for 24 hours
 *   frontDoor           Phase 3 — Smart chat: exact commands without AI, "undo", no menu when the AI is down
 *   teamReports         Phase 4 — "how is my team doing today?" for anyone who can give work to others
 *   voiceNotes          WhatsApp voice notes → text → the same flow as typing (env VOICE_NOTES_ENABLED still forces it ON)
 *
 * Rules:
 *   • OFF unless switched on (in the settings, or by the old env variable, which still forces it ON).
 *   • Read at most every 30 seconds per server instance — a flip takes effect within about 30 seconds.
 *   • Settings unreadable → OFF (fail closed).
 */

export type BotSwitch = 'neverSilent' | 'conversationMemory' | 'frontDoor' | 'teamReports' | 'learningLoop' | 'promptVersions' | 'nightlyAutoTune' | 'voiceNotes';
export const BOT_SWITCHES: readonly BotSwitch[] = ['neverSilent', 'conversationMemory', 'frontDoor', 'teamReports', 'learningLoop', 'promptVersions', 'nightlyAutoTune', 'voiceNotes'];

const ENV: Record<BotSwitch, string> = {
    neverSilent: 'WHATSAPP_NEVER_SILENT_ENABLED',
    conversationMemory: 'WHATSAPP_MEMORY_ENABLED',
    frontDoor: 'WHATSAPP_FRONT_DOOR_ENABLED',
    teamReports: 'WHATSAPP_TEAM_REPORTS_ENABLED',
    learningLoop: 'WHATSAPP_LEARNING_LOOP_ENABLED',
    promptVersions: 'WHATSAPP_PROMPT_VERSIONS_ENABLED',
    nightlyAutoTune: 'WHATSAPP_NIGHTLY_AUTOTUNE_ENABLED',
    voiceNotes: 'VOICE_NOTES_ENABLED',
};

const TTL_MS = 30_000;
let cache: { at: number; value: Record<BotSwitch, boolean> } | null = null;

const OFF: Record<BotSwitch, boolean> = { neverSilent: false, conversationMemory: false, frontDoor: false, teamReports: false, learningLoop: false, promptVersions: false, nightlyAutoTune: false, voiceNotes: false };

export async function botSwitchOn(name: BotSwitch): Promise<boolean> {
    if (process.env[ENV[name]] === 'true') return true;
    const now = Date.now();
    if (!cache || now - cache.at > TTL_MS) {
        try {
            const c = await TaskDatabaseService.getTestingConfig();
            cache = { at: now, value: { neverSilent: c.neverSilentEnabled === true, conversationMemory: c.conversationMemoryEnabled === true, frontDoor: c.frontDoorEnabled === true, teamReports: c.teamReportsEnabled === true, learningLoop: c.learningLoopEnabled === true, promptVersions: c.promptVersionsEnabled === true, nightlyAutoTune: c.nightlyAutoTuneEnabled === true, voiceNotes: c.voiceNotesEnabled === true } };
        } catch {
            cache = { at: now, value: { ...OFF } };
        }
    }
    return cache.value[name];
}

/**
 * Fill the cache from a settings read that already happened (the send gate reads the same row before every message),
 * so stamping "replied" and storing memory after a send never costs a second read. Missing values → OFF.
 */
export function primeBotSwitches(values?: Partial<Record<BotSwitch, boolean>> | null): void {
    cache = { at: Date.now(), value: { neverSilent: values?.neverSilent === true, conversationMemory: values?.conversationMemory === true, frontDoor: values?.frontDoor === true, teamReports: values?.teamReports === true, learningLoop: values?.learningLoop === true, promptVersions: values?.promptVersions === true, nightlyAutoTune: values?.nightlyAutoTune === true, voiceNotes: values?.voiceNotes === true } };
}

/** Forget the cached values (after an admin flips a switch, and in tests). */
export function resetBotSwitchCache(): void {
    cache = null;
}
