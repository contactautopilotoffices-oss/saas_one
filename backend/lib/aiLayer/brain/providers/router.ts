/**
 * One BrainModel for every model id: 'anthropic:…' goes to Claude (the brain's key pool), everything else to the
 * OpenAI-compatible adapter. Which models are tried, and in what order, is NOT decided here: it is the chain saved in
 * the Control Center ("AI models" → Unified brain), read by the turn through deps.chain().
 */
import type { BrainModel, ModelCall } from '../types';
import { ANTHROPIC_PREFIX, anthropicBrainModel, brainClaudeKeys } from './anthropic';
import { liveEndpoint, openAiCompatBrainModel } from './openaiCompat';

export function routedBrainModel(parts: { claude: BrainModel; other: BrainModel }): BrainModel {
    return { call: (req: ModelCall) => (req.model.startsWith(ANTHROPIC_PREFIX) ? parts.claude : parts.other).call(req) };
}

/** The live model: Claude keys in the org's chosen order, backups through their own keys. */
export function liveBrainModel(keyOrder: readonly number[] = [1, 2]): BrainModel {
    return routedBrainModel({
        claude: anthropicBrainModel({ keys: () => brainClaudeKeys(keyOrder) }),
        other: openAiCompatBrainModel({ endpoint: liveEndpoint }),
    });
}
