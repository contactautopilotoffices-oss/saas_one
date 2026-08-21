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
}

export class AiSensyService {
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
        const apiUrl = process.env.AISENSY_API_URL || 'https://backend.aisensy.com/campaign/t1/api/v2';

        if (!apiKey) {
            return { success: false, error: 'AISENSY_API_KEY not configured' };
        }

        const destination = this.formatPhone(options.phone);
        if (!destination || destination.length < 11) {
            return { success: false, error: `Invalid phone number: ${options.phone}` };
        }

        try {
            const bodyPayload: any = {
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

            console.log('[AiSensy Outgoing Payload]:', JSON.stringify({
                campaignName: options.campaignName,
                destination,
                templateParams: options.templateParams,
                paramCount: options.templateParams?.length
            }, null, 2));

            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
            });


            const responseText = await res.text();

            if (!res.ok) {
                console.error(`[AiSensy] ❌ Campaign "${options.campaignName}" failed — Status: ${res.status}`, responseText);
                return { success: false, error: `AiSensy HTTP ${res.status}: ${responseText}` };
            }

            try {
                const parsed = JSON.parse(responseText);
                if (parsed.success === false) {
                    console.error(`[AiSensy] ❌ Campaign "${options.campaignName}" API error:`, parsed.message || 'unknown');
                    return { success: false, error: parsed.message || 'AiSensy API returned failure' };
                }
            } catch {
                // Non-JSON response — treat as success if HTTP was ok
            }

            return { success: true };
        } catch (err: any) {
            console.error('[AiSensy] ❌ Network error:', err);
            return { success: false, error: err?.message || 'Network error' };
        }
    }
}
