export interface WalletTotals { received: number; spent: number; returned: number; balance: number }
export function requestWalletTotals(entries: { kind: string; amount: string | number }[]): WalletTotals {
    const cents = { received: 0, spent: 0, returned: 0 };
    for (const entry of entries) {
        const amount = Math.round(Number(entry.amount) * 100);
        if (entry.kind === 'credit') cents.received += amount;
        if (entry.kind === 'debit') cents.spent += amount;
        if (entry.kind === 'return') cents.returned += amount;
    }
    return { received: cents.received / 100, spent: cents.spent / 100, returned: cents.returned / 100, balance: (cents.received - cents.spent - cents.returned) / 100 };
}
