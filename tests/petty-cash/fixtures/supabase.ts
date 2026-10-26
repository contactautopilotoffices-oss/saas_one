export function createClient() {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: async () => {} };
}
