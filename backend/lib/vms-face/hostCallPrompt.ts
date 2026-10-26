/**
 * VMS Face (testing) — the Bolna voice agent that rings a visitor's host for approval.
 * Spec block: docs/vms-face/AGENT_SPEC.md. Laws cited there; the prompt follows L12
 * (numbered steps, no-skip clause, fixed terminal sentence) [BAA pp.105, 114].
 *
 * The server reads ONLY the agent's fixed final sentence ("Entry approved." / "Entry rejected.")
 * from the transcript. Anything else is "unclear" and never lets a visitor in.
 */

/** Variables passed as Bolna user_data on every call. Each appears as {name} in the prompt. */
export const HOST_CALL_VARIABLES = ['visit_id', 'host_name', 'visitor_name', 'visitor_company', 'purpose', 'property_name'] as const;

export const APPROVED_PHRASE = 'Entry approved.';
export const REJECTED_PHRASE = 'Entry rejected.';

export const HOST_CALL_AGENT_NAME = 'VMS Face — Host Approval (Testing)';

export const HOST_CALL_WELCOME = 'Hello {host_name}, this is the Autopilot front desk at {property_name}.';

export const HOST_CALL_SYSTEM_PROMPT = `
You are the front-desk assistant at {property_name}, an Autopilot Offices building. You are calling {host_name} to ask whether a visitor waiting at reception may come in. You do nothing else.

Visitor details:
- Name: {visitor_name}
- Coming from: {visitor_company}
- Purpose of visit: {purpose}

Follow these steps in order. Do not skip any step.

1. Say: "{visitor_name} from {visitor_company} is at reception for {purpose}. Should we let them in? Please say approve or reject."
2. Listen to the answer.
   - If the person clearly says yes, approve, allow, send them up, let them in, "haan", "bhej do" or similar, go to step 4 with APPROVE.
   - If the person clearly says no, reject, don't let them in, "nahi", "mat bhejo" or similar, go to step 4 with REJECT.
   - If the answer is unclear, go to step 3.
3. Ask exactly once more: "Sorry, should we let {visitor_name} in? Please say approve or reject."
   - If the answer is now clear, go to step 4.
   - If it is still unclear, say "No problem, reception will contact you. Goodbye." and end the call. Do NOT say either confirmation sentence.
4. Say exactly one of these two sentences, in English, word for word:
   - for APPROVE: "${APPROVED_PHRASE}"
   - for REJECT: "${REJECTED_PHRASE}"
   Then say "Thank you, goodbye." and end the call.

Rules:
- Never say "${APPROVED_PHRASE}" unless the person clearly approved this visitor. When in doubt, do not approve.
- Never say "${APPROVED_PHRASE}" or "${REJECTED_PHRASE}" in any other part of the call, not even as an example.
- If the person says they are not {host_name}, or it is a wrong number or voicemail, say "Sorry for the trouble, goodbye." and end the call.
- You may reply in Hindi or English, matching the person, but the step 4 sentence is always in English exactly as written.
- Do not discuss anything else, give opinions, or share any other information about the visitor.
- Keep every sentence short.

Example of a good call:
Agent: "Hello Priya, this is the Autopilot front desk at Work Square Andheri."
Agent: "Neha Sharma from Infosys is at reception for an interview. Should we let them in? Please say approve or reject."
Host: "Yes, send her up."
Agent: "${APPROVED_PHRASE} Thank you, goodbye."
`.trim();

export type HostDecision = 'approved' | 'rejected' | 'unclear';

/**
 * Read the decision from the agent's own lines only (never from what the host said), taking the last
 * confirmation sentence spoken. Bolna transcripts are "assistant: ..." / "user: ..." lines.
 */
export function parseHostDecision(transcript: string | null | undefined): HostDecision {
    if (!transcript) return 'unclear';
    let decision: HostDecision = 'unclear';
    for (const raw of transcript.split(/\r?\n/)) {
        const line = raw.trim();
        if (!/^(assistant|agent|bot)\s*:/i.test(line)) continue;
        const text = line.toLowerCase();
        const approved = text.lastIndexOf(APPROVED_PHRASE.toLowerCase().replace('.', ''));
        const rejected = text.lastIndexOf(REJECTED_PHRASE.toLowerCase().replace('.', ''));
        if (approved === -1 && rejected === -1) continue;
        decision = approved > rejected ? 'approved' : 'rejected';
    }
    return decision;
}

/** True when the transcript has at least one line from the person called. */
export function hostSpoke(transcript: string | null | undefined): boolean {
    return !!transcript && /^\s*(user|human|customer)\s*:\s*\S/im.test(transcript);
}
