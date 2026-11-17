export const EXECUTIVE_TICKET_PAGE_SIZE = 1000;

export interface RawExecutiveTicketRow {
    id: string;
    category: string | null;
    status: string;
    created_at: string;
    resolved_at: string | null;
    internal: boolean | null;
    floor_number: string | null;
    issue_category?: { name?: string | null } | null;
}

/**
 * Fetch all tickets for a property in pages so Supabase PostgREST's
 * default 1,000-row response cap never truncates all-time totals or older months.
 */
export async function fetchAllExecutivePropertyTickets(
    supabase: any,
    propertyId: string,
    pageSize = EXECUTIVE_TICKET_PAGE_SIZE
): Promise<RawExecutiveTicketRow[]> {
    const allTickets: RawExecutiveTicketRow[] = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('tickets')
            .select('id, category, status, created_at, resolved_at, internal, floor_number, issue_category:category_id(name)')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(error.message);
        }

        const rows: RawExecutiveTicketRow[] = data || [];
        allTickets.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
    }

    return allTickets;
}
