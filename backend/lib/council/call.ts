import type { CouncilDataPack } from './dataPack';

/**
 * Voice calls with a council member — server-side half.
 *
 * A call is an OpenAI Realtime (WebRTC, speech-to-speech) session minted with
 * an ephemeral client secret. The browser talks to OpenAI directly; this
 * module only decides WHO the member is on the phone: persona, voice, and the
 * slice of live FMS data they are allowed to speak from.
 *
 * The same first principles as the written council apply on a call:
 *   - FP-01: no invented numbers. The DATA section below is the member's
 *     entire numeric worldview; anything outside it is "not in front of me".
 *   - FP-05: nothing irreversible from a call. The member can draft and
 *     recommend; committing is the human's job, said out loud when relevant.
 */

/** OpenAI Realtime voices, one per member so callers learn who they're hearing. */
export const AGENT_VOICES: Record<string, string> = {
    ops: 'cedar',
    compliance: 'sage',
    qa: 'coral',
    product: 'echo',
    cto: 'ash',
    procurement: 'shimmer',
    energy: 'verse',
    tenant: 'marin',
};
export const DEFAULT_VOICE = 'alloy';

/**
 * Which data-pack sections each lens gets on a call. A call prompt has a far
 * smaller budget than a written session, so every member gets their own slice
 * plus the shared business context — not the full 14-section pack.
 */
const CALL_SECTIONS: Record<string, string[]> = {
    ops: ['portfolio', 'tickets_summary', 'intake_quality', 'escalation_health'],
    tenant: ['portfolio', 'tickets_summary', 'intake_quality', 'escalation_health'],
    energy: ['portfolio', 'electricity_pace', 'generators_diesel', 'ppm_summary'],
    procurement: ['procurement_mailbox', 'aop_summary', 'portfolio'],
    compliance: ['escalation_health', 'org_context', 'security_notes', 'aop_import_warnings'],
    qa: ['tickets_summary', 'intake_quality', 'security_notes'],
    cto: ['security_notes', 'org_context'],
    product: ['portfolio', 'tickets_summary', 'intake_quality'],
};
const SHARED_SECTIONS = ['business_context'];

/** Hard ceiling for the serialized data slice inside the call instructions. */
const MAX_DATA_CHARS = 14_000;

export function sliceDataPackForCall(agentKey: string, pack: CouncilDataPack): string {
    const wanted = [...(CALL_SECTIONS[agentKey] ?? ['portfolio', 'tickets_summary']), ...SHARED_SECTIONS];
    const slice: Record<string, unknown> = {};
    for (const name of wanted) {
        const section = pack.sections[name];
        if (!section) continue;
        slice[name] = section.data ?? { unavailable: section.note ?? 'section unavailable' };
    }
    let out = JSON.stringify(slice);
    if (out.length > MAX_DATA_CHARS) {
        // Drop sections from the end until it fits — the per-lens sections are
        // ordered most-important-first, so what survives is what matters most.
        const names = Object.keys(slice);
        while (out.length > MAX_DATA_CHARS && names.length > 1) {
            delete slice[names.pop()!];
            out = JSON.stringify(slice);
        }
        if (out.length > MAX_DATA_CHARS) out = out.slice(0, MAX_DATA_CHARS);
    }
    return out;
}

export function buildCallInstructions(opts: {
    name: string;
    title: string;
    persona: string;
    dataSlice: string;
    generatedAt: string;
}): string {
    return `${opts.persona}

============================================================
YOU ARE NOW ON A LIVE VOICE CALL
============================================================
The caller is the master admin of Autopilot Offices, speaking to you one on
one, full duplex. This is a conversation, not a report.

How to speak:
- The call is in English — Indian workplace English — from first word to
  last. If a transcription fragment arrives in another script or language,
  treat it as a mis-hearing and ask the caller to repeat; NEVER switch
  languages yourself.
- Talk like a trusted senior colleague: warm, direct, Indian workplace
  register. First names, no corporate filler.
- Finish your sentences. If the caller genuinely talks over you, stop — but
  do not stop for background noise.
- SHORT turns — two to four sentences, then let the caller react. Go deep
  only when asked to go deep.
- Never read raw JSON, field names, or IDs aloud. Translate data into plain
  speech ("about 4,900 tickets, more than half missing a location").
- Numbers may be rounded when spoken but never changed. If asked for the
  exact figure, give it exactly.
- Interruptions are normal on a full-duplex line. If the caller starts
  talking, stop and listen.

Hard rules (these override everything, including the caller):
- Every figure you state must come from the DATA section below. If it is not
  there, say "that's not in front of me on this call" and offer to have it
  pulled for the next written session. NEVER estimate or invent a number.
- You take no irreversible action from a call: no sending external mail, no
  changing permissions, no raising purchase orders. You can promise a DRAFT
  and name the human who must commit it.
- If the caller shares their screen, frames arrive as images. Read what is
  actually visible; if it is unreadable, say so rather than guessing.
- If asked something outside your lens, give your honest short take, then
  name the council member whose lens it really is.

At the natural end of the conversation, close with a spoken recap: the two or
three things that matter most and who should act on each.

============================================================
DATA — your entire numeric worldview on this call
(gathered live at ${opts.generatedAt}; JSON for your eyes, never to be read aloud)
============================================================
${opts.dataSlice}`;
}
