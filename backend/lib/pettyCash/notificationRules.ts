export type PcChannel = 'email' | 'whatsapp' | 'push';
export interface PcRule { enabled?: boolean; channels?: {email?: boolean;whatsapp?: boolean;push?: boolean}; roles?: string[]; user_ids?: string[]; notify_assignee?: boolean; notify_approver?: boolean; notify_requester?: boolean; property_overrides?: Record<string, PcRule> }
/** No legacy fallback: only explicit Omnichannel choices authorize Petty Cash delivery. */
export function effectivePcRule(settings: any, propertyId: string, feature: string, channel: PcChannel): PcRule | null {
    const base: PcRule | undefined = settings?.notification_matrix?.petty_cash?.[feature];
    if (!base) return null;
    const override = base.property_overrides?.[propertyId];
    const rule = { ...base, ...override, channels: { ...base.channels, ...override?.channels } };
    return rule.enabled === true && rule.channels[channel] === true ? rule : null;
}
