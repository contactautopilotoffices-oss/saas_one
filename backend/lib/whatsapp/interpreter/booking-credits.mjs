export async function summarizeBookingCredits(admin, userId, propertyId, slot) {
    const policy = await admin.rpc('whatsapp_assistant_requires_credits', { p_user_id: userId, p_property_id: propertyId });
    if (policy.error) throw policy.error;
    if (policy.data === false) return null;
    if (policy.data !== true) throw new Error('Booking credit policy unavailable');
    const { data: members, error: memberError } = await admin.from('company_members')
        .select('company_id, company:companies!inner(property_id)').eq('user_id', userId).eq('company.property_id', propertyId);
    if (memberError) throw memberError;
    if ((members || []).length > 1) return 'Multiple companies at this property. Please contact your property manager.';
    const companyId = members?.[0]?.company_id;
    let query = admin.from('meeting_room_credits').select('remaining_hours').eq('property_id', propertyId);
    query = companyId ? query.eq('company_id', companyId) : query.eq('user_id', userId).is('company_id', null);
    const { data: credit, error } = await query.maybeSingle();
    if (error) throw error;
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const needed = (minutes(slot.end_time) - minutes(slot.start_time)) / 60;
    return credit ? `${needed} hours required; ${credit.remaining_hours ?? 0} hours remaining`
        : 'No meeting-room credits are assigned yet. Contact your property manager before booking.';
}
