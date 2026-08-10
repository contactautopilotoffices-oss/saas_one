import { InvoiceData } from "./aiProcessor";

export class ZohoService {
    /**
     * The ONE Zoho Books OAuth path in this codebase. Public so other Books callers
     * (backend/services/zohoVendorSync.ts) reuse it instead of growing a second refresh
     * implementation — two of those means two sets of DC-pinning bugs and two places to
     * fix when a refresh token is rotated.
     */
    static async getAccessToken(): Promise<{ token: string; apiDomain: string }> {
        // Books sync uses its own client (a Self Client with ZohoBooks.* scopes) so it
        // stays independent of the SSO login client in ZOHO_CLIENT_ID. Falls back to the
        // shared vars when the Books-specific ones aren't set.
        const clientId = process.env.ZOHO_BOOKS_CLIENT_ID || process.env.ZOHO_CLIENT_ID;
        const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET;
        const refreshToken = process.env.ZOHO_BOOKS_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error("Zoho credentials missing in .env");
        }

        // Refresh tokens are data-centre locked. ZOHO_BOOKS_DC pins the right one
        // (com/in/eu/…); the others are tried as a fallback for unset/misconfigured envs.
        const preferred = (process.env.ZOHO_BOOKS_DC || 'com').replace(/^\.+/, '').trim();
        const domains = [preferred, ...['com', 'in'].filter(d => d !== preferred)];
        let lastError = null;

        for (const tld of domains) {
            try {
                const params = new URLSearchParams({
                    refresh_token: refreshToken,
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'refresh_token',
                });

                const res = await fetch(`https://accounts.zoho.${tld}/oauth/v2/token?${params.toString()}`, {
                    method: 'POST',
                });

                const data = await res.json();
                if (res.ok && data.access_token) {
                    return {
                        token: data.access_token,
                        apiDomain: data.api_domain || `https://www.zohoapis.${tld}`
                    };
                }
                lastError = data;
            } catch (err) {
                lastError = err;
            }
        }

        console.error("Zoho Token Error:", lastError);
        throw new Error("Failed to refresh Zoho access token. Check your credentials and region.");
    }

    static async createPurchaseOrder(orgId: string, invoiceData: InvoiceData): Promise<any> {
        const { token: accessToken, apiDomain } = await this.getAccessToken();

        // Find a default purchase account (e.g. "Purchases" or "Cost of Goods Sold")
        const accountId = await this.getPurchaseAccountId(orgId, accessToken, apiDomain);

        const vendorId = await this.findOrCreateVendor(orgId, invoiceData.vendor_name, accessToken, apiDomain);

        const poPayload = {
            vendor_id: vendorId,
            date: invoiceData.date || new Date().toISOString().split('T')[0],
            purchaseorder_number: `PO-${invoiceData.invoice_number || Date.now()}`,
            line_items: invoiceData.items.map(item => ({
                name: item.name,
                quantity: item.quantity,
                rate: item.unit_price,
                account_id: accountId,
                description: `Imported from PI ${invoiceData.invoice_number}`,
            })),
        };

        const res = await fetch(`${apiDomain}/books/v3/purchaseorders?organization_id=${orgId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(poPayload),
        });

        const data = await res.json();
        if (!res.ok) {
            console.error("Zoho Create PO Error:", data);
            throw new Error(data.message || "Failed to create Purchase Order in Zoho Books");
        }

        return data.purchaseorder;
    }

    /**
     * List all purchase orders from Zoho Books for an org (paginated).
     * Used by the Payment Tracker sync. Throws if creds are missing/invalid.
     */
    static async listPurchaseOrders(zohoOrgId: string): Promise<any[]> {
        const { token, apiDomain } = await this.getAccessToken();
        const all: any[] = [];
        let page = 1;
        for (let i = 0; i < 50; i++) { // hard cap: 50 pages × 200 = 10k POs
            const res = await fetch(
                `${apiDomain}/books/v3/purchaseorders?organization_id=${zohoOrgId}&page=${page}&per_page=200`,
                { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } },
            );
            const data = await res.json();
            if (!res.ok) {
                console.error('Zoho List PO Error:', data);
                throw new Error(data.message || 'Failed to list purchase orders from Zoho Books');
            }
            all.push(...(data.purchaseorders || []));
            if (!data.page_context?.has_more_page) break;
            page++;
        }
        return all;
    }

    private static async findOrCreateVendor(orgId: string, vendorName: string, accessToken: string, apiDomain: string): Promise<string> {
        // 1. Try Exact Match First
        const exactRes = await fetch(`${apiDomain}/books/v3/contacts?organization_id=${orgId}&contact_name=${encodeURIComponent(vendorName)}&contact_type=vendor`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
        });
        const exactData = await exactRes.json();
        
        if (exactData.contacts && exactData.contacts.length > 0) {
            return exactData.contacts[0].contact_id;
        }

        // 2. Try Partial/Fuzzy Match via search_text
        const fuzzyRes = await fetch(`${apiDomain}/books/v3/contacts?organization_id=${orgId}&search_text=${encodeURIComponent(vendorName)}&contact_type=vendor`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
        });
        const fuzzyData = await fuzzyRes.json();

        if (fuzzyData.contacts && fuzzyData.contacts.length > 0) {
            return fuzzyData.contacts[0].contact_id;
        }

        // 3. One last try: Clean the name and search again (e.g. remove "Enterprises", "Private Limited", etc.)
        const cleanName = vendorName.replace(/(Private Limited|Pvt Ltd|Ltd|Enterprises|Corp|Inc|LLP)$/i, "").trim();
        if (cleanName !== vendorName) {
            const cleanRes = await fetch(`${apiDomain}/books/v3/contacts?organization_id=${orgId}&search_text=${encodeURIComponent(cleanName)}&contact_type=vendor`, {
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
            });
            const cleanData = await cleanRes.json();
            if (cleanData.contacts && cleanData.contacts.length > 0) {
                return cleanData.contacts[0].contact_id;
            }
        }

        throw new Error(`Vendor "${vendorName}" not found in Zoho Books. Please ensure the vendor name matches EXACTLY in Zoho or create them.`);
    }

    private static async getPurchaseAccountId(orgId: string, accessToken: string, apiDomain: string): Promise<string> {
        const res = await fetch(`${apiDomain}/books/v3/chartofaccounts?organization_id=${orgId}&account_type=expense`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
        });
        const data = await res.json();
        
        if (!data.chartofaccounts) {
            console.error("Zoho COA Error:", data);
            throw new Error("Failed to fetch Chart of Accounts from Zoho");
        }

        // Try to find "Purchases" or "Cost of Goods Sold"
        const account = data.chartofaccounts.find((a: any) => 
            a.account_name.toLowerCase().includes('purchase') || 
            a.account_name.toLowerCase().includes('cost of goods sold') ||
            a.account_type === 'expense'
        );

        if (!account) {
            throw new Error("Could not find a valid Purchase/Expense account in Zoho Books to map items to.");
        }

        return account.account_id;
    }
}
