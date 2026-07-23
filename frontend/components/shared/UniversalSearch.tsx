'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { addRecentItem, getRecentItems, addRecentSearch, getRecentSearches, type RecentItem } from '@/frontend/utils/searchHistory';
import {
    Search,
    Ticket,
    User,
    Building,
    X,
    Loader2,
    ArrowRight,
    SearchX,
    Building2,
    LayoutDashboard,
    GitMerge,
    Package,
    Users,
    FileBarChart,
    Fuel,
    Zap,
    Wrench,
    Calendar,
    Handshake,
    ClipboardCheck,
    Settings
} from 'lucide-react';

interface SearchResult {
    id: string;
    type: 'ticket' | 'user' | 'property' | 'organization' | 'module' | 'lead';
    label: string;
    sublabel?: string;
    route?: string;
    icon?: any;
    organization_id?: string;
}

const MODULES = [
    { id: 'm-dash', label: 'Dashboard', sublabel: 'Overview & Statistics', route: '/dashboard', type: 'module' as const, keywords: ['overview', 'stats', 'home'], icon: LayoutDashboard },
    { id: 'm-tick', label: 'Tickets', sublabel: 'Manage requests & issues', route: '/dashboard?tab=requests', type: 'module' as const, keywords: ['requests', 'complaints', 'issues'], icon: Ticket },
    { id: 'm-flow', label: 'Flow Map', sublabel: 'Ticket lifecycle visualizer', route: '/flow-map', type: 'module' as const, keywords: ['process', 'topology', 'link'], icon: GitMerge },
    { id: 'm-inv', label: 'Stock', sublabel: 'Stock & buying', route: '/dashboard?tab=stock_reports', type: 'module' as const, keywords: ['stock', 'items', 'warehouse'], icon: Package },
    { id: 'm-user', label: 'Staff & Users', sublabel: 'Manage team members', route: '/dashboard?tab=users', type: 'module' as const, keywords: ['people', 'employees', 'directory'], icon: Users },
    { id: 'm-prop', label: 'Properties', sublabel: 'Building management', route: '/dashboard?tab=properties', type: 'module' as const, keywords: ['buildings', 'sites', 'locations'], icon: Building2 },
    { id: 'm-repo', label: 'Reports', sublabel: 'Analytics & exports', route: '/dashboard?tab=reports', type: 'module' as const, keywords: ['stats', 'export', 'data'], icon: FileBarChart },
    { id: 'm-dies', label: 'Diesel', sublabel: 'Fuel tracking & logs', route: '/dashboard?tab=diesel', type: 'module' as const, keywords: ['fuel', 'generator', 'dg', 'diesel generator'], icon: Fuel },
    { id: 'm-elec', label: 'Electricity', sublabel: 'Energy consumption', route: '/dashboard?tab=electricity', type: 'module' as const, keywords: ['power', 'meters', 'utility'], icon: Zap },
    { id: 'm-ppm', label: 'Planned Preventive Maintenance', sublabel: 'Routine maintenance schedule', route: '/dashboard?tab=ppm', type: 'module' as const, keywords: ['maintenance', 'schedule', 'periodic', 'ppm'], icon: Wrench },
    { id: 'm-room', label: 'Meeting Rooms', sublabel: 'Booking & management', route: '/dashboard?tab=rooms', type: 'module' as const, keywords: ['booking', 'calendar', 'office'], icon: Calendar },
    { id: 'm-vend', label: 'Vendors', sublabel: 'Partner management', route: '/dashboard?tab=vendors', type: 'module' as const, keywords: ['suppliers', 'partners', 'external'], icon: Handshake },
    { id: 'm-che', label: 'Checklist', sublabel: 'Daily inspections', route: '/dashboard?tab=checklist', type: 'module' as const, keywords: ['inspections', 'audit', 'daily', 'sop'], icon: ClipboardCheck },
    { id: 'm-sett', label: 'Settings', sublabel: 'System configuration', route: '/dashboard?tab=settings', type: 'module' as const, keywords: ['config', 'profile', 'admin'], icon: Settings }
];

export function UniversalSearch() {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const router = useRouter();
    const params = useParams();
    const orgId = params?.orgId as string;
    const [isCrmContext, setIsCrmContext] = useState(false);

    useEffect(() => {
        setIsCrmContext(window.location.pathname.includes('/crm'));
    }, []);

    useEffect(() => {
        setIsCrmContext(window.location.pathname.includes('/crm'));
    }, [isOpen]);

    const scopedModules = useMemo(() =>
        MODULES.map(m => ({
            ...m,
            route: orgId ? `/${orgId}${m.route}` : m.route
        })),
        [orgId]
    );

    // Global shortcut listener (Cmd+K or Ctrl+K)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(true);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Click outside to close
    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    // Load recent items when opened
    useEffect(() => {
        if (isOpen) {
            setRecentItems(getRecentItems());
            setRecentSearches(getRecentSearches());
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setQuery('');
            setResults([]);
        }
    }, [isOpen]);

    // Instant local filter + debounced DB search
    useEffect(() => {
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }

        if (!query || query.length < 1) {
            setResults([]);
            setIsLoading(false);
            return;
        }

        const q = query.toLowerCase();
        const filteredModules: SearchResult[] = isCrmContext ? [] : scopedModules.filter(m =>
            m.label.toLowerCase().includes(q) ||
            m.sublabel.toLowerCase().includes(q) ||
            m.keywords.some(k => k.includes(q))
        );

        const filteredRecent: SearchResult[] = recentItems
            .filter(r =>
                r.label.toLowerCase().includes(q) ||
                (r.sublabel?.toLowerCase().includes(q))
            )
            .map(r => ({ ...r, icon: undefined }));

        setResults([...filteredModules, ...filteredRecent]);
        setSelectedIndex(0);

        if (query.length >= 2) {
            setIsLoading(true);
            const controller = new AbortController();
            abortRef.current = controller;

            const timer = setTimeout(async () => {
                try {
                    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}${isCrmContext ? '&scope=crm' : ''}${orgId ? `&org_id=${orgId}` : ''}`, {
                        signal: controller.signal
                    });
                    const data = await response.json();
                    const dbResults: SearchResult[] = data.results || [];

                    const existingIds = new Set([...filteredModules, ...filteredRecent].map(r => r.id));
                    const newDbResults = dbResults.filter(r => !existingIds.has(r.id));
                    setResults([...filteredModules, ...filteredRecent, ...newDbResults]);
                    setSelectedIndex(0);
                } catch (error: any) {
                    if (error?.name !== 'AbortError') {
                        console.error('Search error:', error);
                    }
                } finally {
                    setIsLoading(false);
                }
            }, 150);

            return () => {
                clearTimeout(timer);
                controller.abort();
            };
        }
    }, [query, orgId, scopedModules, recentItems]);

    const handleSelect = useCallback((item: SearchResult) => {
        setIsOpen(false);

        let route = '';
        if (item.type === 'module' && item.route) {
            route = item.route;
        } else if (item.type === 'ticket') {
            route = `/tickets/${item.id}`;
        } else if (item.type === 'property') {
            route = `/property/${item.id}/dashboard`;
        } else if (item.type === 'user') {
            route = `/users/${item.id}`;
        } else if (item.type === 'organization') {
            route = `/org/${item.id}/dashboard`;
        } else if (item.type === 'lead') {
            route = orgId ? `/${orgId}/crm/leads?lead=${item.id}` : (item.organization_id ? `/${item.organization_id}/crm/leads?lead=${item.id}` : '');
        }

        addRecentItem({
            id: item.id,
            type: item.type,
            label: item.label,
            sublabel: item.sublabel,
            route
        });

        if (query.length >= 2) {
            addRecentSearch(query);
        }

        if (route) router.push(route);
    }, [router, query]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        } else if (e.key === 'Enter' && results.length > 0) {
            handleSelect(results[selectedIndex]);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'ticket': return <Ticket className="w-4 h-4" />;
            case 'user': return <User className="w-4 h-4" />;
            case 'property': return <Building2 className="w-4 h-4" />;
            case 'organization': return <Building className="w-4 h-4" />;
            case 'lead': return <Handshake className="w-4 h-4" />;
            default: return <Search className="w-4 h-4" />;
        }
    };

    const hasDropdownContent = isOpen && (
        query.length >= 1 ||
        recentSearches.length > 0 ||
        recentItems.length > 0 ||
        !isCrmContext
    );

    return (
        <div ref={containerRef} className="relative w-full min-w-[160px] max-w-[420px]">
            {/* Search Input Bar */}
            <div
                className={`flex items-center gap-2 px-3 py-1.5 text-sm border rounded-xl transition-all w-full ${
                    isOpen
                        ? 'bg-surface border-primary/40 shadow-lg ring-2 ring-primary/10'
                        : 'bg-muted hover:bg-muted-hover border-border shadow-sm hover:shadow-md'
                }`}
            >
                <Search className={`w-4 h-4 shrink-0 transition-colors ${isOpen ? 'text-primary' : 'text-text-tertiary'}`} />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder={isCrmContext ? 'Search leads, companies...' : 'Search anything...'}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary font-body"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsOpen(true)}
                />
                {isLoading && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                {isOpen && query.length > 0 && !isLoading && (
                    <button onClick={() => setQuery('')} className="p-0.5 hover:bg-muted rounded-full text-text-tertiary">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Dropdown anchored below search bar */}
            <AnimatePresence>
                {hasDropdownContent && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden z-[9999]"
                    >
                        <div className="max-h-[50vh] overflow-y-auto overflow-x-hidden">
                            {query.length < 1 ? (
                                <div className="p-2">
                                    {/* Recent Searches */}
                                    {recentSearches.length > 0 && (
                                        <div className="mb-2">
                                            <p className="px-3 py-1 text-[10px] uppercase tracking-wider font-bold text-text-tertiary">Recent Searches</p>
                                            <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                                                {recentSearches.map((s, i) => (
                                                    <button
                                                        key={`rs-${i}`}
                                                        onClick={() => setQuery(s)}
                                                        className="px-2.5 py-1 rounded-lg text-xs bg-muted hover:bg-muted-hover text-text-secondary border border-border transition-smooth"
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Recent Items */}
                                    {recentItems.length > 0 && (
                                        <div className="mb-2">
                                            <p className="px-3 py-1 text-[10px] uppercase tracking-wider font-bold text-text-tertiary">Recently Visited</p>
                                            <div className="space-y-0.5">
                                                {recentItems.slice(0, 5).map((item) => (
                                                    <button
                                                        key={`ri-${item.id}`}
                                                        onClick={() => handleSelect(item as SearchResult)}
                                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-smooth hover:bg-muted group"
                                                    >
                                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-muted text-text-tertiary group-hover:bg-primary/10 group-hover:text-primary transition-smooth">
                                                            {getIcon(item.type)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
                                                            {item.sublabel && <p className="text-xs text-text-tertiary truncate">{item.sublabel}</p>}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Quick Navigation — hidden in CRM context */}
                                    {!isCrmContext && (
                                        <div>
                                            <p className="px-3 py-1 text-[10px] uppercase tracking-wider font-bold text-text-tertiary">Quick Navigation</p>
                                            <div className="grid grid-cols-2 gap-0.5">
                                                {scopedModules.map((m) => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => handleSelect(m as SearchResult)}
                                                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-smooth hover:bg-muted group"
                                                    >
                                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-muted text-text-tertiary group-hover:bg-primary/10 group-hover:text-primary transition-smooth">
                                                            <m.icon className="w-3.5 h-3.5" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-medium text-text-primary truncate">{m.label}</p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* CRM empty state */}
                                    {isCrmContext && recentItems.length === 0 && recentSearches.length === 0 && (
                                        <div className="py-6 text-center">
                                            <Handshake className="w-6 h-6 text-text-tertiary mx-auto mb-2" />
                                            <p className="text-xs text-text-tertiary">Type a name, company, or email</p>
                                        </div>
                                    )}
                                </div>
                            ) : results.length > 0 ? (
                                <div className="p-1.5 space-y-0.5">
                                    {results.map((result, index) => (
                                        <button
                                            key={`${result.type}-${result.id}-${index}`}
                                            onClick={() => handleSelect(result)}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-smooth group ${
                                                selectedIndex === index ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted'
                                            }`}
                                        >
                                            <div className={`w-7 h-7 rounded-md flex items-center justify-center transition-smooth shrink-0 ${
                                                selectedIndex === index ? 'bg-primary text-white' : 'bg-muted text-text-tertiary'
                                            }`}>
                                                {result.type === 'module' && result.icon ? <result.icon className="w-3.5 h-3.5" /> : getIcon(result.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-text-primary truncate">{result.label}</p>
                                                {result.sublabel && (
                                                    <p className="text-xs text-text-tertiary truncate">{result.sublabel}</p>
                                                )}
                                            </div>
                                            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-muted text-text-tertiary border border-border shrink-0">
                                                {result.type}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : !isLoading && (
                                <div className="py-8 text-center">
                                    <SearchX className="w-5 h-5 text-text-tertiary mx-auto mb-2" />
                                    <p className="text-sm text-text-secondary">No results for &ldquo;{query}&rdquo;</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
