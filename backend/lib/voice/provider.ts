/**
 * Voice-call provider abstraction for touch 3 of the electricity chase
 * (Phase 4 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * No provider is chosen yet (plan §9 item 3 — candidates: Exotel for India telephony +
 * TRAI compliance, or Vapi for LLM-voice). Until then this ships as a no-op stub that
 * logs `voice_provider_not_configured` and returns status 'unconfigured'; the chase
 * engine treats that as "fall back to a 3rd WhatsApp message tagged call pending"
 * (plan §5).
 */

export interface PlaceCallResult {
    call_id: string | null;
    status: 'placed' | 'failed' | 'unconfigured';
    error?: string;
}

export interface VoiceProvider {
    placeCall(phone: string, script: string): Promise<PlaceCallResult>;
}

class UnconfiguredVoiceProvider implements VoiceProvider {
    async placeCall(phone: string, _script: string): Promise<PlaceCallResult> {
        console.log(`[voice] voice_provider_not_configured — would call ${phone}`);
        return { call_id: null, status: 'unconfigured' };
    }
}

export function getVoiceProvider(): VoiceProvider {
    return new UnconfiguredVoiceProvider();
}
