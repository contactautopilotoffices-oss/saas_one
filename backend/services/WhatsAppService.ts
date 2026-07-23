import { supabaseAdmin } from '@/backend/lib/supabase/admin';

const WASENDER_API_KEY = process.env.WASENDER_API_KEY!;
const WASENDER_SENDER_ID = process.env.WASENDER_SENDER_ID!;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

const BASE_URL = 'https://wasenderapi.com/api';

export interface WhatsAppOptions {
    message: string;
    deepLink?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video';
    moduleName?: 'ticketing' | 'meeting_room' | 'ppm' | 'procurement' | 'crm';
}

export class WhatsAppService {

    // In-memory cache: userId → phone. TTL 5 minutes.
    private static phoneCache = new Map<string, { phone: string | null; expiresAt: number }>();
    private static CACHE_TTL_MS = 5 * 60 * 1000;

    private static async getPhone(userId: string): Promise<string | null> {
        const cached = this.phoneCache.get(userId);
        if (cached && Date.now() < cached.expiresAt) return cached.phone;

        const { data } = await supabaseAdmin
            .from('users')
            .select('phone')
            .eq('id', userId)
            .single();
        const phone = data?.phone || null;
        this.phoneCache.set(userId, { phone, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return phone;
    }

    private static formatPhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        // Indian 10-digit numbers → prepend country code 91
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    private static buildAbsoluteUrl(deepLink?: string): string | null {
        if (!deepLink || !APP_URL) return null;
        return `${APP_URL}${deepLink}`;
    }

    private static async callAPI(endpoint: string, body: object): Promise<boolean> {
        const res = await fetch(`${BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WASENDER_API_KEY}`,
            },
            body: JSON.stringify(body),
        });

        const responseText = await res.text();

        if (!res.ok) {
            console.error(`>>>>>>>>>> [WHATSAPP] ❌ [${endpoint}] FAILED — Status: ${res.status}`);
            console.error('>>>>>>>>>> [WHATSAPP] Response:', responseText);
            return false;
        }

        // WasenderAPI returns HTTP 200 even when session is disconnected.
        // Must also check the body's success field.
        try {
            const parsed = JSON.parse(responseText);
            if (parsed.success === false) {
                console.error(`>>>>>>>>>> [WHATSAPP] ❌ [${endpoint}] API ERROR — ${parsed.message || 'unknown'}`);
                return false;
            }
        } catch {
            // Non-JSON response — treat as success if HTTP was ok
        }

        // success — no-op
        return true;
    }

    // The actual send logic — returns true on success, false on failure
    private static async _send(phone: string, options: WhatsAppOptions): Promise<boolean> {
        // Check global system config
        const keys = ['whatsapp_notifications_enabled'];
        if (options.moduleName) {
            keys.push(`whatsapp_${options.moduleName}_enabled`);
        }

        const { data: configs } = await supabaseAdmin
            .from('system_config')
            .select('key, value')
            .in('key', keys);

        const configMap = (configs || []).reduce((acc, row) => ({ ...acc, [row.key]: row.value === true }), {} as Record<string, boolean>);
        
        const isGlobalEnabled = configMap['whatsapp_notifications_enabled'] !== false; // defaults true if missing
        
        if (!isGlobalEnabled) {
            // globally disabled — skip silently
            return true; 
        }

        if (options.moduleName) {
            const moduleKey = `whatsapp_${options.moduleName}_enabled`;
            const isModuleEnabled = configMap[moduleKey] !== false; // defaults true if missing
            if (!isModuleEnabled) {
                // module disabled — skip silently
                return true;
            }
        }

        if (!WASENDER_API_KEY || !WASENDER_SENDER_ID) {
            console.error('>>>>>>>>>> [WHATSAPP] ❌ MISSING CONFIG');
            return false;
        }

        const formattedPhone = this.formatPhone(phone);
        if (!formattedPhone || formattedPhone.length < 11) {
            console.error('>>>>>>>>>> [WHATSAPP] ❌ Invalid phone number, skipping:', phone);
            return false;
        }

        const to = formattedPhone;
        const ticketUrl = this.buildAbsoluteUrl(options.deepLink);
        const captionText = ticketUrl
            ? `${options.message}\n\n${ticketUrl}`
            : options.message;

        // prepared payload — no-op

        try {
            if (options.mediaUrl && options.mediaType === 'image') {
                // sending image+caption
                const sent = await this.callAPI('send-message', {
                    session: WASENDER_SENDER_ID,
                    to,
                    imageUrl: options.mediaUrl,
                    text: captionText,
                });
                if (sent) return true;
                // image send failed — will fall back to text
            }

            if (options.mediaUrl && options.mediaType === 'video') {
                // sending video+caption
                const sent = await this.callAPI('send-message', {
                    session: WASENDER_SENDER_ID,
                    to,
                    videoUrl: options.mediaUrl,
                    text: captionText,
                });
                if (sent) return true;
                // video send failed — will fall back to text
            }

            // Plain text fallback
            // sending plain text
            const sent = await this.callAPI('send-message', {
                session: WASENDER_SENDER_ID,
                to,
                text: captionText,
            });
            return sent;

        } catch (err) {
            console.error('>>>>>>>>>> [WHATSAPP] ❌ NETWORK ERROR:', err);
            return false;
        }
    }

    static async sendPoll(phone: string, question: string, options: string[]): Promise<boolean> {
        if (!WASENDER_API_KEY || !WASENDER_SENDER_ID) return false;
        const formattedPhone = this.formatPhone(phone);
        if (!formattedPhone || formattedPhone.length < 11) return false;
        const to = formattedPhone;
        try {
            await this.callAPI('send-message', {
                session: WASENDER_SENDER_ID,
                to,
                poll: {
                    question,
                    options: options.slice(0, 12),
                    multiSelect: false,
                },
            });
            return true;
        } catch (err) {
            console.error('>>>>>>>>>> [WHATSAPP] Poll send error:', err);
            return false;
        }
    }

    static send(phone: string, options: WhatsAppOptions): void {
        WhatsAppService._send(phone, options).catch((err: unknown) =>
            console.error('>>>>>>>>>> [WHATSAPP] Send error:', err)
        );
    }

    static async sendAsync(phone: string, options: WhatsAppOptions): Promise<boolean> {
        return WhatsAppService._send(phone, options);
    }

    static async sendToUser(userId: string, options: WhatsAppOptions): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
        // resolve phone and send
        const phone = await this.getPhone(userId);
        if (!phone) {
            // no phone — skip silently
            return 'SKIPPED';
        }
        // phone resolved
        try {
            await WhatsAppService._send(phone, options);
            return 'SENT';
        } catch (err) {
            console.error('>>>>>>>>>> [WHATSAPP] Send error:', err);
            return 'FAILED';
        }
    }

    static async sendToUsers(userIds: string[], options: WhatsAppOptions): Promise<void> {
        if (userIds.length === 0) return;
        // Batch fetch all phone numbers in one query instead of N sequential queries
        const { data } = await supabaseAdmin
            .from('users')
            .select('id, phone')
            .in('id', userIds);
        for (const user of data || []) {
            if (user.phone) {
                // Await the send so Vercel does not terminate the function mid-flight
                await this.sendAsync(user.phone, options);
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }
}
