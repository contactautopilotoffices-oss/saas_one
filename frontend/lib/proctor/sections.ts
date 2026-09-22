// Sections a proctored test's questions are grouped into. Pure data, shared by
// the API (validation, per-section scoring) and the pages (labels, grouping).

export const PROCTOR_SECTIONS = [
    { key: 'cognitive', label: 'Cognitive ability', hint: 'Logical, numerical and verbal reasoning' },
    { key: 'aptitude', label: 'Aptitude', hint: 'Job arithmetic: costs, percentages, capacity' },
    { key: 'culture', label: 'Workplace culture', hint: 'Ownership, honesty, teamwork' },
    { key: 'situational', label: 'Situational judgement', hint: 'What you would do, on the floor' },
    { key: 'general', label: 'General', hint: 'Anything else' },
] as const;

export type ProctorSectionKey = (typeof PROCTOR_SECTIONS)[number]['key'];

export const SECTION_KEYS = PROCTOR_SECTIONS.map((s) => s.key) as readonly string[];

export function sectionLabel(key: string | undefined | null) {
    return PROCTOR_SECTIONS.find((s) => s.key === key)?.label || 'General';
}

/** Questions grouped by section, in the canonical section order. */
export function groupBySection<T extends { section?: string }>(questions: T[]) {
    return PROCTOR_SECTIONS
        .map((s) => ({ ...s, questions: questions.filter((q) => (q.section || 'general') === s.key) }))
        .filter((g) => g.questions.length > 0);
}
