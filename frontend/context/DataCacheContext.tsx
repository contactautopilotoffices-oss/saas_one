'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { clearSessionCaches } from '@/frontend/lib/dashboard/sessionCaches';
import { setWidgetDataOwner, clearSavedWidgetData } from '@/frontend/lib/dashboard/useWidgetData';

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
    const { user, isLoading: isAuthLoading } = useAuth();
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

    const invalidateCache = useCallback((keyOrPrefix?: string) => {
        if (keyOrPrefix) {
            const userSpecificKey = getUserKey(keyOrPrefix);
            setCache(prev => {
                const next: Record<string, CacheEntry> = {};
                for (const [k, v] of Object.entries(prev)) {
                    if (k !== userSpecificKey && !k.includes(keyOrPrefix)) {
                        next[k] = v;
                    }
                }
                return next;
            });
            try {
                Object.keys(localStorage)
                    .filter(k => k.startsWith('cache:') && (k === `cache:${userSpecificKey}` || k.includes(keyOrPrefix)))
                    .forEach(k => {
                        try { localStorage.removeItem(k); } catch {}
                    });
            } catch {}
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

    // Another user signed in (or the user logged out): empty the module-level caches too (dashboard cards, Task Manager).
    const lastUserId = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        const current = user?.id ?? null;
        if (lastUserId.current !== undefined && lastUserId.current !== current) clearSessionCaches();
        lastUserId.current = current;
    }, [user?.id]);

    // Dashboard cards' saved copies (performance plan Phase 5A). Only acts once login has finished loading, so the normal
    // "nobody yet → user" step on every page load never wipes them. Wiped on logout or when a different user signs in.
    const lastSavedOwner = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (isAuthLoading) return;
        const current = user?.id ?? null;
        if (lastSavedOwner.current !== undefined && lastSavedOwner.current !== current) clearSavedWidgetData();
        lastSavedOwner.current = current;
        setWidgetDataOwner(current);
    }, [user?.id, isAuthLoading]);

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
