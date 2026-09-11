import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useGlobalContext } from "@/frontend/context/GlobalContext";
import { ChevronRight, Home, Building2, Layers, Search, ChevronDown, Check, X } from "lucide-react";
import { cn } from "@/backend/lib/utils";
import { UniversalSearch } from "@/frontend/components/shared";

export function ContextBar() {
    const { context, navigateUp, selectProperty, selectBuilding } = useGlobalContext();
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const orgId = (params?.orgId as string) || '';

    const [properties, setProperties] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [propertySearchQuery, setPropertySearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    const currentPropertyId = searchParams.get('propertyId') || 'all';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (orgId) {
            fetch(`/api/properties?organizationId=${orgId}`)
                .then(res => res.json())
                .then(data => {
                    let propsList: any[] = [];
                    if (Array.isArray(data)) propsList = data;
                    else if (Array.isArray(data?.data)) propsList = data.data;
                    else if (Array.isArray(data?.properties)) propsList = data.properties;

                    if (propsList.length === 0) {
                        fetch(`/api/admin/organizations/${orgId}/properties`)
                            .then(res => res.ok ? res.json() : null)
                            .then(adminData => {
                                if (Array.isArray(adminData)) setProperties(adminData);
                                else if (Array.isArray(adminData?.properties)) setProperties(adminData.properties);
                            });
                    } else {
                        setProperties(propsList);
                    }
                })
                .catch(err => console.error('Error fetching header properties:', err));
        }
    }, [orgId]);

    const handleSelectProperty = (propId: string) => {
        const newParams = new URLSearchParams(searchParams.toString());
        if (propId === 'all') {
            newParams.delete('propertyId');
        } else {
            newParams.set('propertyId', propId);
        }
        router.push(`${pathname}?${newParams.toString()}`);
        setIsOpen(false);
        setPropertySearchQuery('');
    };

    const filteredPropertiesList = properties.filter(p =>
        (p.name || '').toLowerCase().includes(propertySearchQuery.toLowerCase())
    );

    // Helper to render a breadcrumb item
    const BreadcrumbItem = ({
        icon: Icon,
        label,
        isActive,
        onClick
    }: {
        icon: any;
        label: string;
        isActive: boolean;
        onClick?: () => void;
    }) => (
        <div className={cn("flex items-center group shrink-0", onClick && "cursor-pointer")} onClick={onClick}>
            <Icon className={cn("h-4 w-4 mr-1.5 md:mr-2 shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span className={cn(
                "text-xs font-medium uppercase tracking-wider truncate max-w-[100px] md:max-w-none",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}>
                {label}
            </span>
        </div>
    );

    const Separator = () => <ChevronRight className="h-4 w-4 text-muted-foreground/40 mx-1 md:mx-2 shrink-0" />;

    return (
        <div className="w-full h-12 md:h-14 border-b border-border bg-white/50 backdrop-blur-sm flex items-center px-4 md:px-8 z-40 sticky top-0">
            <div className="flex items-center min-w-0 overflow-x-auto hide-scrollbar">
                {/* Organization (Always present) */}
                <BreadcrumbItem
                    icon={Home}
                    label={context.organization?.name || "Loading..."}
                    isActive={!context.property}
                    onClick={() => {
                        if (context.property) navigateUp();
                    }}
                />

                {context.property && (
                    <>
                        <Separator />
                        <BreadcrumbItem
                            icon={Building2}
                            label={context.property.name}
                            isActive={!context.building}
                            onClick={() => {
                                if (context.building) navigateUp();
                            }}
                        />
                    </>
                )}

                {context.building && (
                    <>
                        <Separator />
                        <BreadcrumbItem
                            icon={Layers}
                            label={context.building.name}
                            isActive={!context.floor}
                            onClick={() => {
                                if (context.floor) navigateUp();
                            }}
                        />
                    </>
                )}

                {context.floor && (
                    <>
                        <Separator />
                        <div className="flex items-center shrink-0">
                            <span className="w-2 h-2 rounded-full bg-success mr-2 animate-pulse"></span>
                            <span className="text-sm font-bold text-foreground">
                                {context.floor.name}
                            </span>
                        </div>
                    </>
                )}
            </div>

            <div className="flex-1 flex justify-center max-w-xl mx-4 md:mx-12">
                <UniversalSearch />
            </div>

            <div className="ml-auto flex items-center shrink-0 gap-3">
                {/* Header Property Selector Dropdown */}
                {properties.length > 0 && (
                    <div className="relative" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={() => setIsOpen(!isOpen)}
                            className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-[#587e85] transition-all text-xs font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
                        >
                            <Building2 className="w-3.5 h-3.5 text-[#587e85] shrink-0" />
                            <span className="truncate max-w-[130px] sm:max-w-[170px]">
                                {currentPropertyId === 'all'
                                    ? `All Properties (${properties.length})`
                                    : (properties.find(p => p.id === currentPropertyId)?.name || 'Selected Property')}
                            </span>
                            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isOpen && (
                            <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={propertySearchQuery}
                                        onChange={(e) => setPropertySearchQuery(e.target.value)}
                                        placeholder="Search property..."
                                        className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-[#587e85]"
                                        autoFocus
                                    />
                                    {propertySearchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setPropertySearchQuery('')}
                                            className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>

                                <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scrollbar">
                                    <button
                                        type="button"
                                        onClick={() => handleSelectProperty('all')}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left transition-colors ${
                                            currentPropertyId === 'all'
                                                ? 'bg-[#587e85]/10 text-[#587e85] font-bold'
                                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Building2 className="w-3.5 h-3.5 opacity-60" />
                                            <span>All Properties</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-700 text-[10px] font-bold">
                                                {properties.length}
                                            </span>
                                            {currentPropertyId === 'all' && <Check className="w-3.5 h-3.5 text-[#587e85]" />}
                                        </div>
                                    </button>

                                    {filteredPropertiesList.length === 0 ? (
                                        <div className="p-3 text-center text-slate-400 text-xs italic">
                                            No property matching "{propertySearchQuery}"
                                        </div>
                                    ) : (
                                        filteredPropertiesList.map((p) => {
                                            const isSelected = currentPropertyId === p.id;
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => handleSelectProperty(p.id)}
                                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left transition-colors ${
                                                        isSelected
                                                            ? 'bg-[#587e85]/10 text-[#587e85] font-bold'
                                                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        <Building2 className="w-3.5 h-3.5 opacity-60 shrink-0" />
                                                        <span className="truncate">{p.name}</span>
                                                    </div>
                                                    {isSelected && <Check className="w-3.5 h-3.5 text-[#587e85] shrink-0 ml-2" />}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Status Indicator - Hidden on small mobile */}
                <div className="hidden sm:flex items-center space-x-2">
                    <span className="h-2 w-2 rounded-full bg-success"></span>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                        <span className="hidden md:inline">System </span>Operational
                    </span>
                </div>
            </div>
        </div>
    );
}

// Add hide-scrollbar utility style
const style = `
.hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
.hide-scrollbar::-webkit-scrollbar {
    display: none;
}
`;

// Inject the style if not already present
if (typeof document !== 'undefined') {
    const styleId = 'hide-scrollbar-style';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = style;
        document.head.appendChild(styleEl);
    }
}
