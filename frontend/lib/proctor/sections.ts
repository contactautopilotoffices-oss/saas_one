// Sections a test is divided into, like the sections of a form: a title, a
// description the candidate reads, and the questions under it. Authors can
// rename these, add their own, or remove any of them; these are just the ones
// a new test starts with.

export const DEFAULT_SECTIONS = [
    { key: 'cognitive', title: 'Cognitive ability', description: 'Reasoning with numbers, patterns and words.' },
    { key: 'aptitude', title: 'Aptitude', description: 'The arithmetic of the job: costs, percentages, capacity.' },
    { key: 'culture', title: 'Workplace culture', description: 'How you work with a team, and what you do when something is not right.' },
    { key: 'situational', title: 'Situational judgement', description: 'Real situations. Pick what you would actually do.' },
] as const;

export type ProctorSectionKey = (typeof DEFAULT_SECTIONS)[number]['key'] | 'general';

/** Fallback label for a section key with no title saved against it. */
export function sectionLabel(key: string | undefined | null) {
    return DEFAULT_SECTIONS.find((s) => s.key === key)?.title || (key === 'general' ? 'General' : 'Questions');
}
