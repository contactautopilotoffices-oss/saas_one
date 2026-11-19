/**
 * The ONLY place the brain sends a WhatsApp message from.
 *
 * A reply goes out through the Task Manager's sender, which already honours its kill switches and Pretend Mode. On top
 * of that, this module refuses to send at all while a test is running: no test, check or script may ever put a message
 * on someone's WhatsApp (owner 2026-11-13). Scripts that must never send can also set AI_BRAIN_NO_SEND=true.
 */

/** True while a test runner is driving this process. */
export function inTestRun(env: Record<string, string | undefined> = process.env): boolean {
    return !!env.NODE_TEST_CONTEXT || env.NODE_ENV === 'test' || env.AI_BRAIN_NO_SEND === 'true';
}

export async function sendBrainReply(phone: string, text: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
    if (inTestRun(env)) {
        console.warn('[Brain] refusing to send a WhatsApp message during a test run');
        return false;
    }
    const { TaskMessagingService } = await import('@/task-manager/TaskMessagingService');
    return TaskMessagingService.sendFreeformReply(phone, text);
}

/** sendBrainReply, also returning the ids of the sent message so a later swipe-reply can be matched (2026-11-18). */
export async function sendBrainReplyTracked(phone: string, text: string, env: Record<string, string | undefined> = process.env): Promise<{ sent: boolean; messageIds: string[] }> {
    if (inTestRun(env)) {
        console.warn('[Brain] refusing to send a WhatsApp message during a test run');
        return { sent: false, messageIds: [] };
    }
    const { TaskMessagingService } = await import('@/task-manager/TaskMessagingService');
    // A long reply (a joined task list, 2026-11-18) goes in parts, split the same way the task assistant splits its own.
    const { splitLongReply } = await import('@/task-manager/brain/text');
    const ids: string[] = [];
    let sent = true;
    for (const part of splitLongReply(text)) {
        const r = await TaskMessagingService.sendFreeformReplyTracked(phone, part);
        sent = sent && r.sent; ids.push(...r.messageIds);
    }
    return { sent, messageIds: ids };
}
