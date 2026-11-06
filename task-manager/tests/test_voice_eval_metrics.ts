/**
 * Voice Note Intake — Phase 5: the evaluation's scoring helpers and case file (100% OFFLINE).
 * Run: npx tsx task-manager/tests/test_voice_eval_metrics.ts
 */
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const M = await import('../voice/eval/metrics');
    const { loadVoiceEvalCases } = await import('../voice/eval/cases');

    console.log('\n1. Normalising');
    check('"45,000 rupees" → "45000 rupees"; "5PM" → "5 pm"; punctuation dropped', M.normalizeForCompare('Uh, PO of 45,000 rupees by 5PM!') === 'uh po of 45000 rupees by 5 pm', M.normalizeForCompare('Uh, PO of 45,000 rupees by 5PM!'));
    check('fillers removed as whole words only ("na" not in "naya")', M.stripFillers('Umm, AC repair ka jo task tha na, usko completed mark kardo.', ['umm', 'na']) === 'ac repair ka jo task tha usko completed mark kardo'
        && M.stripFillers('Ek naya task', ['na']) === 'ek naya task');

    console.log('\n2. Error rates');
    check('identical → WER 0, CER 0', M.wer('kal subah 10 baje', 'Kal subah, 10 baje.') === 0 && M.cerNoSpaces('a b', 'ab') === 0);
    check('one word wrong of four → WER 0.25', M.wer('kal subah 10 baje', 'kal subah 11 baje') === 0.25);
    check('"kar do" vs "kardo": WER counts it, space-free CER does not', M.wer('schedule kardo', 'schedule kar do') > 0 && M.cerNoSpaces('schedule kardo', 'schedule kar do') === 0);
    check('empty reference edge cases', M.wer('', '') === 0 && M.wer('', 'x') === 1);

    console.log('\n3. Key details');
    check('a plain word, a plural, a number with a comma', M.keepsDetail('Mark the office chairs task', 'office chair') && M.keepsDetail('PO of 45,000', '45000') && M.keepsDetail('by 5 PM', '5'));
    check('"a|b" spellings: any one counts', M.keepsDetail('agle Monday ko', 'somwar|monday') && !M.keepsDetail('agle mangal ko', 'somwar|monday'));
    check('whole words only: "po" is not found inside "report" / "pending"', !M.keepsDetail('send the report, pending', 'po'));
    check('"5" is not found inside "45"', !M.keepsDetail('45 rupees', '5'));
    const r = M.keyRecall('Rohit ke saath call', ['rohit', 'vendor call', 'kal']);
    check('recall counts and lists what is missing', r.kept === 1 && r.total === 3 && r.missing.join() === 'vendor call,kal', r);
    check('median / mean', M.median([3, 1, 2]) === 2 && M.median([1, 2, 3, 4]) === 2.5 && M.mean([1, 2, 3]) === 2);

    console.log('\n4. The owner\'s ground-truth file');
    const cases = loadVoiceEvalCases(path.resolve(__dirname, '../..'));
    check('20 cases read from tests/voice_samples/transcripts.md, in order', cases.length === 20 && cases.every((c, i) => c.id === i + 1));
    check('5 English, 10 Hinglish, 5 Hindi', cases.filter(c => c.language === 'English').length === 5 && cases.filter(c => c.language === 'Hinglish').length === 10 && cases.filter(c => c.language === 'Hindi').length === 5);
    check('every truth already contains every key detail (the expectations are consistent)', cases.every(c => M.keyRecall(c.truth, c.mustKeep).kept === c.mustKeep.length),
        cases.filter(c => M.keyRecall(c.truth, c.mustKeep).kept !== c.mustKeep.length).map(c => [c.id, M.keyRecall(c.truth, c.mustKeep).missing]));
    check('every listed filler really is in its truth', cases.every(c => c.fillers.every(f => ` ${M.normalizeForCompare(c.truth)} `.includes(` ${f} `))));

    console.log(failures === 0 ? '\nALL VOICE EVAL METRIC CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
