/**
 * The answers Meera may give vendors — the FAQ page in the Satej console.
 *
 * Stored in satej_faq (supabase/migrations/20261006000001_satej_rate_benchmark.sql),
 * seeded from her real calls and the Zoho history. Only `approved` entries reach
 * her: they are written into the "# Common questions" section of her script
 * when someone publishes the FAQ, through the same publishScript() path the
 * Caller script tab uses — so every FAQ publish is versioned and undoable.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchemaError } from '@/backend/lib/procurement/catalogAccess';
import { getVoiceScript } from './clients/bolna';
import { satejConfig } from './config';
import { withFaq } from './faqSection';
import { publishScript } from './voiceScript';

export { faqSection, withFaq, withoutFaq } from './faqSection';

const TABLE = 'satej_faq';
export const FAQ_MIGRATION = 'supabase/migrations/20261006000001_satej_rate_benchmark.sql';
export const FAQ_TOPICS = ['about_us', 'this_requirement', 'process', 'payment', 'gst', 'rates', 'objections', 'identity', 'general'] as const;

export interface FaqEntry {
    id: string;
    topic: string;
    question: string;
    answer: string;
    status: 'draft' | 'approved' | 'archived';
    source: 'calls' | 'zoho' | 'team';
    evidence: string | null;
    sortOrder: number;
    updatedBy: string | null;
    updatedAt: string;
}

function fail(error: { message: string; code?: string }): never {
    if (isMissingSchemaError(error)) throw new Error(`The FAQ is not set up yet: apply ${FAQ_MIGRATION}.`);
    throw new Error(`FAQ: ${error.message}`);
}

const toEntry = (x: Record<string, unknown>): FaqEntry => ({
    id: String(x.id), topic: String(x.topic), question: String(x.question), answer: String(x.answer),
    status: x.status as FaqEntry['status'], source: x.source as FaqEntry['source'], evidence: (x.evidence as string) ?? null,
    sortOrder: Number(x.sort_order), updatedBy: (x.updated_by_name as string) ?? null, updatedAt: String(x.updated_at),
});

export async function listFaq(organizationId: string): Promise<FaqEntry[]> {
    const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('organization_id', organizationId)
        .neq('status', 'archived').order('sort_order').order('created_at');
    if (error) fail(error);
    return (data ?? []).map(toEntry);
}

export interface FaqInput {
    topic?: string;
    question?: string;
    answer?: string;
    status?: string;
    sortOrder?: number;
}

function clean(input: FaqInput, partial: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (input.question !== undefined || !partial) {
        const q = String(input.question ?? '').trim();
        if (q.length < 3) throw new Error('Write the question the way vendors ask it');
        if (q.length > 300) throw new Error('Keep the question under 300 characters');
        out.question = q;
    }
    if (input.answer !== undefined || !partial) {
        const a = String(input.answer ?? '').trim();
        if (a.length < 3) throw new Error('Write the answer Meera should give');
        if (a.length > 600) throw new Error('Keep the answer under 600 characters: two short sentences is what works on a call');
        out.answer = a;
    }
    if (input.topic !== undefined) out.topic = (FAQ_TOPICS as readonly string[]).includes(String(input.topic)) ? input.topic : 'general';
    if (input.status !== undefined) {
        if (!['draft', 'approved', 'archived'].includes(String(input.status))) throw new Error('Unknown status');
        out.status = input.status;
    }
    if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) out.sort_order = Math.round(Number(input.sortOrder));
    return out;
}

export async function createFaq(organizationId: string, input: FaqInput, by: string): Promise<FaqEntry> {
    const row = { organization_id: organizationId, source: 'team', status: 'draft', sort_order: 500, ...clean(input, false), updated_by_name: by };
    const { data, error } = await supabaseAdmin.from(TABLE).insert(row).select('*').single();
    if (error) fail(error);
    return toEntry(data);
}

export async function updateFaq(organizationId: string, id: string, input: FaqInput, by: string): Promise<FaqEntry> {
    const patch = { ...clean(input, true), updated_by_name: by, updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq('organization_id', organizationId).eq('id', id).select('*').maybeSingle();
    if (error) fail(error);
    if (!data) throw new Error('FAQ entry not found');
    return toEntry(data);
}

/** Put the approved FAQ into Meera's live script. Versioned like any script publish. */
export async function publishFaq(organizationId: string, by: { id: string; name: string }) {
    const agentId = satejConfig.bolnaAgentId;
    if (!agentId) throw new Error('SATEJ_BOLNA_AGENT_ID is not set');
    const [entries, live] = await Promise.all([listFaq(organizationId), getVoiceScript(agentId)]);
    const prompt = withFaq(live.prompt, entries);
    if (prompt === live.prompt) throw new Error('Meera already has this FAQ');
    const n = entries.filter((e) => e.status === 'approved').length;
    return publishScript(organizationId, { welcome: live.welcome, prompt, note: `FAQ published: ${n} approved answer(s)` }, by);
}
