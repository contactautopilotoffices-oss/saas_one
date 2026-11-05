// Browser test stand-in for the Supabase client: every query resolves with no rows.
export function createClient() {
    const query: any = new Proxy({}, {
        get(_target, key) {
            if (key === 'then') return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
            if (key === 'maybeSingle' || key === 'single') return async () => ({ data: null, error: null });
            return () => query;
        }
    });
    const channel: any = { on: () => channel, subscribe: () => channel };
    return { from: () => query, channel: () => channel, removeChannel: async () => {},
        auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}
