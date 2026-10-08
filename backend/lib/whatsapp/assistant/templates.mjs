// Template names are also the default active AiSensy API campaign names.
export const ASSISTANT_TEMPLATES = {
    booking_update: { name: 'fms_whatsapp_booking_update_v1', count: 3 },
    menu: { name: 'fms_whatsapp_menu_v1', count: 0 },
    select: { name: 'fms_whatsapp_select_v1', count: 3 },
    ticket_title: { name: 'fms_whatsapp_ticket_title_v1', count: 1 },
    ticket_photo_choice: { name: 'fms_whatsapp_ticket_photo_choice_v1', count: 2 },
    ticket_photo: { name: 'fms_whatsapp_ticket_photo_v1', count: 1 },
    booking_date: { name: 'fms_whatsapp_booking_date_v1', count: 1 },
    booking_review: { name: 'fms_whatsapp_booking_review_v1', count: 5 },
    ticket_created: { name: 'fms_whatsapp_ticket_created_v1', count: 3 },
    booking_created: { name: 'fms_whatsapp_booking_created_v1', count: 5 },
    notice: { name: 'fms_whatsapp_notice_v1', count: 1 },
};

export function campaignOptions(phone, reply, overrides = {}) {
    const template = ASSISTANT_TEMPLATES[reply.key];
    if (!template || reply.params.length !== template.count) throw new Error('Invalid assistant template or parameter count');
    return {
        phone, campaignName: overrides[reply.key] || template.name,
        // Meta template variable values must not contain newlines/tabs.
        templateParams: reply.params.map(value => String(value).replace(/\s+/g, ' ').trim()),
    };
}
