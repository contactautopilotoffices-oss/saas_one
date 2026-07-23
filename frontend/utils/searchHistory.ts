// Search history utilities for localStorage persistence

const RECENT_ITEMS_KEY = 'autopilot_recent_search_items';
const RECENT_SEARCHES_KEY = 'autopilot_recent_searches';
const MAX_RECENT_ITEMS = 8;
const MAX_RECENT_SEARCHES = 5;

export interface RecentItem {
    id: string;
    type: 'ticket' | 'user' | 'property' | 'organization' | 'module' | 'lead';
    label: string;
    sublabel?: string;
    route?: string;
    timestamp: number;
}

export function addRecentItem(item: Omit<RecentItem, 'timestamp'>) {
    try {
        const items = getRecentItems();
        // Remove duplicates
        const filtered = items.filter(i => i.id !== item.id);
        filtered.unshift({ ...item, timestamp: Date.now() });
        localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT_ITEMS)));
    } catch {}
}

export function getRecentItems(): RecentItem[] {
    try {
        const raw = localStorage.getItem(RECENT_ITEMS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function addRecentSearch(query: string) {
    try {
        const searches = getRecentSearches();
        const filtered = searches.filter(s => s !== query);
        filtered.unshift(query);
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT_SEARCHES)));
    } catch {}
}

export function getRecentSearches(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}
