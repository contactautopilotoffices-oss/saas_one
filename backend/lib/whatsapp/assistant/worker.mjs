/**
 * Durable event worker. Store state + outgoing reply BEFORE sending so an AiSensy
 * retry never runs ticket creation or room booking again. The store holds a
 * cross-instance lease per sender and claims events in arrival order.
 */
export async function drainPhone(phone, { store, advance, dependencies, send, log = entry => { void entry; } }, limit = 6) {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
        const claim = await store.claim(phone);
        if (!claim) break;
        const started = Date.now();
        try {
            let reply = claim.event.reply;
            if (!reply && claim.event.status !== 'ready') {
                const step = await advance({ ...claim.event.payload, requestId: claim.event.id }, claim.event.snapshot, dependencies);
                if (step.session && !step.session.id) step.session.id = claim.event.id;
                await store.save(claim, step.session, step.reply);
                reply = step.reply;
            }
            const sent = reply ? await send(phone, reply) : { success: true };
            if (!sent.success && sent.retryable === false) {
                await store.fail(claim, sent.error || 'Permanent AiSensy configuration failure');
                log({ eventId: claim.event.id, status: 'failed', durationMs: Date.now() - started });
                // A missing campaign cannot recover by retrying and must not block a new menu.
                continue;
            }
            if (!sent.success) throw new Error(sent.error || 'AiSensy rejected reply');
            await store.finish(claim, null);
            processed++;
            log({ eventId: claim.event.id, status: 'sent', durationMs: Date.now() - started });
        } catch (error) {
            await store.finish(claim, String(error.message || error));
            log({ eventId: claim.event.id, status: 'retry', durationMs: Date.now() - started });
            // Do not overtake a failed prompt with a newer message from this sender.
            break;
        }
    }
    return processed;
}
