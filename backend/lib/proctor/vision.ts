import { resolveProvider } from '@/backend/lib/council/llm';
import { visionExtract, DEFAULT_VISION_MODEL } from '@/backend/lib/ocr/vision';

/**
 * One webcam frame → one vision-model verdict. Called every ~10s during a
 * proctored test.
 *
 * Goes through the repo's existing vision helper (backend/lib/ocr/vision.ts),
 * so it rides whichever provider this deployment is configured for — today
 * ENGY (COUNCIL_PROVIDER=custom, api.engy.ai) — instead of a second client
 * with its own key `[BAA p.89]`. The helper takes buffers, never URLs, because
 * ENGY rejects external image URLs.
 *
 * ## Agent Spec — proctor frame check
 * 1. Workflow or agent? workflow. The path is fixed (frame → one call → verdict),
 *    so neither agent justification applies `[BAA p.115]`; default to workflow `[BAA p.104]`.
 *    No prior deterministic path exists to compare against `[BAA pp.94–95, 99]`.
 * 2. Context: one image and a fixed checklist; knows nothing about the test or the person `[BAA p.112]`.
 * 3. Cost of a false positive: medium — every flagged category (no face, looking away, a phone,
 *    a second face) warns the taker and counts as a strike, and at the test's strike limit
 *    (default 3) the attempt closes, using up a chance. One misread frame does not end a test,
 *    and the frames for phone/second-face are kept for a human to overrule. Still the cheap,
 *    fast multimodal tier `[BAA p.112]`, because the 10s cadence rules out slower models:
 *    glm-5.3-flash on ENGY, measured at 3–10s and ~500 tokens a frame (≈₹0.8 for a 30-minute
 *    test at the old 20s cadence; ≈₹1.6 at 10s). qwen3.8-27b is cheaper but ran a steady 15s,
 *    too slow for a 10s cadence. At most one strike per 20s, so a burst of misread frames
 *    can't close a test in seconds.
 * 4. Tools: none.
 * 5. Prompt: fixed checklist, JSON only, observation written before the verdict `[BAA pp.105, 114]`, `[BAA p.97]`.
 * 6. Memory: none — frames don't repeat in a way memory helps `[BAA pp.100–103]`.
 * 7. Multi-agent: no — single call `[BAA p.116]`.
 * 8. Evaluation `[BAA pp.118–119]`: system = ai_error events; quality = PARTIAL — hand-checked on
 *    four stills (logo, cartoon face, empty building, building full of people): 0 faces, 0, 0 and
 *    12 respectively, all flagged correctly. The case that matters most — one real person at a
 *    laptop, NOT flagged — is still unverified, and frames are not stored, so verdicts cannot be
 *    audited after the fact `[BAA p.98]`; tool interaction = N/A; efficiency = one call per frame.
 * 9. Trace: every verdict is a proctor_events row `[BAA pp.119–120]`.
 * 10. Knowingly violated: L6 — no rubric grader and no ~5% manual audit behind those numbers.
 *     L10 — the false-positive cost rose (strikes can close an attempt) but the model tier did
 *     not `[BAA p.112]`; the strike limit is the only buffer. Close the item-8 gap (one real
 *     person at a laptop, NOT flagged) before relying on this for hiring decisions.
 */

export interface FrameVerdict {
    observation: string;
    face_count: number;
    looking_at_screen: boolean;
    phone_or_device_visible: boolean;
    flagged: boolean;
    reason: string;
}

const PROMPT = `You are proctoring an online test. The image is a webcam frame of the person taking it.

Check, in this order:
1. How many human faces are visible? (0, 1, 2, ...)
2. Is the person facing the screen (roughly toward the camera), not turned away or looking down at something?
3. Is a phone, tablet, second screen, book or paper being looked at or held?

Flag the frame if: no face, more than one face, the person is clearly turned away, or a phone/device/notes are in use.
Do not flag for poor lighting, glasses, a normal blink, or a slight head tilt.

Return ONLY raw JSON, no markdown:
{"observation":"<one sentence on what you see>","face_count":<int>,"looking_at_screen":<bool>,"phone_or_device_visible":<bool>,"flagged":<bool>,"reason":"<short reason if flagged, else empty>"}`;

/**
 * Vision model per provider. A model id is provider-specific, so the ENGY
 * default cannot be sent to OpenAI or Groq — pick one the provider actually
 * serves, or set PROCTOR_VISION_MODEL to override everywhere.
 */
function modelForProvider(provider: string): string {
    if (process.env.PROCTOR_VISION_MODEL) return process.env.PROCTOR_VISION_MODEL;
    if (provider === 'groq') return process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
    if (provider === 'openai') return 'gpt-4o-mini';
    return DEFAULT_VISION_MODEL; // custom (ENGY): glm-5.3-flash
}

/** Returns a verdict, or an error string — never throws. */
export async function checkFrame(imageDataUrl: string): Promise<FrameVerdict | { error: string }> {
    const base64 = imageDataUrl.split(',')[1] || '';
    if (!base64) return { error: 'Frame was empty' };

    const { provider } = resolveProvider();
    const result = await visionExtract({
        pages: [{ buffer: Buffer.from(base64, 'base64'), mime: 'image/jpeg' }],
        instruction: PROMPT,
        model: modelForProvider(provider),
        json: true,
        maxTokens: 1024,
    });

    if (!result.ok) return { error: result.error || 'AI check failed' };

    let parsed = result.data as Partial<Record<keyof FrameVerdict, unknown>> | null;
    if (!parsed || typeof parsed.face_count !== 'number') {
        // Some models wrap the JSON in <think> reasoning; strip it and retry once.
        const clean = (result.text || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*/gi, '')
            .replace(/```json/gi, '')
            .replace(/```/g, '');
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }
    if (!parsed || typeof parsed.face_count !== 'number') {
        return { error: `Unreadable AI response: ${(result.text || '').slice(0, 200)}` };
    }

    const faceCount = Math.max(0, Math.round(parsed.face_count as number));
    const looking = parsed.looking_at_screen !== false;
    const device = parsed.phone_or_device_visible === true;
    // Re-derive the flag from the fields so a model that says "2 faces" but
    // "flagged: false" is still caught.
    const flagged = parsed.flagged === true || faceCount !== 1 || !looking || device;

    let reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    if (flagged && !reason) {
        reason = faceCount === 0 ? 'No face in frame'
            : faceCount > 1 ? 'More than one person in frame'
            : device ? 'Phone or device visible'
            : 'Looking away from the screen';
    }

    return {
        observation: typeof parsed.observation === 'string' ? parsed.observation : '',
        face_count: faceCount,
        looking_at_screen: looking,
        phone_or_device_visible: device,
        flagged,
        reason: flagged ? reason : '',
    };
}
