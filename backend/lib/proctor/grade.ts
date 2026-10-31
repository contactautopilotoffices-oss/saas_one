import { isCorrectAnswer, type ProctorAnswer, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * Score answers (original option indexes) against the key, overall and per
 * section. Used at submit, and when an attempt is closed early (left the page,
 * too many camera warnings, reopened) so the answers given so far still count
 * as a partial score for the reviewer. A multiple-answer question scores only
 * when exactly the right options were picked.
 */
export function grade(questions: ProctorQuestion[], answers: Record<string, ProctorAnswer>) {
    const sectionScores: Record<string, { score: number; total: number }> = {};
    let score = 0;
    for (const q of questions || []) {
        const section = q.section || 'general';
        sectionScores[section] ??= { score: 0, total: 0 };
        sectionScores[section].total++;
        if (isCorrectAnswer(q, answers[q.id])) {
            score++;
            sectionScores[section].score++;
        }
    }
    return { score, total: (questions || []).length, section_scores: sectionScores };
}
