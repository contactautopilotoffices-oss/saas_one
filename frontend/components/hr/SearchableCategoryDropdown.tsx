'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X, ShieldAlert, UserX, Clock, Tag, HelpCircle } from 'lucide-react';
import { matchCategorySearch, HighlightedCategoryText } from '@/frontend/utils/categorySearch';

interface Category {
    id: string;
    ticket_type: string;
    category_name: string;
    sub_category_name?: string;
    first_level_owner_type?: string;
    l1_sla_days?: number;
    l2_sla_days?: number;
    l3_sla_days?: number;
    l4_sla_days?: number;
    is_confidential?: boolean;
    is_anonymous?: boolean;
}

interface SearchableCategoryDropdownProps {
    categories: Category[];
    selectedCategoryId: string;
    onSelectCategory: (categoryId: string) => void;
    ticketType?: string;
    placeholder?: string;
    required?: boolean;
}

export default function SearchableCategoryDropdown({
    categories = [],
    selectedCategoryId,
    onSelectCategory,
    ticketType,
    placeholder = "Search and select category by typing words...",
    required = false
}: SearchableCategoryDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Filter categories by ticketType AND multi-word search query
    const filteredCategories = categories.filter((c) => {
        // Ticket type matching logic
        if (ticketType === 'confidential_feedback') {
            if (c.ticket_type !== 'confidential_feedback' && !c.is_confidential) return false;
        } else if (ticketType === 'anonymous_feedback') {
            if (c.ticket_type !== 'anonymous_feedback' && !c.is_anonymous) return false;
        } else if (ticketType) {
            if (c.ticket_type !== ticketType) return false;
        }

        // Multi-word search matching
        return matchCategorySearch(c, searchQuery);
    });

    const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

    // Focus input on open
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 50);
        }
    }, [isOpen]);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const formatSlaDisplay = (days?: number) => {
        if (!days || days === 0) return 'Same Day';
        return `${days} Working Day${days > 1 ? 's' : ''}`;
    };

    const getOwnerLabel = (ownerType?: string) => {
        if (!ownerType) return 'Assigned Authority';
        switch (ownerType) {
            case 'reporting_manager': return 'Reporting Manager (L1)';
            case 'hr_manager': return 'HR Manager / HR Dept (L1)';
            case 'hr_head': return 'HR Head (L1)';
            case 'director': return 'Authorized Director (L1)';
            default: return ownerType.replace(/_/g, ' ');
        }
    };

    const quickKeywords = ['Salary', 'Leave', 'POSH', 'PF & Tax', 'Laptop', 'Manager', 'Exit'];

    return (
        <div ref={containerRef} className="relative w-full">
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isOpen
                        ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-white dark:bg-slate-900 shadow-md'
                        : selectedCategory
                        ? 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white shadow-xs hover:border-slate-400'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
            >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Search className={`w-4 h-4 shrink-0 ${selectedCategory ? 'text-indigo-500' : 'text-slate-400'}`} />
                    {selectedCategory ? (
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                    {selectedCategory.category_name}
                                </span>
                                {selectedCategory.sub_category_name && (
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        ({selectedCategory.sub_category_name})
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                <span className="inline-flex items-center gap-1 font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50 px-1.5 py-0.2 rounded border border-teal-200 dark:border-teal-800">
                                    <Clock className="w-2.5 h-2.5" />
                                    TAT: {formatSlaDisplay(selectedCategory.l1_sla_days)}
                                </span>
                                <span>•</span>
                                <span className="truncate">{getOwnerLabel(selectedCategory.first_level_owner_type)}</span>
                            </div>
                        </div>
                    ) : (
                        <span className="text-xs text-slate-400 truncate">{placeholder}</span>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    {selectedCategory && (
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectCategory('');
                                setSearchQuery('');
                            }}
                            className="p-1 text-slate-400 hover:text-red-500 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Clear selection"
                        >
                            <X className="w-3.5 h-3.5" />
                        </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-500' : ''}`} />
                </div>
            </button>

            {/* Hidden Input for HTML5 form required validation */}
            {required && (
                <input
                    type="text"
                    tabIndex={-1}
                    value={selectedCategoryId}
                    onChange={() => {}}
                    required
                    className="opacity-0 absolute inset-0 pointer-events-none w-0 h-0"
                />
            )}

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute left-0 right-0 mt-2 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 p-3 space-y-3 animate-in fade-in zoom-in-95 duration-150 max-w-full">
                    {/* Search Input Bar */}
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3.5 top-3 text-indigo-500" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Type words directly (e.g. salary, leave, POSH, pf, manager)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {searchQuery ? (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        ) : null}
                    </div>

                    {/* Quick Keyword Suggestion Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5 pb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick Search:</span>
                        {quickKeywords.map((kw) => (
                            <button
                                key={kw}
                                type="button"
                                onClick={() => setSearchQuery(kw.toLowerCase())}
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                                    searchQuery.toLowerCase() === kw.toLowerCase()
                                        ? 'bg-indigo-600 text-white shadow-2xs'
                                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                            >
                                {kw}
                            </button>
                        ))}
                    </div>

                    {/* Results Counter */}
                    <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span>
                            {searchQuery ? (
                                <>Matching <strong>{filteredCategories.length}</strong> categories for "{searchQuery}"</>
                            ) : (
                                <>All <strong>{filteredCategories.length}</strong> Categories Available</>
                            )}
                        </span>
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="text-indigo-600 dark:text-indigo-400 hover:underline text-[10px]"
                            >
                                Show All
                            </button>
                        )}
                    </div>

                    {/* Category Options List */}
                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {filteredCategories.length === 0 ? (
                            <div className="p-6 text-center space-y-2">
                                <HelpCircle className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                    No category matching "{searchQuery}"
                                </div>
                                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                                    Try typing individual words like <strong>salary</strong>, <strong>leave</strong>, <strong>POSH</strong>, <strong>laptop</strong>, <strong>PF</strong>, or <strong>manager</strong>.
                                </p>
                            </div>
                        ) : (
                            filteredCategories.map((cat) => {
                                const isSelected = cat.id === selectedCategoryId;
                                return (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => {
                                            onSelectCategory(cat.id);
                                            setIsOpen(false);
                                        }}
                                        className={`w-full text-left p-3 rounded-xl transition-all border flex items-start justify-between gap-3 group ${
                                            isSelected
                                                ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 text-indigo-950 dark:text-indigo-100 shadow-xs'
                                                : 'bg-white dark:bg-slate-800/60 border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-800 dark:text-slate-200'
                                        }`}
                                    >
                                        <div className="space-y-1 min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`px-1.5 py-0.2 rounded font-mono font-extrabold text-[9px] uppercase ${
                                                    cat.ticket_type === 'grievance' ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300' :
                                                    cat.ticket_type === 'hr_query' ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300' :
                                                    cat.ticket_type === 'confidential_feedback' ? 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300' :
                                                    'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                                                }`}>
                                                    {cat.ticket_type?.replace(/_/g, ' ')}
                                                </span>
                                                <h4 className="font-bold text-xs text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                    <HighlightedCategoryText text={cat.category_name} query={searchQuery} />
                                                </h4>
                                            </div>

                                            {cat.sub_category_name && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-0.5">
                                                    <HighlightedCategoryText text={cat.sub_category_name} query={searchQuery} />
                                                </p>
                                            )}

                                            <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                                                <span className="inline-flex items-center gap-1 font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.2 rounded border border-teal-200 dark:border-teal-800">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    TAT: {formatSlaDisplay(cat.l1_sla_days)}
                                                </span>
                                                <span>•</span>
                                                <span className="font-medium truncate">{getOwnerLabel(cat.first_level_owner_type)}</span>
                                            </div>
                                        </div>

                                        {isSelected && (
                                            <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                                                <Check className="w-3.5 h-3.5" />
                                            </div>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
