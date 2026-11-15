/**
 * Fakes for the Unified Brain tests. Nothing here touches a database, a model key, the network or WhatsApp.
 * The fake world itself (tickets, rooms, tasks, memory, audit log) lives in backend/lib/aiLayer/brain/eval/world.ts,
 * because the console's guidance test runs it too; this file adds what only the tests need: a scripted model.
 */
import type { TurnDeps, TurnInput } from '../../backend/lib/aiLayer/brain/loop/turn';
import { FakeAudit, NOW, ORG, actor, brainSettings, type FakeBrainData } from '../../backend/lib/aiLayer/brain/eval/world';
import type { Block, BrainModel, ModelCall, ModelReply } from '../../backend/lib/aiLayer/brain/types';

export {
    ANDHERI, PAREL, THANE, ORG, USER, OTHER_USER, NOW, FakeAudit, FakeBrainData, ROOM_A, ROOM_B, TASK_1, TASK_2, FILE_1, actor, brainSettings, photo, ticket, type FakeTicket,
} from '../../backend/lib/aiLayer/brain/eval/world';

// ── A scripted model ──────────────────────────────────────────────────────────────────────────────────────────────

export type Step = string | Array<{ name: string; input: unknown }> | Error | ((req: ModelCall) => string | Array<{ name: string; input: unknown }>);

/** Plays its steps in order, one per call, and records every request it was sent. */
export class ScriptedModel implements BrainModel {
    calls: ModelCall[] = [];
    private i = 0;
    constructor(private steps: Step[]) {}
    async call(req: ModelCall): Promise<ModelReply> {
        this.calls.push(JSON.parse(JSON.stringify(req)) as ModelCall);
        let step = this.steps[this.i++];
        if (step === undefined) step = 'OK.';
        if (step instanceof Error) throw step;
        if (typeof step === 'function') step = step(req);
        const blocks: Block[] = typeof step === 'string' ? [{ type: 'text', text: step }] : step.map((u, n) => ({ type: 'tool_use' as const, id: `tu_${this.i}_${n}`, name: u.name, input: u.input }));
        return { blocks, raw: blocks, stopReason: typeof step === 'string' ? 'end_turn' : 'tool_use', model: req.model, keySlot: 1, usage: { tokensIn: 1000, tokensOut: 50, cacheRead: 800, cacheWrite: 0, costUsd: 0.001 } };
    }
    /** Everything the model was shown as tool results in this turn, in order (the last call carries them all). */
    toolResults(): string[] {
        const last = this.calls.at(-1);
        return last ? last.messages.flatMap(m => m.blocks.filter(b => b.type === 'tool_result').map(b => (b as Extract<Block, { type: 'tool_result' }>).text)) : [];
    }
    lastUserText(): string {
        const last = this.calls.at(-1)!.messages.filter(m => m.role === 'user').at(-1)!;
        return last.blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
    }
}

export const call = (name: string, input: unknown = {}) => [{ name, input }];

// ── Turn plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────

export function turnDeps(data: FakeBrainData, model: BrainModel, audit: FakeAudit = new FakeAudit(), over: Partial<TurnDeps> = {}): TurnDeps {
    return { data, model, audit, chain: async () => ['anthropic:test-main', 'anthropic:test-backup'], now: () => NOW, allowMessage: () => true, ...over };
}

export function turnInput(text: string, over: Partial<TurnInput> = {}): TurnInput {
    return { actor: actor(), settings: brainSettings(), channel: 'whatsapp', text, state: null, ...over };
}

export { ORG as BRAIN_ORG };
