'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface CacheEntry {
    data: any;
    timestamp: number;
    ttl?: number;
}

interface DataCacheContextType {
    getCachedData: (key: string) => any | null;
    setCachedData: (key: string, data: any, ttl?: number) => void;
    invalidateCache: (key?: string) => void;
}

const DataCacheContext = createContext<DataCacheContextType | undefined>(undefined);

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Keys that should persist to localStorage (large data worth preserving across refreshes)
const PERSISTENT_KEY_PREFIXES = ['tickets-', 'electricity-', 'sop-', 'dashboard-', 'stock-', 'rooms-', 'water-', 'diesel-', 'analytics-', 'roster-'];

const isPersistentKey = (key: string) =>
    PERSISTENT_KEY_PREFIXES.some(prefix => key.startsWith(prefix));

const readFromStorage = (key: string): CacheEntry | null => {
    try {
        const raw = localStorage.getItem(`cache:${key}`);
        if (!raw) return null;
        const entry: CacheEntry = JSON.parse(raw);
        const ttl = entry.ttl || CACHE_TTL;
        if (Date.now() - entry.timestamp > ttl) {
            localStorage.removeItem(`cache:${key}`);
            return null;
        }
        return entry;
    } catch {
        return null;
    }
};

const writeToStorage = (key: string, data: any, ttl?: number) => {
    try {
        const entry: CacheEntry = { data, timestamp: Date.now(), ttl };
        localStorage.setItem(`cache:${key}`, JSON.stringify(entry));
    } catch {
        // localStorage full or unavailable — silently skip
    }
};

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [cache, setCache] = useState<Record<string, CacheEntry>>({});

    // Helper to get user-specific key
    const getUserKey = useCallback((key: string) => {
        if (!user?.id) return `guest:${key}`;
        return `${user.id}:${key}`;
    }, [user?.id]);

    const getCachedData = useCallback((key: string) => {
        const userSpecificKey = getUserKey(key);
        const userKey = getUserKey(key);
        const entry = cache[userKey] || readFromStorage(userKey);
        if (!entry) return null;
        const ttl = entry.ttl || CACHE_TTL;
        if (Date.now() - entry.timestamp > ttl) return null;
        return entry.data;
    }, [cache, getUserKey]);

    const setCachedData = useCallback((key: string, data: any, ttl?: number) => {
        const userKey = getUserKey(key);
        const entry: CacheEntry = { data, timestamp: Date.now(), ttl };
        setCache(prev => ({ ...prev, [userKey]: entry }));
        if (isPersistentKey(key)) {
            writeToStorage(userKey, data, ttl);
        }
    }, [getUserKey]);

    const invalidateCache = useCallback((key?: string) => {
        if (key) {
            const userSpecificKey = getUserKey(key);
            setCache(prev => {
                const next = { ...prev };
                delete next[userSpecificKey];
                return next;
            });
            if (isPersistentKey(key)) {
                try { localStorage.removeItem(`cache:${userSpecificKey}`); } catch {}
            }
        } else {
            setCache({});
            // Clear all cache: keys from localStorage (all users/guests) for absolute safety on logout
            try {
                Object.keys(localStorage)
                    .filter(k => k.startsWith('cache:'))
                    .forEach(k => {
                        try { localStorage.removeItem(k); } catch {}
                    });
            } catch {}
        }
    }, [getUserKey]);

    // Handle logout: clear cache when user becomes null
    useEffect(() => {
        if (!user) {
            console.log('Antigravity Cache Purge: User logged out');
            invalidateCache();
        }
    }, [user, invalidateCache]);

    return (
        <DataCacheContext.Provider value={{ getCachedData, setCachedData, invalidateCache }}>
            {children}
        </DataCacheContext.Provider>
    );
}

export function useDataCache() {
    const context = useContext(DataCacheContext);
    if (!context) {
        throw new Error('useDataCache must be used within a DataCacheProvider');
    }
    return context;
}
