'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    X, Search, ShoppingCart, Plus, Minus, Trash2, 
    ChevronRight, Loader2, Package, Tag, Info, AlertTriangle,
    CheckCircle2, ShoppingBag, IndianRupee, Clock, User, ArrowLeft,
    Upload, Camera, ImageIcon, Edit2, FileUp, Sparkles, Link2, Paperclip
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { compressImage } from '@/frontend/utils/image-compression';
import { useAuth } from '@/frontend/context/AuthContext';

interface CatalogItem {
    id: string;
    name: string;
    description: string;
    photo_url: string;
    category: string;
    estimated_price: number;
    unit: string;
}

interface CartItem extends Partial<CatalogItem> {
    id: string;
    name: string;
    quantity: number;
    estimated_price: number;
    is_custom?: boolean;
    links?: string[];
    attachments?: string[];
}

interface NewItem {
    name: string;
    description: string;
    category: string;
    estimated_price: string;
    unit: string;
    photo_base64: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    ticketId: string;
    propertyId: string;
    organizationId: string;
    isProcurementUser?: boolean; // Controls catalog management features & price visibility
}

interface BulkUploadResult {
    inserted: number;
    skipped: number;
    mapping: Record<string, string | null>;
    preview: any[];
    error?: string;
}

// Simple session cache to speed up repeated opens
let catalogCache: Record<string, CatalogItem[]> = {};
let usersCache: any[] | null = null;

export default function ProcurementCatalogModal({ isOpen, onClose, ticketId, propertyId, organizationId, isProcurementUser = false }: Props) {
    const { user, membership } = useAuth();
    const isManagementMode = ticketId === "dashboard_catalog_management";
    
    // Stricter permission check for Material Request mode
    // If we are on a ticket, ONLY Super Admin or Procurement can edit the catalog.
    const canManageCatalog = isManagementMode 
        ? isProcurementUser 
        : (membership?.org_role !== 'tenant');

    const [items, setItems] = useState<CatalogItem[]>(catalogCache[organizationId] || []);
    const [isLoading, setIsLoading] = useState(!catalogCache[organizationId]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeletingItemId, setIsDeletingItemId] = useState<string | null>(null);
    const [budgetType, setBudgetType] = useState<'rnm' | 'general'>('rnm');
    const [step, setStep] = useState<'browse' | 'finalize' | 'add' | 'bulk'>('browse');
    // Bulk upload state
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [isBulkUploading, setIsBulkUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState<BulkUploadResult | null>(null);
    const [bulkError, setBulkError] = useState<string>('');
    const bulkFileRef = useRef<HTMLInputElement>(null);
    const [procurementUsers, setProcurementUsers] = useState<any[]>([]);
    const [selectedProcurementId, setSelectedProcurementId] = useState<string>('');
    const [budgets, setBudgets] = useState<any[]>([]);
    const [isSuccess, setIsSuccess] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    
    // Add Item State
    const [newItem, setNewItem] = useState<NewItem>({
        name: '',
        description: '',
        category: '',
        estimated_price: '',
        unit: 'pcs',
        photo_base64: ''
    });
    const [addError, setAddError] = useState<string>('');
    const [isCompressing, setIsCompressing] = useState(false);
    const [customItemName, setCustomItemName] = useState('');
    const [customItemQty, setCustomItemQty] = useState(1);
    const [customItemUnit, setCustomItemUnit] = useState('pcs');
    const [customItemDesc, setCustomItemDesc] = useState('');
    const [customItemLinks, setCustomItemLinks] = useState('');
    const [customItemPhoto, setCustomItemPhoto] = useState('');
    const [isCompressingCustom, setIsCompressingCustom] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const customPhotoInputRef = useRef<HTMLInputElement>(null);
    const [visibilitySettings, setVisibilitySettings] = useState<{ roles: string[], users: string[] }>({ roles: ['procurement', 'admin'], users: [] });

    // Determine if the current user should see prices based on API response
    const shouldShowPrice = useMemo(() => {
        // We know we can see prices if the items we fetched have non-null estimated_price
        return items.length > 0 && items.some(i => i.estimated_price !== null && i.estimated_price !== undefined);
    }, [items]);

    const handleDeleteItem = async (itemId: string) => {
        if (!confirm('Remove this item from the catalog?')) return;
        setIsDeletingItemId(itemId);
        try {
            const res = await fetch('/api/procurement/catalog', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: itemId, organization_id: organizationId })
            });
            if (res.ok) {
                setItems(prev => prev.filter(i => i.id !== itemId));
                if (catalogCache[organizationId]) {
                    catalogCache[organizationId] = catalogCache[organizationId].filter(i => i.id !== itemId);
                }
            }
        } catch (err) {
            console.error('Failed to delete item:', err);
        } finally {
            setIsDeletingItemId(null);
        }
    };

    const handleBulkUpload = async () => {
        if (!bulkFile) return;
        setIsBulkUploading(true);
        setBulkError('');
        setBulkResult(null);
        try {
            const formData = new FormData();
            formData.append('file', bulkFile);
            formData.append('organizationId', organizationId);
            const res = await fetch('/api/procurement/catalog/bulk-upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok) {
                setBulkError(data.error || 'Upload failed');
            } else {
                setBulkResult(data);
                // Refresh catalog cache
                delete catalogCache[`${organizationId}-${propertyId}`];
                const fresh = await fetch(`/api/procurement/catalog?organizationId=${organizationId}${propertyId ? `&propertyId=${propertyId}` : ''}`).then(r => r.json());
                if (Array.isArray(fresh)) {
                    setItems(fresh);
                    catalogCache[`${organizationId}-${propertyId}`] = fresh;
                }
            }
        } catch (err) {
            setBulkError('Network error during upload');
        } finally {
            setIsBulkUploading(false);
        }
    };

    useEffect(() => {
        if (isOpen && organizationId) {
            initData();
        }
    }, [isOpen, organizationId, propertyId]);

    const initData = async () => {
        // Only show loading if we don't have cached data
        if (!catalogCache[organizationId] || !usersCache) {
            setIsLoading(true);
        }

        try {
            const [catalogData, usersData, budgetsData, settingsData] = await Promise.all([
                // Fetch catalog only if not cached for this property
                catalogCache[`${organizationId}-${propertyId}`] 
                    ? Promise.resolve(catalogCache[`${organizationId}-${propertyId}`]) 
                    : fetch(`/api/procurement/catalog?organizationId=${organizationId}${propertyId ? `&propertyId=${propertyId}` : ''}`).then(res => res.json()),
                
                // Fetch users only if not cached
                usersCache 
                    ? Promise.resolve(usersCache) 
                    : fetch('/api/procurement/users').then(res => res.json()),
                
                // Budgets are property-specific and should always be fresh
                propertyId 
                    ? fetch(`/api/procurement/budgets?propertyId=${propertyId}`).then(res => res.json())
                    : Promise.resolve([]),

                // Fetch visibility settings
                fetch(`/api/procurement/settings?organizationId=${organizationId}${propertyId ? `&propertyId=${propertyId}` : ''}`)
                    .then(res => res.json())
            ]);

            if (Array.isArray(catalogData)) {
                setItems(catalogData);
                catalogCache[`${organizationId}-${propertyId}`] = catalogData;
            }
            
            if (Array.isArray(usersData)) {
                setProcurementUsers(usersData);
                usersCache = usersData;
                if (usersData.length > 0 && !selectedProcurementId) {
                    setSelectedProcurementId(usersData[0].id);
                }
            }

            if (Array.isArray(budgetsData)) {
                setBudgets(budgetsData);
            }

            if (settingsData && (settingsData.price_visibility_roles || settingsData.price_visibility_users)) {
                setVisibilitySettings({
                    roles: settingsData.price_visibility_roles || ['procurement', 'admin'],
                    users: settingsData.price_visibility_users || []
                });
            }
        } catch (err) {
            console.error('Initialization failed:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchBudgets = async () => { // Kept for individual refreshes if needed
        try {
            const res = await fetch(`/api/procurement/budgets?propertyId=${propertyId}`);
            if (res.ok) {
                const data = await res.json();
                setBudgets(data || []);
            }
        } catch (err) {
            console.error('Failed to fetch budgets:', err);
        }
    };

    const addToCart = (item: CatalogItem) => {
        setCart(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
                return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const updateQuantity = (id: string, delta: number) => {
        setCart(prev => prev.map(i => {
            if (i.id === id) {
                const newQty = Math.max(1, i.quantity + delta);
                return { ...i, quantity: newQty };
            }
            return i;
        }));
    };

    const removeFromCart = (id: string) => {
        setCart(prev => prev.filter(i => i.id !== id));
    };

    const handleCustomPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsCompressingCustom(true);
        try {
            const compressedFile = await compressImage(file, {
                maxWidth: 400,
                maxHeight: 400,
                quality: 0.6,
                maxSizeKB: 100
            });

            const reader = new FileReader();
            reader.readAsDataURL(compressedFile);
            reader.onloadend = () => {
                setCustomItemPhoto(reader.result as string);
                setIsCompressingCustom(false);
            };
        } catch (err) {
            console.error('Compression failed:', err);
            setIsCompressingCustom(false);
        }
    };

    const addCustomToCart = () => {
        if (!customItemName.trim()) return;
        const newItem: CartItem = {
            id: `custom-${Date.now()}`,
            name: customItemName,
            quantity: customItemQty,
            estimated_price: 0,
            is_custom: true,
            unit: customItemUnit,
            photo_url: customItemPhoto || '',
            category: 'Custom',
            description: customItemDesc,
            links: customItemLinks.split(',').map(l => l.trim()).filter(Boolean),
            attachments: []
        };
        setCart(prev => [...prev, newItem]);
        setCustomItemName('');
        setCustomItemQty(1);
        setCustomItemUnit('pcs');
        setCustomItemDesc('');
        setCustomItemLinks('');
        setCustomItemPhoto('');
    };

    const totalAmount = cart.reduce((acc, item) => acc + ((item.estimated_price || 0) * item.quantity), 0);

    const getItemPhoto = (item: { photo_url?: string; name: string; category?: string }) => {
        const url = item.photo_url;
        // Only return the URL if it's a real photo (not a dynamic placeholder)
        if (url && !url.includes('loremflickr.com') && !url.includes('unsplash.com')) {
            return url;
        }
        // Return a static, consistent placeholder for items without photos
        return `https://placehold.co/400x400/f8fafc/cbd5e1?text=${encodeURIComponent(item.name.split(' ')[0] || 'Item')}`;
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsCompressing(true);
        try {
            const compressedFile = await compressImage(file, {
                maxWidth: 800,
                maxHeight: 800,
                quality: 0.7,
                maxSizeKB: 200
            });

            const reader = new FileReader();
            reader.readAsDataURL(compressedFile);
            reader.onloadend = () => {
                setNewItem(prev => ({ ...prev, photo_base64: reader.result as string }));
                setIsCompressing(false);
            };
        } catch (err) {
            console.error('Compression failed:', err);
            setIsCompressing(false);
        }
    };

    const handleAddItem = async () => {
        if (!newItem.name || !newItem.estimated_price) return;
        
        setIsSubmitting(true);
        setAddError('');
        try {
            const method = editingItemId ? 'PATCH' : 'POST';
            const body = {
                ...newItem,
                organization_id: organizationId,
                id: editingItemId
            };

            const res = await fetch('/api/procurement/catalog', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                const result = await res.json();
                
                if (editingItemId) {
                    setItems(prev => prev.map(i => i.id === editingItemId ? result : i));
                    // Update cache
                    if (catalogCache[organizationId]) {
                        catalogCache[organizationId] = catalogCache[organizationId].map(i => i.id === editingItemId ? result : i);
                    }
                } else {
                    setItems(prev => [result, ...prev]);
                    // Update cache
                    catalogCache[organizationId] = [result, ...(catalogCache[organizationId] || [])];
                }

                setNewItem({
                    name: '',
                    description: '',
                    category: '',
                    estimated_price: '',
                    unit: 'pcs',
                    photo_base64: ''
                });
                setEditingItemId(null);
                setStep('browse');
            } else {
                const data = await res.json();
                setAddError(data.error || 'Failed to save item');
            }
        } catch (err) {
            console.error('Failed to save item:', err);
            setAddError('Network error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        if (cart.length === 0 || !selectedProcurementId) return;
        
        setIsSubmitting(true);
        try {
            const hasCustomItems = cart.some(item => item.is_custom || !item.id);
            const res = await fetch('/api/procurement/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticket_id: ticketId,
                    property_id: propertyId,
                    organization_id: organizationId,
                    assignee_uid: selectedProcurementId,
                    budget_type: budgetType,
                    has_custom_items: hasCustomItems,
                    items: cart.map(item => ({
                        catalog_item_id: item.is_custom ? null : item.id,
                        name: item.name,
                        quantity: item.quantity,
                        unit_price: item.estimated_price,
                        photo_url: item.photo_url || '',
                        description: item.description,
                        links: item.links,
                        attachments: item.attachments
                    }))
                })
            });

            if (res.ok) {
                setIsSuccess(true);
                setTimeout(() => {
                    setIsSuccess(false);
                    onClose();
                    setCart([]); // Clear cart after success
                }, 1200);
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to send order');
            }
        } catch (err) {
            console.error('Submission failed:', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const safeItems = Array.isArray(items) ? items : [];
    const categories = ['All', ...Array.from(new Set(safeItems.map(i => i.category).filter(Boolean)))];
    const filteredItems = safeItems.filter(i => 
        (selectedCategory === 'All' || i.category === selectedCategory) &&
        (i.name.toLowerCase().includes(searchTerm.toLowerCase()) || (i.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-stretch justify-stretch bg-white lg:bg-slate-500/20 lg:backdrop-blur-sm">
            <div className="bg-slate-50 w-full h-full lg:max-w-[1200px] lg:h-[90vh] lg:m-auto lg:rounded-3xl lg:shadow-2xl flex flex-col overflow-hidden relative">
                
                {/* Header */}
                <div className="bg-white px-4 py-3 lg:px-6 lg:py-4 flex items-center justify-between border-b border-slate-100 lg:border-slate-200 flex-shrink-0 z-20">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg lg:rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <ShoppingBag className="w-4 h-4 lg:w-5 lg:h-5" />
                        </div>
                        <div>
                            <h2 className="text-sm lg:text-lg font-black text-slate-900 tracking-tight leading-none">
                                {isManagementMode ? 'Manage Items' : 'Buy Items'}
                            </h2>
                            <p className="hidden lg:block text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Common Items</p>
                            <p className="lg:hidden text-[9px] text-primary font-bold uppercase tracking-widest mt-1">Store</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 lg:gap-4">
                        {step === 'browse' && canManageCatalog && (
                            <>
                                <button 
                                    onClick={() => setStep('bulk')}
                                    className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-600 transition-all shadow-lg shadow-violet-500/20"
                                >
                                    <FileUp className="w-4 h-4" />
                                    Bulk Upload
                                </button>
                                <button 
                                    onClick={() => setStep('add')}
                                    className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Item
                                </button>
                            </>
                        )}
                        <button 
                            onClick={() => {
                                if (step === 'finalize') setStep('browse');
                                else setStep('finalize');
                            }}
                            className="lg:hidden relative p-2 rounded-lg bg-slate-50 text-slate-600 border border-slate-100"
                        >
                            <ShoppingCart className="w-5 h-5" />
                            {cart.length > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-primary text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white px-1">
                                    {cart.reduce((acc, i) => acc + i.quantity, 0)}
                                </span>
                            )}
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-50 text-slate-400 transition-all">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row min-h-0 relative">
                    {/* Success Overlay */}
                    <AnimatePresence>
                        {isSuccess && (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 z-[200] bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-10"
                            >
                                <motion.div 
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center text-white mb-6 shadow-2xl shadow-green-200"
                                >
                                    <CheckCircle2 className="w-12 h-12" />
                                </motion.div>
                                <h3 className="text-3xl font-black text-slate-900 mb-2">Request Sent!</h3>
                                <p className="text-slate-500 font-bold max-w-xs">
                                    Your request has been sent to procurement.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Main Content Side */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-white lg:bg-slate-50">
                        {step === 'browse' ? (
                            <>
                                {/* Filters Bar */}
                                <div className="p-4 lg:p-6 space-y-4 bg-white border-b border-slate-100 lg:border-none shadow-sm lg:shadow-none z-10">
                                    <div className="flex flex-col sm:flex-row gap-4">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input 
                                                type="text"
                                                placeholder="Search for items, tools..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                className="w-full bg-white border-none rounded-2xl py-3.5 pl-12 pr-4 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-primary/20 outline-none"
                                            />
                                        </div>
                                        {canManageCatalog && (
                                            <button 
                                                onClick={() => setStep('add')}
                                                className="lg:hidden w-full bg-emerald-500 text-white rounded-2xl py-3.5 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10"
                                            >
                                                <Plus className="w-4 h-4" />
                                                New Item
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 lg:mx-0 lg:px-0">
                                        {categories.map(cat => (
                                            <button
                                                key={cat}
                                                onClick={() => setSelectedCategory(cat)}
                                                className={`px-4 py-2.5 rounded-xl text-[9px] font-black whitespace-nowrap transition-all border uppercase tracking-widest
                                                    ${selectedCategory === cat 
                                                        ? 'bg-primary text-white border-primary shadow-md shadow-primary/20' 
                                                        : 'bg-white text-slate-500 border-slate-100 hover:bg-slate-50 hover:text-slate-900'}`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Items Grid */}
                                <div className="flex-1 overflow-y-auto px-2 pb-24 lg:px-6 lg:pb-8 custom-scrollbar bg-slate-50/50">
                                    {isLoading ? (
                                        <div className="h-full flex items-center justify-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center">
                                                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                                </div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Loading Items...</p>
                                            </div>
                                        </div>
                                    ) : filteredItems.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-6">
                                            <div className="w-20 h-20 rounded-[2.5rem] bg-white shadow-xl shadow-slate-200/50 flex items-center justify-center">
                                                <Package className="w-10 h-10 opacity-20 text-slate-300" />
                                            </div>
                                            <div className="text-center space-y-4">
                                                <p className="font-black text-[10px] uppercase tracking-[0.3em] text-slate-900">No items found</p>
                                                <p className="text-[9px] font-bold text-slate-400">Can't find what you're looking for? Add it manually.</p>
                                                <button 
                                                    onClick={() => setStep('finalize')}
                                                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:-translate-y-1 transition-all"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Add Custom Item
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 lg:gap-3 pt-2 lg:pt-0">
                                            {filteredItems.map(item => (
                                                <div 
                                                    key={`cat-item-${item.id}`}
                                                    className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col overflow-hidden group"
                                                >
                                                    {/* Image Container - More Compact */}
                                                    <div className="aspect-[5/4] relative bg-slate-50/30 p-2 lg:p-3 flex items-center justify-center overflow-hidden border-b border-slate-50">
                                                        <img 
                                                            src={getItemPhoto(item)}
                                                            alt={item.name}
                                                            className="w-full h-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-700"
                                                            loading="lazy"
                                                            onError={(e) => {
                                                                const target = e.target as HTMLImageElement;
                                                                target.onerror = null;
                                                                target.src = 'https://placehold.co/400x400/f8fafc/cbd5e1?text=No+Photo';
                                                            }}
                                                        />
                                                        
                                                        {/* Management Buttons Overlay — restricted during material requests */}
                                                        {canManageCatalog && (
                                                            <div className="absolute top-2 right-2 flex flex-col gap-1.5 translate-x-12 group-hover:translate-x-0 transition-transform duration-300">
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingItemId(item.id);
                                                                        setNewItem({
                                                                            name: item.name,
                                                                            description: item.description || '',
                                                                            category: item.category || '',
                                                                            estimated_price: item.estimated_price?.toString() || '0',
                                                                            unit: item.unit || 'pcs',
                                                                            photo_base64: item.photo_url || ''
                                                                        });
                                                                        setAddError('');
                                                                        setStep('add');
                                                                    }}
                                                                    className="p-2 bg-white shadow-xl shadow-slate-200 rounded-xl text-slate-400 hover:text-primary transition-all active:scale-95 border border-slate-100"
                                                                >
                                                                    <Edit2 className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteItem(item.id);
                                                                    }}
                                                                    disabled={isDeletingItemId === item.id}
                                                                    className="p-2 bg-white shadow-xl shadow-slate-200 rounded-xl text-slate-400 hover:text-rose-500 transition-all active:scale-95 border border-slate-100 disabled:opacity-50"
                                                                >
                                                                    {isDeletingItemId === item.id
                                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                        : <Trash2 className="w-3.5 h-3.5" />
                                                                    }
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
 
                                                    {/* Content - Compact Typography */}
                                                    <div className="p-2.5 lg:p-3 flex flex-col flex-1">
                                                        <div className="flex-1">
                                                            <h4 className="text-[10px] lg:text-[11px] font-black text-slate-900 leading-tight line-clamp-2 mb-1 tracking-tight">
                                                                {item.name}
                                                            </h4>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                                                                    {item.unit || 'unit'}
                                                                </span>
                                                                {item.category && (
                                                                    <>
                                                                        <span className="w-0.5 h-0.5 rounded-full bg-slate-200"></span>
                                                                        <span className="text-[8px] font-bold text-slate-400 truncate">
                                                                            {item.category}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
 
                                                        <div className="flex items-center justify-between mt-3">
                                                            <div className="flex flex-col">
                                                                <span className="text-[11px] lg:text-xs font-black text-slate-900 tracking-tighter">
                                                                    {shouldShowPrice && item.estimated_price !== null ? `₹${item.estimated_price?.toLocaleString()}` : ''}
                                                                </span>
                                                            </div>
                                                            
                                                            {!isManagementMode && (
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        addToCart(item);
                                                                    }}
                                                                    className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-slate-50 text-slate-400 hover:bg-primary hover:text-white hover:shadow-lg hover:shadow-primary/20 transition-all flex items-center justify-center active:scale-90"
                                                                >
                                                                    <Plus className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Mobile Sticky Bottom Bar */}
                                    <div className="lg:hidden fixed bottom-6 left-4 right-4 z-[110]">
                                        <button 
                                            onClick={() => setStep('finalize')}
                                            className="w-full bg-slate-900/95 backdrop-blur-md text-white rounded-[1.5rem] p-3 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom-6 duration-500 border border-white/10"
                                        >
                                            <div className="flex items-center gap-3 pl-2">
                                                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                                                    <ShoppingCart className="w-5 h-5" />
                                                </div>
                                                <div className="text-left">
                                                    <p className="text-[9px] font-black text-primary uppercase tracking-widest leading-none mb-1">
                                                        {cart.length > 0 ? 'Items in Cart' : 'Custom Request'}
                                                    </p>
                                                    <p className="text-sm font-black tracking-tight">
                                                        {cart.length > 0 ? (
                                                            shouldShowPrice ? (
                                                                <>₹{totalAmount.toLocaleString()} <span className="text-white/40 font-bold ml-1">• {cart.reduce((acc, i) => acc + i.quantity, 0)} items</span></>
                                                            ) : (
                                                                <>{cart.reduce((acc, i) => acc + i.quantity, 0)} items</>
                                                            )
                                                        ) : (
                                                            'Add Custom Item'
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 bg-primary text-white px-5 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-primary/10">
                                                {cart.length > 0 ? 'Checkout' : 'Go to Review'}
                                                <ChevronRight className="w-4 h-4" />
                                            </div>
                                        </button>
                                    </div>

                            </>
                        ) : step === 'add' ? (
                            <div className="flex-1 flex flex-col bg-white animate-in slide-in-from-right duration-300 overflow-y-auto pb-20">
                                <div className="max-w-2xl mx-auto w-full py-8 px-6 space-y-10">
                                    <div className="flex items-center gap-4">
                                        <button 
                                            onClick={() => {
                                                setStep('browse');
                                                setEditingItemId(null);
                                                setNewItem({
                                                    name: '',
                                                    description: '',
                                                    category: '',
                                                    estimated_price: '',
                                                    unit: 'pcs',
                                                    photo_base64: ''
                                                });
                                                setAddError('');
                                            }}
                                            className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all"
                                        >
                                            <ArrowLeft className="w-6 h-6" />
                                        </button>
                                        <div>
                                            <h3 className="font-black text-slate-900 text-2xl tracking-tight">
                                                {editingItemId ? 'Edit Item' : 'Add New Item'}
                                            </h3>
                                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                                                {editingItemId ? 'Update item details' : 'Add new item to store'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-6">
                                            {/* Photo Upload Area */}
                                            <div className="space-y-3">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Item Image</label>
                                                <div 
                                                    onClick={() => fileInputRef.current?.click()}
                                                    className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group overflow-hidden relative"
                                                >
                                                    {newItem.photo_base64 ? (
                                                        <>
                                                            <img src={newItem.photo_base64} alt="Preview" className="w-full h-full object-contain p-4" />
                                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                <Camera className="w-8 h-8 text-white" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {isCompressing ? (
                                                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                                                            ) : (
                                                                <>
                                                                    <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                                        <Upload className="w-8 h-8 text-slate-300" />
                                                                    </div>
                                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Click to upload</p>
                                                                    <p className="text-[9px] text-slate-300 font-bold mt-1">Auto-compressed WebP</p>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                                <input 
                                                    type="file" 
                                                    ref={fileInputRef}
                                                    onChange={handleFileChange}
                                                    accept="image/*"
                                                    className="hidden" 
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Item Name</label>
                                                <input 
                                                    type="text"
                                                    placeholder="e.g. 20W LED Bulb"
                                                    value={newItem.name}
                                                    onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Estimated Price</label>
                                                    <div className="relative">
                                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                                                        <input 
                                                            type="number"
                                                            placeholder="0.00"
                                                            value={newItem.estimated_price}
                                                            onChange={(e) => setNewItem({...newItem, estimated_price: e.target.value})}
                                                            onFocus={(e) => e.target.select()}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-8 pr-4 text-sm font-black focus:ring-2 focus:ring-primary/20 outline-none"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Unit</label>
                                                    <select 
                                                        value={newItem.unit}
                                                        onChange={(e) => setNewItem({...newItem, unit: e.target.value})}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-4 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none appearance-none"
                                                    >
                                                        <option value="pcs">pcs</option>
                                                        <option value="pkt">pkt</option>
                                                        <option value="mtr">mtr</option>
                                                        <option value="kg">kg</option>
                                                        <option value="ltr">ltr</option>
                                                        <option value="box">box</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Category</label>
                                                <input 
                                                    type="text"
                                                    placeholder="e.g. Electrical, Plumbing..."
                                                    value={newItem.category}
                                                    onChange={(e) => setNewItem({...newItem, category: e.target.value})}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Details (Optional)</label>
                                        <textarea 
                                            placeholder="Add technical specifications or notes..."
                                            value={newItem.description}
                                            onChange={(e) => setNewItem({...newItem, description: e.target.value})}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-3xl py-4 px-5 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none min-h-[120px] resize-none"
                                        />
                                    </div>

                                    {addError && (
                                        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 flex items-center gap-3 text-rose-600 animate-in fade-in slide-in-from-top-2">
                                            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                            <p className="text-xs font-bold">{addError}</p>
                                        </div>
                                    )}

                                    <button 
                                        onClick={handleAddItem}
                                        disabled={isSubmitting || !newItem.name || !newItem.estimated_price}
                                        className="w-full bg-slate-900 text-white font-black py-5 rounded-[2rem] hover:bg-primary transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-3 disabled:opacity-50"
                                    >
                                        {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : editingItemId ? <CheckCircle2 className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                                        {isSubmitting ? 'Saving Changes...' : editingItemId ? 'Update Item' : 'Save to Store'}
                                    </button>
                                </div>
                            </div>
                        ) : step === 'bulk' ? (
                            <div className="flex-1 flex flex-col bg-white animate-in slide-in-from-right duration-300 overflow-y-auto pb-20">
                                <div className="max-w-2xl mx-auto w-full py-8 px-6 space-y-8">
                                    {/* Header */}
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => { setStep('browse'); setBulkFile(null); setBulkResult(null); setBulkError(''); }}
                                            className="p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all">
                                            <ArrowLeft className="w-6 h-6" />
                                        </button>
                                        <div>
                                            <h3 className="font-black text-slate-900 text-2xl tracking-tight">Bulk Upload</h3>
                                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">AI maps your CSV columns automatically</p>
                                        </div>
                                    </div>

                                    {/* Success result */}
                                    {bulkResult && !bulkError && (
                                        <div className="rounded-3xl bg-emerald-50 border border-emerald-100 p-6 space-y-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                                                    <CheckCircle2 className="w-6 h-6" />
                                                </div>
                                                <div>
                                                    <p className="font-black text-emerald-800 text-lg">{bulkResult.inserted} items added</p>
                                                    <div className="flex flex-col">
                                                        {bulkResult.skipped > 0 && <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">{bulkResult.skipped} empty rows skipped</p>}
                                                        {(bulkResult as any).duplicates > 0 && <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">{(bulkResult as any).duplicates} duplicates skipped</p>}
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Column mapping display */}
                                            <div className="bg-white rounded-2xl border border-emerald-100 p-4">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-violet-400" /> AI Column Mapping</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {Object.entries(bulkResult.mapping).map(([field, col]) => (
                                                        <div key={field} className="flex items-center justify-between text-[11px]">
                                                            <span className="font-bold text-slate-500 uppercase tracking-wide">{field}</span>
                                                            <span className={`font-black px-2 py-0.5 rounded-lg ${col ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{col || '—'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {bulkResult.preview?.length > 0 && (
                                                <div>
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">First {bulkResult.preview.length} Added</p>
                                                    <div className="space-y-1.5">
                                                        {bulkResult.preview.map((item: any, i: number) => (
                                                            <div key={i} className="flex items-center justify-between bg-white rounded-xl border border-slate-100 px-3 py-2">
                                                                <span className="text-xs font-bold text-slate-800">{item.name}</span>
                                                                <span className="text-[10px] font-black text-slate-400">{item.category || '—'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <button onClick={() => { setStep('browse'); setBulkFile(null); setBulkResult(null); }}
                                                className="w-full bg-slate-900 text-white font-black py-4 rounded-[1.5rem] hover:bg-primary transition-all">
                                                Back to Catalog
                                            </button>
                                        </div>
                                    )}

                                    {/* Error */}
                                    {bulkError && (
                                        <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4 flex items-start gap-3">
                                            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="font-black text-rose-700 text-sm">Upload Failed</p>
                                                <p className="text-xs text-rose-500 mt-1">{bulkError}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Upload zone — only shown before success */}
                                    {!bulkResult && (
                                        <>
                                            {/* Drop zone */}
                                            <div
                                                onClick={() => bulkFileRef.current?.click()}
                                                className={`rounded-[2rem] border-2 border-dashed p-10 flex flex-col items-center justify-center cursor-pointer transition-all group
                                                    ${bulkFile ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50'}`}
                                            >
                                                {bulkFile ? (
                                                    <>
                                                        <div className="w-14 h-14 rounded-2xl bg-violet-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-200 text-white">
                                                            <FileUp className="w-7 h-7" />
                                                        </div>
                                                        <p className="font-black text-violet-700 text-sm">{bulkFile.name}</p>
                                                        <p className="text-xs text-violet-400 font-bold mt-1">{(bulkFile.size / 1024).toFixed(1)} KB · Click to change</p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                            <Upload className="w-7 h-7 text-slate-300" />
                                                        </div>
                                                        <p className="font-black text-slate-900 text-lg tracking-tight">Drop your file here</p>
                                                        <p className="text-xs text-slate-400 font-bold mt-1">Excel, Google Sheets (XLSX) or CSV · Max 500 rows</p>
                                                    </>
                                                )}
                                            </div>
                                            <input ref={bulkFileRef} type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden"
                                                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBulkFile(f); setBulkError(''); } }} />

                                            {/* AI info banner */}
                                            <div className="flex items-start gap-3 p-4 bg-violet-50 rounded-2xl border border-violet-100">
                                                <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
                                                <p className="text-xs text-violet-700 font-bold leading-relaxed">
                                                    AI will read your spreadsheet column headers and automatically map them to: <span className="font-black">name, description, category, unit, price</span>. It works with any column names.
                                                </p>
                                            </div>

                                            <button
                                                onClick={handleBulkUpload}
                                                disabled={!bulkFile || isBulkUploading}
                                                className="w-full bg-violet-600 text-white font-black py-5 rounded-[2rem] hover:bg-violet-700 transition-all shadow-xl shadow-violet-200 flex items-center justify-center gap-3 disabled:opacity-50"
                                            >
                                                {isBulkUploading ? (
                                                    <><Loader2 className="w-6 h-6 animate-spin" /> Analysing with AI...</>
                                                ) : (
                                                    <><Sparkles className="w-6 h-6" /> Upload & Auto-Map</>
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
        ) : (
                                    <div className="flex-1 overflow-y-auto w-full custom-scrollbar bg-white lg:bg-slate-50/50">
                                        <div className="max-w-2xl mx-auto w-full py-6 lg:py-10 lg:space-y-10 px-4 lg:px-0">
                                        {/* Simplified Header */}
                                        <div className="flex items-center justify-between p-4 lg:p-0">
                                            <div className="flex items-center gap-3 lg:gap-4">
                                                <button 
                                                    onClick={() => setStep('browse')}
                                                    className="p-2.5 lg:p-3 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all border border-slate-100 lg:border-none"
                                                >
                                                    <ArrowLeft className="w-5 h-5 lg:w-6 lg:h-6" />
                                                </button>
                                                <div>
                                                    <h3 className="font-black text-slate-900 text-lg lg:text-2xl tracking-tight">Review Order</h3>
                                                    <p className="text-[9px] lg:text-xs text-slate-400 font-black uppercase tracking-widest mt-0.5 lg:mt-1">Choose account & staff</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Main Settings Column */}
                                        <div className="space-y-10">
                                            {/* Budget Selection */}
                                            <div className="space-y-4">
                                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                    <IndianRupee className="w-4 h-4 text-primary" /> Pick Account Type
                                                </h4>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4 px-4 lg:px-0">
                                                    {['rnm', 'general'].map((type) => {
                                                        const budget = budgets.find(b => b.budget_type === type);
                                                        const remaining = budget ? (budget.total_amount - budget.spent_amount) : 0;
                                                        const label = type === 'rnm' ? 'Repair and Maintenance Account' : 'General Account';
                                                        
                                                        return (
                                                            <button 
                                                                key={type}
                                                                onClick={() => setBudgetType(type as any)}
                                                                className={`group relative overflow-hidden p-4 lg:p-5 rounded-2xl lg:rounded-3xl border transition-all duration-300 text-left ${
                                                                    budgetType === type 
                                                                    ? 'border-primary bg-primary/[0.03] shadow-sm ring-1 ring-primary/10' 
                                                                    : 'border-slate-100 bg-white hover:border-slate-200 shadow-sm hover:shadow-md'
                                                                }`}
                                                            >
                                                                <div className="relative z-10 flex items-center gap-3 lg:gap-4">
                                                                    <div className={`p-2 lg:p-3 rounded-xl transition-all duration-300 ${budgetType === type ? 'bg-primary text-white shadow-md' : 'bg-slate-50 text-slate-400'}`}>
                                                                        {type === 'rnm' ? <Tag className="w-4 h-4 lg:w-5 lg:h-5" /> : <Package className="w-4 h-4 lg:w-5 lg:h-5" />}
                                                                    </div>
                                                                    
                                                                    <div className="flex-1 min-w-0">
                                                                        <h4 className="text-[11px] lg:text-xs font-black text-slate-900 leading-tight mb-1 truncate">{label}</h4>
                                                                        {shouldShowPrice && (
                                                                            <div className="flex items-baseline gap-1.5">
                                                                                <span className={`text-sm lg:text-lg font-black tracking-tight ${budget && budget.total_amount !== null ? (remaining >= totalAmount ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-400'}`}>
                                                                                    {budget && budget.total_amount !== null ? `₹${remaining.toLocaleString()}` : ''}
                                                                                </span>
                                                                                <span className="text-[7px] lg:text-[8px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Current Balance</span>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {budgetType === type && (
                                                                        <div className="bg-primary/10 p-1 rounded-full flex-shrink-0">
                                                                            <CheckCircle2 className="w-3 h-3 lg:w-4 lg:h-4 text-primary" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Personnel Assignment */}
                                            <div className="space-y-3 lg:space-y-4 px-4 lg:px-0">
                                                <h4 className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                    <User className="w-4 h-4 text-primary" /> Choose Staff for Order
                                                </h4>
                                                <div className="relative group">
                                                    <select 
                                                        value={selectedProcurementId}
                                                        onChange={(e) => setSelectedProcurementId(e.target.value)}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] lg:rounded-3xl py-4 lg:py-5 px-5 lg:px-6 text-xs lg:text-sm font-black shadow-inner focus:ring-2 focus:ring-primary/20 outline-none appearance-none cursor-pointer transition-all hover:bg-slate-100"
                                                    >
                                                        <option value="" disabled>Pick Staff Member</option>
                                                        {procurementUsers.map(user => (
                                                            <option key={user.id} value={user.id}>{user.full_name}</option>
                                                        ))}
                                                    </select>
                                                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                        <ChevronRight className="w-4 h-4 lg:w-5 lg:h-5 rotate-90" />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Compact Items List (Requested by User) */}
                                            <div className="space-y-3 lg:space-y-4 px-4 lg:px-0">
                                                <h4 className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                    <Package className="w-4 h-4 text-primary" /> Items Ordered
                                                </h4>
                                                <div className="bg-slate-50/50 rounded-[2rem] border border-slate-100 overflow-hidden">
                                                    <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar">
                                                        {cart.map(item => (
                                                            <div key={`finalize-item-${item.id}`} className="p-3 lg:p-4 flex items-center justify-between group hover:bg-white transition-all">
                                                                <div className="flex items-center gap-3 lg:gap-4 min-w-0">
                                                                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center p-1.5 flex-shrink-0">
                                                                        {item.is_custom ? (
                                                                            <Package className="w-5 h-5 text-slate-300" />
                                                                        ) : (
                                                                            <img 
                                                                                src={getItemPhoto(item as CatalogItem)}
                                                                                alt=""
                                                                                className="w-full h-full object-contain mix-blend-multiply"
                                                                                onError={(e) => {
                                                                                    (e.target as HTMLImageElement).src = 'https://placehold.co/400x400/f8fafc/cbd5e1?text=No+Photo';
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div className="truncate">
                                                                        <p className="text-[11px] lg:text-xs font-black text-slate-900 truncate">
                                                                            {item.name}
                                                                            {item.is_custom && <span className="ml-2 text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">Custom</span>}
                                                                        </p>
                                                                        {item.description && (
                                                                            <p className="text-[9px] text-slate-400 font-medium truncate mt-0.5">{item.description}</p>
                                                                        )}
                                                                        <div className="flex gap-2 mt-1">
                                                                            {item.links?.map((link, i) => (
                                                                                <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="text-[8px] text-primary hover:underline flex items-center gap-0.5">
                                                                                    <Link2 className="w-2 h-2" /> Link {i + 1}
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                        {shouldShowPrice && !item.is_custom && (
                                                                            <p className="text-[9px] lg:text-[10px] text-slate-400 font-bold uppercase tracking-tight">₹{item.estimated_price?.toLocaleString() ?? '0'}</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-4">
                                                                    <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1">
                                                                        <button 
                                                                            onClick={() => updateQuantity(item.id, -1)}
                                                                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-primary transition-colors"
                                                                        >
                                                                            <Minus className="w-3 h-3" />
                                                                        </button>
                                                                        <span className="min-w-[20px] text-center text-[10px] font-black text-slate-900">{item.quantity}</span>
                                                                        <button 
                                                                            onClick={() => updateQuantity(item.id, 1)}
                                                                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-primary transition-colors"
                                                                        >
                                                                            <Plus className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                    <div className="text-right min-w-[70px]">
                                                                        <p className="text-xs lg:text-sm font-black text-slate-900 tracking-tight">
                                                                            {shouldShowPrice && !item.is_custom && item.estimated_price !== null ? `₹${((item.estimated_price ?? 0) * item.quantity).toLocaleString()}` : ''}
                                                                        </p>
                                                                    </div>
                                                                    <button 
                                                                        onClick={() => removeFromCart(item.id)}
                                                                        className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        
                                                        {/* Custom Item Entry Row */}
                                                        <div className="p-3 lg:p-4 bg-primary/5 border-t border-primary/10 space-y-3">
                                                            <p className="text-[9px] font-black text-primary uppercase tracking-widest">Item not in list? Add it here</p>
                                                            <div className="flex flex-col sm:flex-row gap-3">
                                                                <div className="flex-1">
                                                                    <input 
                                                                        type="text"
                                                                        placeholder="Item Name (e.g. Special Drill Bit)"
                                                                        value={customItemName}
                                                                        onChange={(e) => setCustomItemName(e.target.value)}
                                                                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                                                    />
                                                                </div>
                                                                <div className="flex gap-2">
                                                                    <div className="w-20">
                                                                        <input 
                                                                            type="text"
                                                                            placeholder="Unit"
                                                                            value={customItemUnit}
                                                                            onChange={(e) => setCustomItemUnit(e.target.value)}
                                                                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-2 text-[10px] font-bold focus:ring-2 focus:ring-primary/20 outline-none text-center"
                                                                        />
                                                                    </div>
                                                                    <div className="w-16">
                                                                        <input 
                                                                            type="number"
                                                                            placeholder="Qty"
                                                                            value={customItemQty}
                                                                            onChange={(e) => setCustomItemQty(parseInt(e.target.value) || 1)}
                                                                            onFocus={(e) => e.target.select()}
                                                                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none text-center"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col sm:flex-row gap-3">
                                                                <div className="flex-1">
                                                                    <input 
                                                                        type="text"
                                                                        placeholder="Details/Specs (Optional)"
                                                                        value={customItemDesc}
                                                                        onChange={(e) => setCustomItemDesc(e.target.value)}
                                                                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                                                    />
                                                                </div>
                                                                <div className="flex-1 flex gap-2">
                                                                    <input 
                                                                        type="text"
                                                                        placeholder="Links (comma separated)"
                                                                        value={customItemLinks}
                                                                        onChange={(e) => setCustomItemLinks(e.target.value)}
                                                                        className="flex-1 bg-white border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                                                    />
                                                                    <div className="flex-shrink-0">
                                                                        <input 
                                                                            type="file"
                                                                            ref={customPhotoInputRef}
                                                                            onChange={handleCustomPhotoChange}
                                                                            accept="image/*"
                                                                            className="hidden"
                                                                        />
                                                                        <button 
                                                                            onClick={() => customPhotoInputRef.current?.click()}
                                                                            className={`h-full px-3 rounded-xl border border-dashed transition-all flex items-center justify-center gap-2 ${customItemPhoto ? 'bg-primary/10 border-primary text-primary' : 'bg-white border-slate-200 text-slate-400 hover:border-primary/50'}`}
                                                                        >
                                                                            {isCompressingCustom ? <Loader2 className="w-4 h-4 animate-spin" /> : customItemPhoto ? <CheckCircle2 className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                                                                            <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Photo</span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <button 
                                                                    onClick={addCustomToCart}
                                                                    disabled={!customItemName.trim() || isCompressingCustom}
                                                                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50"
                                                                >
                                                                    Add
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="p-3 lg:p-4 bg-slate-100/50 flex items-center justify-between">
                                                        <span className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest">{shouldShowPrice ? 'Total for items' : 'Items'}</span>
                                                        <span className="text-xs lg:text-sm font-black text-slate-900 tracking-tight">{shouldShowPrice ? `₹${totalAmount.toLocaleString()}` : `${cart.reduce((acc, i) => acc + i.quantity, 0)} items`}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Summary & Submit */}
                                            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-4 px-4 pb-12 lg:pb-0 lg:px-0">
                                                <div className="w-full sm:flex-1">
                                                    <p className="text-[9px] lg:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{shouldShowPrice ? 'Total Amount' : 'Total Items'}</p>
                                                    <p className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tighter">{shouldShowPrice ? `₹${totalAmount.toLocaleString()}` : cart.reduce((acc, i) => acc + i.quantity, 0)}</p>
                                                </div>
                                                <button 
                                                    onClick={handleSubmit}
                                                    disabled={isSubmitting || cart.length === 0}
                                                    className="w-full sm:w-[280px] bg-primary text-white font-black py-4 lg:py-5 rounded-[1.5rem] lg:rounded-[2rem] hover:bg-primary/90 transition-all shadow-xl lg:shadow-2xl shadow-primary/20 flex items-center justify-center gap-3 disabled:opacity-50"
                                                >
                                                    {isSubmitting ? <Loader2 className="w-5 h-5 lg:w-6 lg:h-6 animate-spin" /> : <ShoppingBag className="w-5 h-5 lg:w-6 lg:h-6" />}
                                                    {isSubmitting ? 'Sending Order...' : 'Send Order'}
                                                </button>
                                            </div>


                                            </div>
                                        </div>
                                    </div>
                        )}
                    </div>

                {/* Checkout Side Bar (Desktop) */}
                {!isManagementMode && (
                    <div className="hidden lg:flex w-[280px] bg-white border-l border-slate-200 flex-col overflow-hidden relative">
                        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
                        <div className="space-y-5 h-full flex flex-col">
                            <div className="flex items-center justify-between px-1 flex-shrink-0">
                                <h3 className="font-black text-slate-800 uppercase tracking-widest text-[10px] flex items-center gap-2">
                                    <Tag className="w-4 h-4 text-primary" /> Cart
                                </h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                        {cart.reduce((acc, i) => acc + i.quantity, 0)} Items
                                    </span>
                                </div>
                            </div>
                            
                            {cart.length > 0 && shouldShowPrice && (
                                <div className="py-4 border-b border-slate-100 flex items-baseline justify-between flex-shrink-0">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total to pay</span>
                                    <span className="text-2xl font-black text-slate-900 tracking-tighter">₹{totalAmount.toLocaleString()}</span>
                                </div>
                            )}
                            
                            <div className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-1 scrollbar-hide">
                                {cart.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100">
                                        <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                                            <ShoppingCart className="w-6 h-6 text-slate-200" />
                                        </div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Your cart is empty</p>
                                        <p className="text-[9px] text-slate-300 font-bold mt-1">Add items from the catalog</p>
                                    </div>
                                ) : cart.map(item => (
                                    <div key={`sidebar-item-${item.id}`} className="flex items-center justify-between py-2.5 hover:bg-white transition-all group border-b border-slate-50 last:border-0">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center p-1 flex-shrink-0 border border-slate-100">
                                                <img 
                                                    src={getItemPhoto(item)}
                                                    alt=""
                                                    className="w-full h-full object-contain mix-blend-multiply"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-[11px] font-bold text-slate-900 truncate leading-none">{item.name}</h4>
                                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">
                                                    {shouldShowPrice && !item.is_custom ? `${item.quantity} × ₹${item.estimated_price?.toLocaleString() ?? '0'}` : `${item.quantity} ${item.unit || 'items'}`}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 ml-4">
                                            {shouldShowPrice && !item.is_custom && (
                                                <span className="text-[11px] font-black text-slate-900">₹{((item.estimated_price ?? 0) * item.quantity).toLocaleString()}</span>
                                            )}
                                            <button 
                                                onClick={() => removeFromCart(item.id)}
                                                className="p-1 text-slate-300 hover:text-rose-500 transition-all lg:opacity-0 lg:group-hover:opacity-100"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            </div>
                        </div>

                    <div className="p-4 bg-white border-t border-slate-100">
                        <button 
                            onClick={() => {
                                if (step === 'add' || step === 'bulk') {
                                    setStep('browse');
                                    setEditingItemId(null);
                                }
                                else if (isManagementMode) onClose();
                                else setStep(step === 'browse' ? 'finalize' : 'browse');
                            }}
                            disabled={!isManagementMode && step !== 'browse' && cart.length === 0}
                            className={`w-full font-black py-4 rounded-2xl transition-all shadow-xl flex items-center justify-center gap-2 disabled:opacity-50
                                ${step === 'browse' ? (isManagementMode ? 'bg-slate-900 text-white shadow-slate-900/20' : 'bg-primary text-white shadow-primary/20') : 
                                  (step === 'add' || step === 'bulk') ? 'bg-slate-100 text-slate-400 shadow-none' : 
                                  'bg-slate-900 text-white shadow-slate-900/20'}`}
                        >
                            {step === 'browse' ? (
                                isManagementMode ? (
                                    <>
                                        <CheckCircle2 className="w-5 h-5" />
                                        Close Catalog
                                    </>
                                ) : (
                                    <>
                                        <ShoppingBag className="w-5 h-5" />
                                        {cart.length > 0 ? 'Checkout' : 'Checkout / Custom'}
                                    </>
                                )
                            ) : (step === 'add' || step === 'bulk') ? (
                                <>
                                    <ArrowLeft className="w-5 h-5" />
                                    Cancel
                                </>
                            ) : (
                                <>
                                    <ArrowLeft className="w-5 h-5" />
                                    Back to Catalog
                                </>
                            )}
                        </button>
                    </div>
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}
