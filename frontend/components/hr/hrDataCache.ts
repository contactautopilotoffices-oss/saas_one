// Enhanced Cache for HR Module with In-Memory + SessionStorage Stale-While-Revalidate (SWR)
// Eliminates loading spinners on tab switches, navigations, and page refreshes

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const TICKET_CACHE_TTL_MS = 15 * 1000; // 15 seconds fresh TTL (instant SWR revalidation)
const EMPLOYEE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh TTL
const PROPERTY_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes fresh TTL

function safeSessionGet<T>(key: string): { data: T | null; isStale: boolean } {
    if (typeof window === 'undefined') return { data: null, isStale: true };
    try {
        const item = sessionStorage.getItem(key);
        if (!item) return { data: null, isStale: true };
        const parsed = JSON.parse(item);
        if (!parsed || !parsed.data) return { data: null, isStale: true };
        const isStale = (Date.now() - (parsed.timestamp || 0)) > (parsed.ttl || TICKET_CACHE_TTL_MS);
        return { data: parsed.data, isStale };
    } catch {
        return { data: null, isStale: true };
    }
}

function safeSessionSet(key: string, data: any, ttl: number): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now(), ttl }));
    } catch {}
}

class HRDataCache {
    private tickets = new Map<string, CacheEntry<any[]>>();
    private ticketDetails = new Map<string, CacheEntry<any>>();
    private employees = new Map<string, CacheEntry<any[]>>();
    private properties = new Map<string, CacheEntry<any[]>>();

    // Ticket Details (Instant re-open)
    getTicketDetail(ticketId?: string | null): { data: any | null; isStale: boolean } {
        if (!ticketId) return { data: null, isStale: true };
        const entry = this.ticketDetails.get(ticketId);
        if (entry) {
            const isStale = Date.now() - entry.timestamp > TICKET_CACHE_TTL_MS;
            return { data: entry.data, isStale };
        }
        const session = safeSessionGet<any>(`hr_ticket_detail_${ticketId}`);
        if (session.data) {
            this.ticketDetails.set(ticketId, { data: session.data, timestamp: Date.now() });
            return session;
        }
        return { data: null, isStale: true };
    }

    setTicketDetail(ticketId: string | null | undefined, data: any): void {
        if (!ticketId) return;
        this.ticketDetails.set(ticketId, { data, timestamp: Date.now() });
        safeSessionSet(`hr_ticket_detail_${ticketId}`, data, TICKET_CACHE_TTL_MS);
    }

    invalidateTicketDetail(ticketId?: string | null): void {
        if (ticketId) {
            this.ticketDetails.delete(ticketId);
            try { sessionStorage.removeItem(`hr_ticket_detail_${ticketId}`); } catch {}
        } else {
            this.ticketDetails.clear();
        }
    }

    // Tickets
    getTickets(key: string): { data: any[] | null; isStale: boolean } {
        const entry = this.tickets.get(key);
        if (entry) {
            const isStale = Date.now() - entry.timestamp > TICKET_CACHE_TTL_MS;
            return { data: entry.data, isStale };
        }
        const session = safeSessionGet<any[]>(`hr_tickets_${key}`);
        if (session.data) {
            this.tickets.set(key, { data: session.data, timestamp: Date.now() });
            return session;
        }
        return { data: null, isStale: true };
    }

    // Returns ANY cached ticket list for instant initial display on mount
    getAnyTickets(orgId?: string): any[] | null {
        // 1. Check in-memory entries matching orgId
        for (const [key, entry] of this.tickets.entries()) {
            if (!orgId || key.startsWith(orgId) || key.includes(orgId)) {
                if (Array.isArray(entry.data) && entry.data.length > 0) {
                    return entry.data;
                }
            }
        }
        // 2. Check any entry regardless of key in memory
        for (const entry of this.tickets.values()) {
            if (Array.isArray(entry.data) && entry.data.length > 0) {
                return entry.data;
            }
        }
        // 3. Check sessionStorage
        if (typeof window !== 'undefined') {
            try {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('hr_tickets_')) {
                        const val = safeSessionGet<any[]>(k);
                        if (val.data && Array.isArray(val.data) && val.data.length > 0) {
                            return val.data;
                        }
                    }
                }
            } catch {}
        }
        return null;
    }

    setTickets(key: string, data: any[]): void {
        this.tickets.set(key, { data, timestamp: Date.now() });
        safeSessionSet(`hr_tickets_${key}`, data, TICKET_CACHE_TTL_MS);
    }

    prependTicket(ticket: any): void {
        if (!ticket || !ticket.id) return;
        this.tickets.forEach((entry, key) => {
            if (entry.data && Array.isArray(entry.data) && !entry.data.some(t => t.id === ticket.id)) {
                entry.data = [ticket, ...entry.data];
                safeSessionSet(`hr_tickets_${key}`, entry.data, TICKET_CACHE_TTL_MS);
            }
        });
        if (typeof window !== 'undefined') {
            try {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('hr_tickets_')) {
                        const val = safeSessionGet<any[]>(k);
                        if (val.data && Array.isArray(val.data) && !val.data.some(t => t.id === ticket.id)) {
                            safeSessionSet(k, [ticket, ...val.data], TICKET_CACHE_TTL_MS);
                        }
                    }
                }
            } catch {}
        }
    }

    invalidateTickets(): void {
        this.tickets.clear();
        if (typeof window !== 'undefined') {
            try {
                for (let i = sessionStorage.length - 1; i >= 0; i--) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('hr_tickets_')) {
                        sessionStorage.removeItem(k);
                    }
                }
            } catch {}
        }
    }

    updateTicketStatus(ticketId: string, newStatus: string): void {
        this.tickets.forEach((entry, key) => {
            entry.data = entry.data.map(t => t.id === ticketId ? { ...t, status: newStatus } : t);
            safeSessionSet(`hr_tickets_${key}`, entry.data, TICKET_CACHE_TTL_MS);
        });
        const detailEntry = this.ticketDetails.get(ticketId);
        if (detailEntry && detailEntry.data) {
            detailEntry.data.status = newStatus;
            safeSessionSet(`hr_ticket_detail_${ticketId}`, detailEntry.data, TICKET_CACHE_TTL_MS);
        }
    }

    // Employees
    getEmployees(orgId: string): { data: any[] | null; isStale: boolean } {
        const key = orgId || 'all';
        const entry = this.employees.get(key);
        if (entry) {
            const isStale = Date.now() - entry.timestamp > EMPLOYEE_CACHE_TTL_MS;
            return { data: entry.data, isStale };
        }
        const session = safeSessionGet<any[]>(`hr_employees_${key}`);
        if (session.data) {
            this.employees.set(key, { data: session.data, timestamp: Date.now() });
            return session;
        }
        return { data: null, isStale: true };
    }

    setEmployees(orgId: string, data: any[]): void {
        const key = orgId || 'all';
        this.employees.set(key, { data, timestamp: Date.now() });
        safeSessionSet(`hr_employees_${key}`, data, EMPLOYEE_CACHE_TTL_MS);
    }

    // Properties
    getProperties(orgId: string): { data: any[] | null; isStale: boolean } {
        const key = orgId || 'all';
        const entry = this.properties.get(key);
        if (entry) {
            const isStale = Date.now() - entry.timestamp > PROPERTY_CACHE_TTL_MS;
            return { data: entry.data, isStale };
        }
        const session = safeSessionGet<any[]>(`hr_properties_${key}`);
        if (session.data) {
            this.properties.set(key, { data: session.data, timestamp: Date.now() });
            return session;
        }
        return { data: null, isStale: true };
    }

    setProperties(orgId: string, data: any[]): void {
        const key = orgId || 'all';
        this.properties.set(key, { data, timestamp: Date.now() });
        safeSessionSet(`hr_properties_${key}`, data, PROPERTY_CACHE_TTL_MS);
    }

    // Clear / Invalidate
    invalidateAll(): void {
        this.tickets.clear();
        this.ticketDetails.clear();
        this.employees.clear();
        this.properties.clear();
    }
}

export const hrDataCache = new HRDataCache();
