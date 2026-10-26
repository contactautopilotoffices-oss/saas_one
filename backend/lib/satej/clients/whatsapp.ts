/**
 * WhatsApp to the purchase team, through AiSensy — the sender every other FMS
 * module uses. AiSensy only sends approved templates, so Meera sends two short
 * ones (questions waiting, summary ready) and the full ranked detail stays on
 * the Meera page, which the template's button opens.
 *
 * Templates: WHATSAPP_META_TEMPLATES.md, "Meera" section. AiSensyService never
 * throws, and neither does this.
 */

import { AiSensyService } from '@/backend/services/AiSensyService';
import { satejConfig } from '../config';
import { mockWhatsapp } from './mocks';

/** Meta rejects template params with new lines, tabs or runs of 4+ spaces. */
function cleanParam(s: string): string {
    return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 900) || '-';
}

export async function sendTemplate(
    to: string,
    templateName: string,
    params: string[],
): Promise<{ ok: boolean; error?: string }> {
    const clean = params.map(cleanParam);
    if (satejConfig.mockMode) return mockWhatsapp.sendTemplate(to, templateName, clean);
    if (!to) return { ok: false, error: 'No WhatsApp number on this requirement' };
    const res = await AiSensyService.sendTemplate({
        phone: to,
        campaignName: templateName,
        templateParams: clean,
        userName: 'Procurement Team',
    });
    return res.success ? { ok: true } : { ok: false, error: res.error ?? 'AiSensy send failed' };
}
