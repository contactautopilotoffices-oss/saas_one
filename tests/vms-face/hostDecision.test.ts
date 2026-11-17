import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostSpoke, parseHostDecision } from '../../backend/lib/vms-face/hostCallPrompt';
import { toImageItem } from '../../backend/services/BioFrqService';

test('approves only on the agent\'s own fixed sentence', () => {
    const t = [
        'assistant: Neha Sharma from Infosys is at reception for an interview. Should we let them in?',
        'user: Yes, send her up.',
        'assistant: Entry approved. Thank you, goodbye.',
    ].join('\n');
    assert.equal(parseHostDecision(t), 'approved');
});

test('rejects on the rejection sentence', () => {
    assert.equal(parseHostDecision('user: nahi\nassistant: Entry rejected. Thank you, goodbye.'), 'rejected');
});

test('the host saying the phrase does not count', () => {
    assert.equal(parseHostDecision('assistant: Should we let them in?\nuser: entry approved'), 'unclear');
});

test('no confirmation sentence is unclear, never approved', () => {
    assert.equal(parseHostDecision('assistant: Sorry, should we let Neha in?\nuser: hmm\nassistant: No problem, reception will contact you. Goodbye.'), 'unclear');
    assert.equal(parseHostDecision(''), 'unclear');
    assert.equal(parseHostDecision(null), 'unclear');
});

test('the last confirmation wins if the agent corrected itself', () => {
    assert.equal(parseHostDecision('assistant: Entry approved.\nuser: wait, no!\nassistant: Entry rejected. Thank you, goodbye.'), 'rejected');
});

test('hostSpoke needs a line from the person called', () => {
    assert.equal(hostSpoke('assistant: Hello?\nassistant: Goodbye.'), false);
    assert.equal(hostSpoke('assistant: Hello?\nuser: yes'), true);
});

test('BioFRQ image item strips the data URL and keeps JPEG', () => {
    assert.deepEqual(toImageItem('data:image/jpeg;base64,QUJD'), { kind: 'image', bytes: 'QUJD', contentType: 'image/jpeg' });
});
