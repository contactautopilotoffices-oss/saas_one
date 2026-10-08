import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

test('runtime interpretation logging accepts success and provider-error result shapes', async () => {
    const runtime = await readFile(new URL('../backend/lib/whatsapp/assistant/runtime.ts', import.meta.url), 'utf8');
    const statement = runtime.match(/console\.info\('\[WhatsAppInterpreter\]'[^;]+;/)?.[0];
    assert.ok(statement, 'Runtime interpretation log must exist');
    const directory = await mkdtemp(join(tmpdir(), 'whatsapp-log-types-'));
    try {
        const file = join(directory, 'logging.ts');
        await writeFile(file, `
            declare const console: { info(...args: unknown[]): void };
            declare const Date: { now(): number };
            declare const turn: { workflow: string };
            declare const started: number;
            declare const result: { ok: boolean; reason: string } |
                { ok: boolean; intent: 'details' | 'unclear' | 'unrelated'; reason?: undefined };
            ${statement}
        `);
        const program = ts.createProgram([file], { strict: true, noEmit: true, noLib: true, types: [] });
        const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName === file);
        assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), []);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
