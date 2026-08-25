import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface TriggerVoiceCallOptions {
    organizationId: string;
    propertyId?: string;
    recipientPhone: string;
    recipientUserId?: string;
    recipientName?: string;
    eventType: string; // 'CHECKLIST_STARTED', 'CHECKLIST_OVERDUE', 'PPM_REMINDER', 'TEST_CALL'
    customTemplate?: string;
    variables: {
        userName?: string;
        checklistTitle?: string;
        propertyName?: string;
        shiftTime?: string;
        dueDate?: string;
        systemName?: string;
        [key: string]: any;
    };
}

export interface VoiceServiceConfig {
    enabled?: boolean;
    provider?: 'plivo_direct' | 'bolna_plivo';
    plivo_auth_id?: string;
    plivo_auth_token?: string;
    plivo_virtual_number?: string;
    bolna_api_key?: string;
    bolna_agent_id?: string;
    bolna_webhook_secret?: string;
}

export const DEFAULT_VOICE_TEMPLATES: Record<string, string> = {
    checklist_slot_reminder: "Hi {{user_name}}, this is Pratiksha from the Operations team. A quick reminder that your checklist '{{checklist_title}}' at {{property_name}} is due soon. Please ensure all items are completed on time.",
    checklist_started: "Hi {{user_name}}, this is Pratiksha from the Operations team. Your scheduled checklist '{{checklist_title}}' at {{property_name}} has started. Please begin your inspection rounds and upload verification photos in the app.",
    checklist_overdue_alert: "Hi {{user_name}}, this is Pratiksha from the Operations team with an urgent update. The checklist '{{checklist_title}}' at {{property_name}} was not completed during its scheduled shift. Please review and complete it right away.",
    reminder_ppm: "Hi {{user_name}}, this is Pratiksha from the Operations team. Preventive maintenance for {{system_name}} at {{property_name}} is scheduled for {{due_date}}. Please coordinate with the vendor and arrange site clearance.",
    test_call: "Hi {{user_name}}, this is Pratiksha from the Operations team. This is a quick test call to confirm that your phone notifications and voice alerts are working properly."
};

export class VoiceCallingService {
    /**
     * Resolves voice credentials from organization_settings or system environment.
     */
    static async getConfig(organizationId?: string): Promise<VoiceServiceConfig> {
        let orgConfig: VoiceServiceConfig = {};

        if (organizationId) {
            const { data: orgData } = await supabaseAdmin
                .from('organization_settings')
                .select('voice_service_config')
                .eq('organization_id', organizationId)
                .maybeSingle();

            if (orgData?.voice_service_config) {
                orgConfig = orgData.voice_service_config;
            }
        }

        return {
            enabled: orgConfig.enabled ?? true,
            provider: orgConfig.provider || (orgConfig.bolna_api_key || process.env.BOLNA_API_KEY ? 'bolna_plivo' : 'plivo_direct'),
            plivo_auth_id: orgConfig.plivo_auth_id || process.env.PLIVO_AUTH_ID,
            plivo_auth_token: orgConfig.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN,
            plivo_virtual_number: orgConfig.plivo_virtual_number || process.env.PLIVO_VIRTUAL_NUMBER,
            bolna_api_key: orgConfig.bolna_api_key || process.env.BOLNA_API_KEY,
            bolna_agent_id: orgConfig.bolna_agent_id || process.env.BOLNA_AGENT_ID,
            bolna_webhook_secret: orgConfig.bolna_webhook_secret || process.env.BOLNA_WEBHOOK_SECRET
        };
    }

    /**
     * Formats phone numbers to standard E.164 (e.g. "+919876543210").
     */
    static formatPhone(phone: string): string {
        let clean = phone.replace(/[^0-9+]/g, '');
        if (!clean.startsWith('+')) {
            if (clean.length === 10) {
                clean = `+91${clean}`;
            } else if (clean.length === 12 && clean.startsWith('91')) {
                clean = `+${clean}`;
            } else {
                clean = `+${clean}`;
            }
        }
        return clean;
    }

    /**
     * Replaces template placeholders {{user_name}}, {{checklist_title}}, {{property_name}}, etc.
     */
    static renderTemplate(template: string, vars: Record<string, any>): string {
        return template
            .replace(/\{\{\s*user_name\s*\}\}/gi, vars.userName || vars.user_name || 'Staff')
            .replace(/\{\{\s*checklist_title\s*\}\}/gi, vars.checklistTitle || vars.checklist_title || 'Checklist')
            .replace(/\{\{\s*property_name\s*\}\}/gi, vars.propertyName || vars.property_name || 'Site')
            .replace(/\{\{\s*shift_time\s*\}\}/gi, vars.shiftTime || vars.shift_time || 'Scheduled Time')
            .replace(/\{\{\s*due_date\s*\}\}/gi, vars.dueDate || vars.due_date || 'Upcoming Date')
            .replace(/\{\{\s*system_name\s*\}\}/gi, vars.systemName || vars.system_name || 'Equipment');
    }

    /**
     * Triggers an outbound voice call directly via Plivo (or via Bolna AI if configured).
     */
    static async triggerCall(options: TriggerVoiceCallOptions): Promise<{ success: boolean; callId?: string; error?: string }> {
        const { organizationId, propertyId, recipientPhone, recipientUserId, eventType, variables } = options;

        try {
            const config = await this.getConfig(organizationId);
            const formattedPhone = this.formatPhone(recipientPhone);
            const rawTemplate = options.customTemplate || DEFAULT_VOICE_TEMPLATES[eventType.toLowerCase()] || DEFAULT_VOICE_TEMPLATES.checklist_started;
            const spokenScript = this.renderTemplate(rawTemplate, variables);

            let callId: string | null = null;
            let callStatus = 'initiated';

            // Option 1: Direct Plivo Outbound Calling (Native Plivo TTS, zero external AI required)
            if (config.plivo_auth_id && config.plivo_auth_token) {
                try {
                    const authHeader = 'Basic ' + Buffer.from(`${config.plivo_auth_id}:${config.plivo_auth_token}`).toString('base64');
                    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fms-dev-saas-one.vercel.app';
                    const answerUrl = `${baseUrl}/api/voice/plivo-answer?text=${encodeURIComponent(spokenScript)}`;

                    const plivoResponse = await fetch(`https://api.plivo.com/v1/Account/${config.plivo_auth_id}/Call/`, {
                        method: 'POST',
                        headers: {
                            'Authorization': authHeader,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: config.plivo_virtual_number || 'AutoPilot',
                            to: formattedPhone.replace('+', ''),
                            answer_url: answerUrl,
                            answer_method: 'GET'
                        })
                    });

                    if (plivoResponse.ok) {
                        const resData = await plivoResponse.json();
                        callId = resData.request_uuid || resData.call_uuid || `plivo_${Date.now()}`;
                        callStatus = 'in_progress';
                        console.log(`[VoiceCallingService] Plivo call initiated to ${formattedPhone}, UUID: ${callId}`);
                    } else {
                        const errText = await plivoResponse.text();
                        console.error('[VoiceCallingService] Plivo API error:', errText);
                        callStatus = 'failed';
                    }
                } catch (plivoErr: any) {
                    console.error('[VoiceCallingService] Plivo call request error:', plivoErr.message);
                    callStatus = 'failed';
                }
            } 
            // Option 2: Bolna AI Calling Agent (if Bolna keys are provided)
            else if (config.bolna_api_key && config.bolna_agent_id) {
                try {
                    const response = await fetch(`https://api.bolna.dev/agent/${config.bolna_agent_id}/call`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${config.bolna_api_key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            recipient_phone_number: formattedPhone,
                            agent_id: config.bolna_agent_id,
                            from_phone_number: config.plivo_virtual_number,
                            user_data: {
                                prompt_script: spokenScript,
                                user_name: variables.userName,
                                property_name: variables.propertyName,
                                checklist_title: variables.checklistTitle,
                                event_type: eventType,
                                organization_id: organizationId,
                                property_id: propertyId
                            }
                        })
                    });

                    if (response.ok) {
                        const resData = await response.json();
                        callId = resData.call_id || resData.id || `bolna_${Date.now()}`;
                        callStatus = 'in_progress';
                    } else {
                        const errText = await response.text();
                        console.error('[VoiceCallingService] Bolna API error response:', errText);
                        callStatus = 'failed';
                    }
                } catch (fetchErr: any) {
                    console.error('[VoiceCallingService] Bolna request error:', fetchErr.message);
                    callStatus = 'failed';
                }
            } else {
                // Development fallback simulation
                callId = `sim_call_${Date.now()}`;
                callStatus = 'completed';
            }

            // Insert audit record into omnichannel_call_logs
            const { data: logEntry, error: logError } = await supabaseAdmin
                .from('omnichannel_call_logs')
                .insert({
                    organization_id: organizationId || null,
                    property_id: propertyId || null,
                    recipient_phone: formattedPhone,
                    recipient_user_id: recipientUserId || null,
                    event_type: eventType,
                    spoken_script: spokenScript,
                    call_status: callStatus,
                    bolna_call_id: callId,
                    created_at: new Date().toISOString()
                })
                .select('id')
                .maybeSingle();

            if (logError) {
                console.error('[VoiceCallingService] Failed to insert call log:', logError.message);
            }

            return { success: callStatus !== 'failed', callId: callId || logEntry?.id };
        } catch (err: any) {
            console.error('[VoiceCallingService] Exception in triggerCall:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Executes a live test call to verify Plivo connectivity from the UI.
     */
    static async triggerTestCall(options: {
        phone: string;
        organizationId: string;
        userName?: string;
        customScript?: string;
    }): Promise<{ success: boolean; callId?: string; spokenScript?: string; error?: string }> {
        const { phone, organizationId, userName = 'Admin', customScript } = options;

        const rawTemplate = customScript || DEFAULT_VOICE_TEMPLATES.test_call;
        const spokenScript = this.renderTemplate(rawTemplate, { userName });

        const result = await this.triggerCall({
            organizationId,
            recipientPhone: phone,
            eventType: 'TEST_CALL',
            customTemplate: rawTemplate,
            variables: {
                userName
            }
        });

        return {
            ...result,
            spokenScript
        };
    }
}
