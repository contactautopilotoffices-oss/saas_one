import { campaignOptions } from '../lib/whatsapp/assistant/templates.mjs';
import { providerIds } from '../lib/whatsapp/interpreter/delivery.mjs';

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export interface AiSensyTemplateOptions {
    phone: string;
    campaignName: string;
    templateParams: string[];
    userName?: string;
    mediaUrl?: string;
    mediaFilename?: string;
}

export interface AiSensySendResult {
    success: boolean;
    error?: string;
    ambiguous?: boolean;
    providerReference?: string;
    retryable?: boolean;
    messageIds?: string[];
}

export class AiSensyService {
    /** Requires an approved template and an active API campaign in AiSensy. */
    static async sendGreeting(phone: string): Promise<AiSensySendResult> {
        return this.sendTemplate({
            phone,
            campaignName: process.env.AISENSY_GREETING_CAMPAIGN_NAME || 'fms_greeting_reply_v1',
            templateParams: [],
        });
    }

    static async sendAssistantReply(phone: string, reply: { key: string; params: string[] }): Promise<AiSensySendResult> {
        try {
            const overrides = JSON.parse(process.env.AISENSY_ASSISTANT_CAMPAIGNS || '{}');
            return await this.sendTemplate(campaignOptions(phone, reply, overrides));
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Invalid assistant campaign configuration', retryable: false };
        }
    }

    private static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        // Indian 10-digit numbers → prepend country code 91
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    /**
     * Sends a pre-approved AiSensy template (campaign) message.
     * Never throws — always resolves with { success, error? }.
     */
    static async sendTemplate(options: AiSensyTemplateOptions): Promise<AiSensySendResult> {
        const apiKey = process.env.AISENSY_API_KEY;
        const apiUrl = process.env.AISENSY_API_URL || AISENSY_API_URL;

        if (!apiKey) {
            return { success: false, error: 'AISENSY_API_KEY not configured', retryable: false };
        }

        const destination = this.formatPhone(options.phone);
        if (!destination || destination.length < 11) {
            return { success: false, error: `Invalid phone number: ${options.phone}`, retryable: false };
        }

        try {
            const bodyPayload: { apiKey: string; campaignName: string; destination: string; userName: string; templateParams: string[]; source: string; media?: { url: string; filename: string } } = {
                apiKey,
                campaignName: options.campaignName,
                destination,
                userName: options.userName ?? 'User',
                templateParams: options.templateParams,
                source: 'autopilot-fms',
            };

            if (options.mediaUrl) {
                bodyPayload.media = {
                    url: options.mediaUrl,
                    filename: options.mediaFilename || 'ticket_attachment.jpg'
                };
            }

            console.info('[AiSensy] Sending campaign', {
                campaignName: options.campaignName,
                paramCount: options.templateParams.length,
            });

            const started = Date.now();
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
                signal: AbortSignal.timeout(15_000),
            });


            const responseText = await res.text();
            console.info('[AiSensy] API response', { campaign: options.campaignName, status: res.status, durationMs: Date.now() - started });

            if (!res.ok) {
                console.error(`[AiSensy] ❌ Campaign "${options.campaignName}" failed — Status: ${res.status}`, responseText);
                return { success: false, ambiguous: res.status >= 500, error: `AiSensy HTTP ${res.status}: ${responseText}`,
                    retryable: !(res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status)) };
            }

            let messageIds: string[] = [];
            try {
                const parsed = JSON.parse(responseText);
                messageIds = providerIds(parsed);
                if (parsed.success === false) {
                    console.error(`[AiSensy] ❌ Campaign "${options.campaignName}" API error:`, parsed.message || 'unknown');
                    const error = typeof parsed.message === 'string' ? parsed.message : 'AiSensy API returned failure';
                    const permanent = /campaign.*(inactive|not active|not found|does not exist|invalid)|invalid.*campaign|template.*(not found|not approved|does not exist)/i.test(error);
                    return { success: false, error, retryable: !permanent };
                }
            } catch {
                // Non-JSON response — treat as success if HTTP was ok
            }

            return { success: true, ...(messageIds.length ? { messageIds, providerReference: messageIds[0] } : {}) };
        } catch (err: unknown) {
            console.error('[AiSensy] ❌ Network error:', err);
            return { success: false, ambiguous: true, error: err instanceof Error ? err.message : 'Network error' };
        }
    }
}
