/**
 * MEETINGS — the LiveKit side: join tokens and closing a room.
 *
 * LiveKit Cloud relays the audio and runs the meeting agent; FMS only mints
 * tokens. The token names the worker to dispatch, so the room a meeting's first
 * participant creates always gets an agent, and no other LiveKit room does.
 * Which persona the worker plays (Ira, …) it reads from the meeting itself.
 */

import { AccessToken, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';

/** Must match the agent_name the worker registers with (agents/meeting-agent/agent.py). */
export const MEETING_AGENT_NAME = process.env.MEETING_AGENT_NAME || 'fms-meeting-agent';

export function liveKitConfig(): { url: string; apiKey: string; apiSecret: string } | null {
    const url = (process.env.LIVEKIT_URL ?? '').trim();
    const apiKey = (process.env.LIVEKIT_API_KEY ?? '').trim();
    const apiSecret = (process.env.LIVEKIT_API_SECRET ?? '').trim();
    return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

/** What is missing, in words, so the page can say it instead of failing. */
export function setupGaps(): string[] {
    const gaps: string[] = [];
    if (!liveKitConfig()) gaps.push('LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not set, so nobody can join a room yet.');
    if (!(process.env.MEETING_AGENT_SECRET ?? '').trim()) gaps.push('MEETING_AGENT_SECRET is not set, so the agent cannot read the agenda or record decisions.');
    return gaps;
}

export async function joinToken(input: {
    room: string; identity: string; name: string; meetingId: string;
}): Promise<{ url: string; token: string }> {
    const cfg = liveKitConfig();
    if (!cfg) throw new Error('LiveKit is not configured on this deployment.');

    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity: input.identity,
        name: input.name,
        // Only for joining: a connected person stays connected. Short, so a token handed
        // out before the host ends the meeting cannot reopen the room hours later.
        ttl: '15m',
    });
    at.addGrant({ roomJoin: true, room: input.room, canPublish: true, canSubscribe: true, canPublishData: true });
    at.roomConfig = new RoomConfiguration({
        // A room left empty closes after 5 minutes; Ira leaves with the last person.
        emptyTimeout: 300,
        agents: [new RoomAgentDispatch({
            agentName: MEETING_AGENT_NAME,
            metadata: JSON.stringify({ meeting_id: input.meetingId }),
        })],
    });
    return { url: cfg.url, token: await at.toJwt() };
}

/** Disconnects everyone, Ira included. A room that is already gone is fine. */
export async function closeRoom(room: string): Promise<void> {
    const cfg = liveKitConfig();
    if (!cfg) return;
    const http = cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    try {
        await new RoomServiceClient(http, cfg.apiKey, cfg.apiSecret).deleteRoom(room);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/not.?found|does not exist/i.test(msg)) throw e;
    }
}
