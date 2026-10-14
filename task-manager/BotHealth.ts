export interface BotHealthMetrics { replies: number; apologies: number; silent: number; medianReplyMs: number | null; fallbacks: number; aiFailures: number; brainMessages: number; reviewWaiting: number }

export function computeBotHealth(rows: Array<{ receivedAt: number; repliedAt: number | null; apology: boolean }>, counts: { fallbacks: number; aiFailures: number; brainMessages: number; reviewWaiting: number }): BotHealthMetrics {
    const latencies = rows.filter(r => r.repliedAt !== null).map(r => Math.max(0, r.repliedAt! - r.receivedAt)).sort((a, b) => a - b);
    const medianReplyMs = latencies.length ? (latencies.length % 2 ? latencies[(latencies.length - 1) / 2] : (latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2) : null;
    return { replies: latencies.length, apologies: rows.filter(r => r.apology).length, silent: rows.filter(r => r.repliedAt === null && !r.apology).length, medianReplyMs, ...counts };
}

export type HealthAlertKind = 'apology_spike' | 'ai_failure_spike';
export function alertKinds(m: { apologies: number; aiFailures: number; brainMessages: number }): HealthAlertKind[] {
    const out: HealthAlertKind[] = [];
    if (m.apologies >= 3) out.push('apology_spike');
    if (m.brainMessages > 0 && m.aiFailures / m.brainMessages > 0.2) out.push('ai_failure_spike');
    return out;
}
export const singleLineAlert = (text: string) => String(text || '').replace(/[\r\n]+/g, ' | ').replace(/\s+/g, ' ').trim().slice(0, 900);
