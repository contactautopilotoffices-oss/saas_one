import Groq from 'groq-sdk';

/**
 * One webcam frame → one vision-model verdict. Called every ~20s during a
 * proctored test.
 *
 * ## Agent Spec — proctor frame check
 * 1. Workflow or agent? workflow. The path is fixed (frame → one call → verdict),
 *    so neither agent justification applies `[BAA p.115]`; default to workflow `[BAA p.104]`.
 *    No prior deterministic path exists to compare against `[BAA pp.94–95, 99]`.
 * 2. Context: one image and a fixed checklist; knows nothing about the test or the person `[BAA p.112]`.
 * 3. Cost of a false positive: low — a verdict only flags the attempt for a human; it never
 *    ends the test. So the small, fast vision model already used for SOP photo scoring `[BAA p.112]`.
 * 4. Tools: none.
 * 5. Prompt: fixed checklist, JSON only, observation written before the verdict `[BAA pp.105, 114]`, `[BAA p.97]`.
 * 6. Memory: none — frames don't repeat in a way memory helps `[BAA pp.100–103]`.
 * 7. Multi-agent: no — single call `[BAA p.116]`.
 * 8. Evaluation `[BAA pp.118–119]`: system = ai_error events; quality = UNMEASURED (frames are not
 *    stored, so verdicts cannot be hand-audited `[BAA p.98]`); tool interaction = N/A; efficiency =
 *    one call per frame, ~320px JPEG.
 * 9. Trace: every verdict is a proctor_events row `[BAA pp.119–120]`.
 * 10. Knowingly violated: L6/L5 quality axis — no rubric and no manual audit, because frames are
 *     not kept (privacy call left to the founder). Acceptable only because verdicts never act alone.
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

/** Returns a verdict, or an error string — never throws. */
export async function checkFrame(imageDataUrl: string): Promise<FrameVerdict | { error: string }> {
    const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_LAYOUT_API_KEY;
    if (!apiKey) return { error: 'AI proctoring is not configured (GROQ_API_KEY missing)' };

    try {
        const groq = new Groq({ apiKey });
        const res = await groq.chat.completions.create({
            model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
            messages: [
                { role: 'system', content: 'You respond with raw JSON only.' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: PROMPT },
                        { type: 'image_url', image_url: { url: imageDataUrl } },
                    ],
                },
            ],
            max_tokens: 1024,
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        const raw = res.choices[0]?.message?.content ?? '';
        const clean = raw
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*/gi, '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let parsed: Partial<Record<keyof FrameVerdict, unknown>> | null = null;
        try {
            parsed = JSON.parse(clean);
        } catch {
            const match = clean.match(/\{[\s\S]*\}/);
            if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
        }
        if (!parsed || typeof parsed.face_count !== 'number') {
            return { error: `Unreadable AI response: ${raw.slice(0, 200)}` };
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
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'AI check failed' };
    }
}
