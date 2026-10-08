/**
 * TEST ONLY — verifies AiSensy can send a free-form (non-template) WhatsApp reply
 * inside the 24h customer-service window, via the AiSensy Project (Direct) API.
 *
 * Isolated from the Facility Bot and Task Manager. Inert unless
 * AISENSY_FREEFORM_TEST_ENABLED=true. Only the exact text "test" is handled.
 *
 * Docs: https://aisensy.stoplight.io/docs/project-api/effdec8a4894f-send-message
 */

const TEST_COMMAND = 'test';
const TEST_REPLY = 'Hello Sahil! This is a test message from the Autopilot WhatsApp bot.';
const PROJECT_API_BASE = 'https://apis.aisensy.com/project-apis/v1/project';

const maskPhone = (phone: string) => phone.replace(/\d(?=\d{4})/g, '*');

/** Returns true when the message was the test command and has been handled. */
export async function handleFreeformTest(input: { phone: string; text: string }): Promise<boolean> {
    if (process.env.AISENSY_FREEFORM_TEST_ENABLED !== 'true') return false;
    if (input.text.trim().toLowerCase() !== TEST_COMMAND) return false;

    const phone = maskPhone(input.phone);
    console.info('[FreeformTest] Incoming', { phone, message: input.text });

    const projectId = process.env.AISENSY_PROJECT_ID;
    const password = process.env.AISENSY_PROJECT_API_KEY;
    if (!projectId || !password) {
        console.error('[FreeformTest] AISENSY_PROJECT_ID or AISENSY_PROJECT_API_KEY not configured');
        return true;
    }

    try {
        const res = await fetch(`${PROJECT_API_BASE}/${encodeURIComponent(projectId)}/messages`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-AiSensy-Project-API-Pwd': password,
            },
            body: JSON.stringify({
                to: input.phone,
                type: 'text',
                recipient_type: 'individual',
                text: { body: TEST_REPLY },
            }),
            signal: AbortSignal.timeout(15_000),
        });
        const responseBody = await res.text();
        console.info('[FreeformTest] Outbound', {
            phone, message: TEST_REPLY, httpStatus: res.status, ok: res.ok, responseBody,
        });
    } catch (error) {
        console.error('[FreeformTest] Network error', { phone, error: error instanceof Error ? error.message : error });
    }
    return true;
}
