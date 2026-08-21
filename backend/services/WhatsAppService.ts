import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';

export interface WhatsAppOptions {
    message: string;
    deepLink?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video';
    moduleName?: 'ticketing' | 'meeting_room' | 'ppm' | 'procurement' | 'crm';
    templateName?: string;
    templateParams?: string[];
}

export class WhatsAppService {
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
        if (digits.length === 10) return '91' + digits;
        return digits;
    }

    // Direct routing to AiSensy
    private static async _send(phone: string, options: WhatsAppOptions): Promise<boolean> {
        const formattedPhone = this.formatPhone(phone);
        if (!formattedPhone || formattedPhone.length < 11) {
            console.error('[WhatsAppService] ❌ Invalid phone number, skipping:', phone);
            return false;
        }

        const campaignName = options.templateName || 'fms_welcome_onboarding_v1';
        const templateParams = options.templateParams || [
            'User',
            'AutoPilot Site'
        ];

        const res = await AiSensyService.sendTemplate({
            phone: formattedPhone,
            campaignName,
            templateParams,
            mediaUrl: options.mediaUrl,
        });

        if (!res.success) {
            console.error(`[WhatsAppService] ❌ AiSensy send failed for ${formattedPhone}:`, res.error);
        }

        return res.success;
    }

    static async sendPoll(phone: string, question: string, options: string[]): Promise<boolean> {
        const formattedPhone = this.formatPhone(phone);
        if (!formattedPhone || formattedPhone.length < 11) return false;
        const optionsList = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        const pollMessage = `*${question}*\n\n${optionsList}\n\n_Reply with the number corresponding to your property._`;
        return this.sendAsync(formattedPhone, { message: pollMessage });
    }

    static send(phone: string, options: WhatsAppOptions): void {
        WhatsAppService._send(phone, options).catch((err: unknown) =>
            console.error('[WhatsAppService] Send error:', err)
        );
    }

    static async sendAsync(phone: string, options: WhatsAppOptions): Promise<boolean> {
        return WhatsAppService._send(phone, options);
    }

    static async sendToUser(userId: string, options: WhatsAppOptions): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
        const phone = await this.getPhone(userId);
        if (!phone) return 'SKIPPED';
        try {
            const ok = await WhatsAppService._send(phone, options);
            return ok ? 'SENT' : 'FAILED';
        } catch (err) {
            console.error('[WhatsAppService] Send error:', err);
            return 'FAILED';
        }
    }

    static async sendToUsers(userIds: string[], options: WhatsAppOptions): Promise<void> {
        if (userIds.length === 0) return;
        const { data } = await supabaseAdmin
            .from('users')
            .select('id, phone')
            .in('id', userIds);
        for (const user of data || []) {
            if (user.phone) {
                await this.sendAsync(user.phone, options);
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
}
