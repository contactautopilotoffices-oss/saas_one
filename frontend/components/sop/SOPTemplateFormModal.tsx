'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Check, Info, Edit3, Camera, Paperclip, MapPin, Image as ImageIcon, Loader2, Eye, Clock, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { Toast } from '@/frontend/components/ui/Toast';
import SOPCADConfigModal from '@/frontend/components/sop/SOPCADConfigModal';
import ImagePreviewModal from '@/frontend/components/shared/ImagePreviewModal';

export interface ChecklistStepParameter {
    id: string;
    name: string;
    type: 'yes_no' | 'checkbox' | 'text' | 'number';
    is_required?: boolean;
}

interface SOPTemplateFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    template?: any;
    initialData?: {
        title?: string;
        description?: string;
        category?: string;
        frequency?: string;
        items?: { title: string; type?: string }[];
    };
    onSuccess?: () => void;
}

const SOPTemplateFormModal: React.FC<SOPTemplateFormModalProps> = ({ isOpen, onClose, propertyId, template, initialData, onSuccess }) => {
    const [mounted, setMounted] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        category: 'general',
        frequency: 'daily',
        assigned_to: [] as string[],
        start_time: '09:00',
        end_time: '17:00',
    });

    const [items, setItems] = useState<any[]>([]);
    const [newItem, setNewItem] = useState<{
        id?: string;
        title: string;
        description: string;
        requires_photo: boolean;
        requires_comment: boolean;
        type: 'checkbox' | 'text' | 'number' | 'yes_no';
        is_optional: boolean;
        start_time: string;
        end_time: string;
        parameters: ChecklistStepParameter[];
        reference_photos?: any[];
        reference_photo_url?: string | null;
        reference_photo_source?: string | null;
        cad_area_id?: string | null;
    }>({
        title: '',
        description: '',
        requires_photo: false,
        requires_comment: false,
        type: 'checkbox',
        is_optional: false,
        start_time: '',
        end_time: '',
        parameters: [],
        reference_photos: [],
        reference_photo_url: null,
        reference_photo_source: null,
        cad_area_id: null,
    });
    const [showStepTimeSlot, setShowStepTimeSlot] = useState(false);
    const [showParametersSection, setShowParametersSection] = useState(false);
    const [paramDraftName, setParamDraftName] = useState('');
    const [paramDraftType, setParamDraftType] = useState<'yes_no' | 'checkbox' | 'text' | 'number'>('yes_no');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [propertyMembers, setPropertyMembers] = useState<any[]>([]);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [currentPropertyId, setCurrentPropertyId] = useState<string | null>(null);
    const [showCADModal, setShowCADModal] = useState(false);
    const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null);
    const activeTemplateId = template?.id || createdTemplateId;
    const [referencePhotoUploads, setReferencePhotoUploads] = useState<Record<number, { uploading: boolean; url?: string }>>({});
    const [templateCADStatus, setTemplateCADStatus] = useState<{ hasCAD: boolean; imageUrl?: string } | null>(null);
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [isDraftLoaded, setIsDraftLoaded] = useState(false);
    const [propertyChecklistMode, setPropertyChecklistMode] = useState<'basic' | 'advanced'>('basic');
    const isAIEnabled = propertyChecklistMode === 'advanced';
    const initializedTemplateIdRef = useRef<string | null>(null);

    // Multi-benchmark photo labeling state
    const [stagingModal, setStagingModal] = useState<{
        isOpen: boolean;
        stepIndex: number;
        photos: { id: string; file: File; previewUrl: string; label: string }[];
    } | null>(null);
    const [isUploadingStaging, setIsUploadingStaging] = useState(false);
    const [editingBenchmarkLabel, setEditingBenchmarkLabel] = useState<{
        stepIndex: number;
        photoId: string;
        currentLabel: string;
    } | null>(null);
    const [isSavingLabel, setIsSavingLabel] = useState(false);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

    const supabase = React.useMemo(() => createClient(), []);

    useEffect(() => {
        if (!isOpen || !propertyId) return;

        const fetchSettings = async () => {
            try {
                const res = await fetch(`/api/properties/${propertyId}/checklist-settings`);
                const data = await res.json();
                if (res.ok && data.settings?.checklist_mode) {
                    setPropertyChecklistMode(data.settings.checklist_mode);
                }
            } catch (err) {
                console.error('Error fetching checklist settings for template:', err);
            }
        };

        fetchSettings();
    }, [isOpen, propertyId]);

    // Ensure session flags are cleaned up whenever the modal unmounts
    useEffect(() => {
        return () => {
            if (typeof window !== 'undefined' && propertyId) {
                try {
                    localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                    sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                    sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
                } catch {}
            }
        };
    }, [propertyId]);

    useEffect(() => {
        const fetchMembers = async () => {
            if (!propertyId) {
                console.warn('No propertyId provided for member fetch');
                setPropertyMembers([]);
                setIsLoadingMembers(false);
                setCurrentPropertyId(null);
                return;
            }

            setIsLoadingMembers(true);
            setCurrentPropertyId(propertyId);

            try {
                const response = await fetch(`/api/users/list?propertyId=${propertyId}`);
                const data = await response.json();

                if (!response.ok) {
                    console.error('API error:', data.error);
                    setToast({ message: data.error || 'Error loading property members', type: 'error' });
                    setPropertyMembers([]);
                    return;
                }

                console.log('Fetched members:', data.users?.length, 'members for propertyId:', propertyId);
                setPropertyMembers(data.users || []);
            } catch (err) {
                console.error('Error fetching property members:', err);
                setToast({ message: 'Error loading property members', type: 'error' });
                setPropertyMembers([]);
            } finally {
                setIsLoadingMembers(false);
            }
        };

        if (isOpen && propertyId) {
            fetchMembers();
        } else if (isOpen && !propertyId) {
            setPropertyMembers([]);
            setCurrentPropertyId(null);
        }
    }, [supabase, propertyId, isOpen]);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            initializedTemplateIdRef.current = null;
            return;
        }

        const currentId = template?.id || (initialData ? 'initial-ai' : 'new');
        if (initializedTemplateIdRef.current === currentId) {
            // Already initialized for this modal session, do not overwrite user edits during background re-renders
            return;
        }
        initializedTemplateIdRef.current = currentId;

        if (template) {
            setCreatedTemplateId(null);
            setFormData({
                title: template.title || '',
                description: template.description || '',
                category: template.category || 'general',
                frequency: template.frequency || 'daily',
                assigned_to: template.assigned_to || [],
                start_time: template.start_time ? template.start_time.slice(0, 5) : '',
                end_time: template.end_time ? template.end_time.slice(0, 5) : '',
            });

            // Sort items strictly by order_index and sanitize sub-parameters with guaranteed IDs
            const sortedItems = [...(template.items || [])].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
            const sanitizedItems = sortedItems.map((item: any, idx: number) => ({
                ...item,
                order_index: idx,
                parameters: Array.isArray(item.parameters)
                    ? item.parameters.map((p: any, pIdx: number) => ({
                        id: p.id || `param_${idx}_${pIdx}_${Date.now()}`,
                        name: typeof p === 'string' ? p : (p.name || p.title || `Checkpoint ${pIdx + 1}`),
                        type: p.type || 'yes_no',
                        is_required: p.is_required !== false,
                    }))
                    : [],
            }));

            setItems(sanitizedItems);
            setIsDraftLoaded(false);
        } else if (initialData) {
            setCreatedTemplateId(null);
            setFormData({
                title: initialData.title || '',
                description: initialData.description || '',
                category: initialData.category || 'general',
                frequency: initialData.frequency || 'daily',
                assigned_to: [],
                start_time: '09:00',
                end_time: '17:00',
            });
            setItems(
                (initialData.items || []).map((item: any, idx: number) => ({
                    id: item.id || `ai-${idx}`,
                    title: item.title,
                    description: item.description || '',
                    type: item.type || 'checkbox',
                    requires_photo: false,
                    requires_comment: false,
                    is_optional: false,
                    order_index: idx,
                    parameters: Array.isArray(item.parameters)
                        ? item.parameters.map((p: any, pIdx: number) => ({
                            id: p.id || `param_${idx}_${pIdx}_${Date.now()}`,
                            name: typeof p === 'string' ? p : (p.name || p.title || `Checkpoint ${pIdx + 1}`),
                            type: p.type || 'yes_no',
                            is_required: p.is_required !== false,
                        }))
                        : [],
                }))
            );
            setIsDraftLoaded(false);
        } else {
            // Check for saved draft in localStorage
            let restored = false;
            if (typeof window !== 'undefined' && propertyId) {
                try {
                    const rawDraft = localStorage.getItem(`sop_template_draft_${propertyId}`);
                    if (rawDraft) {
                        const parsed = JSON.parse(rawDraft);
                        const hasDraftData = !!(
                            parsed.formData?.title?.trim() ||
                            parsed.formData?.description?.trim() ||
                            (parsed.items && parsed.items.length > 0) ||
                            parsed.newItem?.title?.trim()
                        );
                        if (hasDraftData) {
                            setCreatedTemplateId(null);
                            setFormData({
                                title: parsed.formData?.title || '',
                                description: parsed.formData?.description || '',
                                category: parsed.formData?.category || 'general',
                                frequency: parsed.formData?.frequency || 'daily',
                                assigned_to: parsed.formData?.assigned_to || [],
                                start_time: parsed.formData?.start_time || '',
                                end_time: parsed.formData?.end_time || '',
                            });
                            setItems(Array.isArray(parsed.items) ? parsed.items : []);
                            if (parsed.newItem?.title || (parsed.newItem?.parameters && parsed.newItem.parameters.length > 0)) {
                                setNewItem({
                                    title: parsed.newItem.title || '',
                                    description: parsed.newItem.description || '',
                                    requires_photo: !!parsed.newItem.requires_photo,
                                    requires_comment: !!parsed.newItem.requires_comment,
                                    type: parsed.newItem.type || 'checkbox',
                                    is_optional: false,
                                    start_time: parsed.newItem.start_time || '',
                                    end_time: parsed.newItem.end_time || '',
                                    parameters: Array.isArray(parsed.newItem.parameters) ? parsed.newItem.parameters : [],
                                });
                            }
                            setIsDraftLoaded(true);
                            setLastSavedAt(parsed.savedAt || Date.now());
                            restored = true;
                        }
                    }
                } catch (err) {
                    console.error('Failed to load checklist draft:', err);
                }
            }

            if (!restored) {
                setCreatedTemplateId(null);
                setFormData({
                    title: '',
                    description: '',
                    category: 'general',
                    frequency: 'daily',
                    assigned_to: [],
                    start_time: '',
                    end_time: '',
                });

                setItems([]);
                setIsDraftLoaded(false);
                setLastSavedAt(null);
            }
        }
    }, [template, initialData, isOpen, propertyId]);

    // Autosave draft to localStorage on any change while creating a template (not editing existing)
    useEffect(() => {
        if (!isOpen || !!template || !propertyId || typeof window === 'undefined') return;
        if (typeof window === 'undefined') return;

        const hasContent = !!(
            formData.title?.trim() ||
            formData.description?.trim() ||
            (items && items.length > 0) ||
            newItem.title?.trim() ||
            (newItem.parameters && newItem.parameters.length > 0)
        );

        if (!hasContent) return;

        const timer = setTimeout(() => {
            try {
                const now = Date.now();
                const draft = {
                    formData,
                    items,
                    newItem,
                    savedAt: now,
                };
                localStorage.setItem(`sop_template_draft_${propertyId}`, JSON.stringify(draft));
                try {
                    localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                    sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                } catch {}
                setLastSavedAt(now);
                setIsDraftLoaded(true);
                window.dispatchEvent(new Event('sop_draft_updated'));
            } catch (e) {
                console.error('Failed to autosave checklist draft:', e);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [formData, items, newItem, isOpen, template, propertyId]);

    const handleDiscardDraft = () => {
        try {
            if (typeof window !== 'undefined' && propertyId) {
                localStorage.removeItem(`sop_template_draft_${propertyId}`);
                localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
                window.dispatchEvent(new Event('sop_draft_updated'));
            }
        } catch {}

        setFormData({
            title: '',
            description: '',
            category: 'general',
            frequency: 'daily',
            assigned_to: [],
            start_time: '',
            end_time: '',
        });
        setItems([]);
        setNewItem({
            title: '',
            description: '',
            requires_photo: false,
            requires_comment: false,
            type: 'checkbox',
            is_optional: false,
            start_time: '',
            end_time: '',
            parameters: [],
        });
        setIsDraftLoaded(false);
        setLastSavedAt(null);
        setToast({ message: 'Checklist draft cleared', type: 'success' });
    };

    const handleCloseModal = () => {
        try {
            if (typeof window !== 'undefined' && propertyId) {
                localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
            }
        } catch {}
        onClose();
    };

    const handleAddItem = () => {
        if (!newItem.title) {
            setToast({ message: 'Step title is required', type: 'error' });
            return;
        }

        // Auto-commit any parameter draft in progress
        let currentParams = Array.isArray(newItem.parameters) ? [...newItem.parameters] : [];
        if (paramDraftName.trim()) {
            currentParams.push({
                id: `param_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                name: paramDraftName.trim(),
                type: paramDraftType,
                is_required: true,
            });
            setParamDraftName('');
        }

        const itemToSave = {
            ...newItem,
            parameters: currentParams,
            is_optional: false,
        };

        if (editingIndex !== null) {
            const existingItem = items[editingIndex];
            const updatedItems = [...items];

            const mergedRefPhotos = (Array.isArray(itemToSave.reference_photos) && itemToSave.reference_photos.length > 0)
                ? itemToSave.reference_photos
                : (Array.isArray(existingItem?.reference_photos) && existingItem.reference_photos.length > 0)
                    ? existingItem.reference_photos
                    : (itemToSave.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: itemToSave.reference_photo_url }] : (existingItem?.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: existingItem.reference_photo_url }] : []));

            const mergedRefPhotoUrl = itemToSave.reference_photo_url || existingItem?.reference_photo_url || (mergedRefPhotos.length > 0 ? mergedRefPhotos[0].url : null);
            const mergedRefPhotoSource = itemToSave.reference_photo_source || existingItem?.reference_photo_source || (mergedRefPhotoUrl ? 'uploaded' : null);

            updatedItems[editingIndex] = {
                ...existingItem,
                ...itemToSave,
                id: existingItem?.id || itemToSave.id,
                reference_photos: mergedRefPhotos,
                reference_photo_url: mergedRefPhotoUrl,
                reference_photo_source: mergedRefPhotoSource,
                cad_area_id: existingItem?.cad_area_id || itemToSave.cad_area_id,
                order_index: editingIndex,
            };
            setItems(updatedItems);
            setEditingIndex(null);
        } else {
            setItems([...items, {
                ...itemToSave,
                order_index: items.length,
            }]);
        }

        setNewItem({
            title: '',
            description: '',
            requires_photo: false,
            requires_comment: false,
            type: 'checkbox',
            is_optional: false,
            start_time: '',
            end_time: '',
            parameters: [],
            reference_photos: [],
            reference_photo_url: null,
            reference_photo_source: null,
            cad_area_id: null,
        });
        setShowStepTimeSlot(false);
        setShowParametersSection(false);
        setParamDraftName('');
    };

    const handleAddParam = () => {
        if (!paramDraftName.trim()) {
            setToast({ message: 'Parameter name is required', type: 'error' });
            return;
        }
        const newParam: ChecklistStepParameter = {
            id: `param_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: paramDraftName.trim(),
            type: paramDraftType,
            is_required: true,
        };
        setNewItem(prev => ({
            ...prev,
            parameters: [...(prev.parameters || []), newParam],
        }));
        setParamDraftName('');
    };

    const handleRemoveParam = (paramId?: string, index?: number) => {
        setNewItem(prev => ({
            ...prev,
            parameters: (prev.parameters || []).filter((p, i) => {
                if (paramId && p.id) return p.id !== paramId;
                return i !== index;
            }),
        }));
    };

    const handleRemoveItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    // Fetch CAD status for existing template
    useEffect(() => {
        if (!isOpen || !template?.id || !propertyId) {
            setTemplateCADStatus(null);
            return;
        }
        const fetchCADStatus = async () => {
            try {
                const res = await fetch(`/api/properties/${propertyId}/sop/templates/${template.id}/cad/areas`);
                const data = await res.json();
                if (res.ok && data.cadConvertedImageUrl) {
                    setTemplateCADStatus({ hasCAD: true, imageUrl: data.cadConvertedImageUrl });
                } else {
                    setTemplateCADStatus({ hasCAD: false });
                }
            } catch (err) {
                console.error('Failed to fetch CAD status:', err);
                setTemplateCADStatus({ hasCAD: false });
            }
        };
        fetchCADStatus();
    }, [isOpen, template?.id, propertyId]);

    const COMMON_BENCHMARK_TAGS = [
        'Washbasin',
        'Commode / Toilet',
        'Floor & Drain',
        'Mirror & Counter',
        'Soap Dispenser',
        'Urinal',
        'Dustbin / Trash',
        'Overall View',
    ];

    const handleInitiatePhotoUpload = (index: number, incomingFiles: FileList | File[] | File) => {
        const item = items[index];
        if (!item?.id || item.id.startsWith('ai-')) {
            setToast({ message: 'Please save the template first before uploading reference photos', type: 'error' });
            return;
        }

        const fileList: File[] = incomingFiles instanceof FileList
            ? Array.from(incomingFiles)
            : Array.isArray(incomingFiles)
            ? incomingFiles
            : [incomingFiles];

        if (fileList.length === 0) return;

        const existingCount = Array.isArray(item.reference_photos) ? item.reference_photos.length : (item.reference_photo_url ? 1 : 0);

        const stagingPhotos = fileList.map((file, fIdx) => {
            const rawName = file.name ? file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' ') : '';
            const isGenericCameraName = !rawName || /^(img|image|photo|p_|\d)/i.test(rawName.trim());
            const initialLabel = isGenericCameraName
                ? (fIdx === 0 && existingCount === 0 ? 'Washbasin' : fIdx === 1 ? 'Commode / Toilet' : fIdx === 2 ? 'Floor & Drain' : `Clean Benchmark ${existingCount + fIdx + 1}`)
                : rawName.trim();

            return {
                id: `stg_${Date.now()}_${fIdx}`,
                file,
                previewUrl: URL.createObjectURL(file),
                label: initialLabel,
            };
        });

        setStagingModal({
            isOpen: true,
            stepIndex: index,
            photos: stagingPhotos,
        });
    };

    const handleConfirmStagingUpload = async () => {
        if (!stagingModal || stagingModal.photos.length === 0) return;
        const { stepIndex, photos } = stagingModal;
        const item = items[stepIndex];
        if (!item?.id) return;

        setIsUploadingStaging(true);
        setReferencePhotoUploads(prev => ({ ...prev, [stepIndex]: { uploading: true } }));

        try {
            let latestItem = item;
            for (let fIdx = 0; fIdx < photos.length; fIdx++) {
                const p = photos[fIdx];
                const formData = new FormData();
                formData.append('file', p.file);
                formData.append('label', p.label.trim() || `Clean Benchmark ${fIdx + 1}`);

                const res = await fetch(`/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Upload failed');

                latestItem = {
                    ...latestItem,
                    reference_photo_url: data.referencePhotoUrl,
                    reference_photos: data.referencePhotos || (data.referencePhotoUrl ? [{ id: 'ref_1', label: p.label.trim(), url: data.referencePhotoUrl }] : []),
                    reference_photo_source: 'uploaded',
                };
            }

            // Revoke blob URLs
            photos.forEach(p => {
                try { URL.revokeObjectURL(p.previewUrl); } catch {}
            });

            setItems(prev => prev.map((it, i) => i === stepIndex ? latestItem : it));
            if (editingIndex === stepIndex) {
                setNewItem(prev => ({
                    ...prev,
                    reference_photos: latestItem.reference_photos,
                    reference_photo_url: latestItem.reference_photo_url,
                    reference_photo_source: latestItem.reference_photo_source,
                }));
            }
            setReferencePhotoUploads(prev => ({ ...prev, [stepIndex]: { uploading: false, url: latestItem.reference_photo_url } }));
            setStagingModal(null);
            setToast({
                message: photos.length > 1
                    ? `${photos.length} clean benchmarks labeled and uploaded`
                    : `Clean benchmark "${photos[0].label}" added`,
                type: 'success'
            });
        } catch (err: any) {
            setReferencePhotoUploads(prev => ({ ...prev, [stepIndex]: { uploading: false } }));
            setToast({ message: err.message || 'Failed to upload reference photo', type: 'error' });
        } finally {
            setIsUploadingStaging(false);
        }
    };

    const handleSaveBenchmarkLabel = async (stepIndex: number, photoId: string, newLabel: string) => {
        const item = items[stepIndex];
        if (!item?.id || !newLabel.trim()) return;

        setIsSavingLabel(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photoId, label: newLabel.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update label');

            setItems(prev => prev.map((it, i) => i === stepIndex ? {
                ...it,
                reference_photos: data.referencePhotos || it.reference_photos,
            } : it));
            if (editingIndex === stepIndex) {
                setNewItem(prev => ({
                    ...prev,
                    reference_photos: data.referencePhotos || prev.reference_photos,
                }));
            }
            setEditingBenchmarkLabel(null);
            setToast({ message: `Benchmark renamed to "${newLabel.trim()}"`, type: 'success' });
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to rename benchmark', type: 'error' });
        } finally {
            setIsSavingLabel(false);
        }
    };

    const handleRemoveReferencePhoto = async (index: number, photoId?: string) => {
        const item = items[index];
        if (!item) return;

        // If item is unpersisted or draft, remove locally
        const isPersisted = item.id && !item.id.startsWith('ai-') && !item.id.startsWith('temp-') && !item.id.startsWith('draft-');

        if (!isPersisted) {
            const currentPhotos: any[] = Array.isArray(item.reference_photos) && item.reference_photos.length > 0
                ? item.reference_photos
                : (item.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: item.reference_photo_url }] : []);
            
            const remaining = photoId
                ? currentPhotos.filter((p: any) => p.id !== photoId && p.url !== photoId)
                : [];
            const nextUrl = remaining.length > 0 ? remaining[0].url : null;

            setItems(prev => prev.map((it, i) => i === index ? {
                ...it,
                reference_photo_url: nextUrl,
                reference_photos: remaining,
                reference_photo_source: nextUrl ? 'uploaded' : undefined,
            } : it));

            if (editingIndex === index) {
                setNewItem(prev => ({
                    ...prev,
                    reference_photos: remaining,
                    reference_photo_url: nextUrl,
                    reference_photo_source: nextUrl ? 'uploaded' : undefined,
                }));
            }
            setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: false } }));
            setToast({ message: 'Reference photo removed', type: 'success' });
            return;
        }

        try {
            const url = photoId
                ? `/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo?photoId=${encodeURIComponent(photoId)}`
                : `/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo`;
            const res = await fetch(url, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');

            setItems(prev => prev.map((it, i) => i === index ? {
                ...it,
                reference_photo_url: data.referencePhotoUrl || null,
                reference_photos: data.referencePhotos || [],
                reference_photo_source: data.referencePhotoUrl ? 'uploaded' : undefined,
            } : it));
            if (editingIndex === index) {
                setNewItem(prev => ({
                    ...prev,
                    reference_photos: data.referencePhotos || [],
                    reference_photo_url: data.referencePhotoUrl || null,
                    reference_photo_source: data.referencePhotoUrl ? 'uploaded' : undefined,
                }));
            }
            setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: false } }));
            setToast({ message: 'Reference photo removed', type: 'success' });
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to remove reference photo', type: 'error' });
        }
    };

    const handleOpenCAD = async () => {
        if (activeTemplateId) {
            setShowCADModal(true);
            return;
        }

        if (!formData.title.trim()) {
            setToast({ message: 'Please enter a Template Title first before uploading CAD', type: 'error' });
            return;
        }

        setIsLoading(true);
        try {
            // Auto-commit any step currently drafted
            let finalItems = [...items];
            let currentParams = Array.isArray(newItem.parameters) ? [...newItem.parameters] : [];
            if (paramDraftName.trim()) {
                currentParams.push({
                    id: `param_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    name: paramDraftName.trim(),
                    type: paramDraftType,
                    is_required: true,
                });
            }
            if (editingIndex !== null && editingIndex >= 0 && editingIndex < finalItems.length) {
                if (newItem.title.trim()) {
                    finalItems[editingIndex] = { ...newItem, parameters: currentParams, order_index: editingIndex };
                }
            } else if (newItem.title.trim()) {
                finalItems.push({ ...newItem, parameters: currentParams, order_index: finalItems.length });
            }

            const payload = {
                ...formData,
                items: finalItems.map((it, idx) => ({
                    title: it.title,
                    description: it.description || '',
                    type: it.type || 'checkbox',
                    requires_photo: it.requires_photo || false,
                    requires_comment: it.requires_comment || false,
                    is_optional: false,
                    order_index: idx,
                    start_time: it.start_time || null,
                    end_time: it.end_time || null,
                    parameters: Array.isArray(it.parameters) ? it.parameters : [],
                    reference_photo_url: it.reference_photo_url || null,
                    reference_photos: Array.isArray(it.reference_photos) ? it.reference_photos : [],
                    reference_photo_source: it.reference_photo_source || null,
                    cad_area_id: it.cad_area_id || null,
                })),
            };

            const response = await fetch(`/api/properties/${propertyId}/sop/templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to create template');

            const newId = data.template?.id || data.id;
            if (newId) {
                try {
                    if (typeof window !== 'undefined' && propertyId) {
                        localStorage.removeItem(`sop_template_draft_${propertyId}`);
                        localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
                        window.dispatchEvent(new Event('sop_draft_updated'));
                    }
                } catch {}
                setIsDraftLoaded(false);
                setCreatedTemplateId(newId);
                if (data.template?.items && data.template.items.length > 0) {
                    setItems(data.template.items);
                }
                setShowCADModal(true);
                setToast({ message: 'Template saved! Upload your CAD floor plan now.', type: 'success' });
            }
        } catch (err: any) {
            setToast({ message: err.message || 'Error creating template', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title) {
            setToast({ message: 'Title is required', type: 'error' });
            return;
        }

        setIsLoading(true);

        try {
            // Auto-commit any step currently in-progress in newItem before saving!
            let finalItems = [...items];
            let currentParams = Array.isArray(newItem.parameters) ? [...newItem.parameters] : [];
            if (paramDraftName.trim()) {
                currentParams.push({
                    id: `param_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    name: paramDraftName.trim(),
                    type: paramDraftType,
                    is_required: true,
                });
            }

            if (editingIndex !== null && editingIndex >= 0 && editingIndex < finalItems.length) {
                if (newItem.title.trim()) {
                    const existing = finalItems[editingIndex];
                    const mergedRefPhotos = (Array.isArray(newItem.reference_photos) && newItem.reference_photos.length > 0)
                        ? newItem.reference_photos
                        : (Array.isArray(existing?.reference_photos) && existing.reference_photos.length > 0)
                            ? existing.reference_photos
                            : (newItem.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: newItem.reference_photo_url }] : (existing?.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: existing.reference_photo_url }] : []));

                    finalItems[editingIndex] = {
                        ...existing,
                        ...newItem,
                        id: existing?.id || newItem.id,
                        reference_photos: mergedRefPhotos,
                        reference_photo_url: newItem.reference_photo_url || existing?.reference_photo_url || (mergedRefPhotos[0]?.url ?? null),
                        reference_photo_source: newItem.reference_photo_source || existing?.reference_photo_source || (mergedRefPhotos.length > 0 ? 'uploaded' : null),
                        parameters: currentParams,
                        order_index: editingIndex,
                    };
                }
            } else if (newItem.title.trim()) {
                finalItems.push({
                    ...newItem,
                    parameters: currentParams,
                    order_index: finalItems.length,
                });
            }

            const payload = {
                ...formData,
                items: finalItems.map((it, idx) => ({
                    id: it.id && !it.id.startsWith('ai-') ? it.id : undefined,
                    title: it.title,
                    description: it.description || '',
                    type: it.type || 'checkbox',
                    requires_photo: it.requires_photo || false,
                    requires_comment: it.requires_comment || false,
                    is_optional: false,
                    order_index: idx,
                    start_time: it.start_time || null,
                    end_time: it.end_time || null,
                    parameters: Array.isArray(it.parameters) ? it.parameters : [],
                    reference_photo_url: it.reference_photo_url || null,
                    reference_photos: Array.isArray(it.reference_photos) ? it.reference_photos : [],
                    reference_photo_source: it.reference_photo_source || null,
                    cad_area_id: it.cad_area_id || null,
                })),
            };

            const targetTemplateId = template?.id || createdTemplateId;

            if (targetTemplateId) {
                // Update existing template
                const response = await fetch(`/api/properties/${propertyId}/sop/templates/${targetTemplateId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to update template');

                try {
                    if (typeof window !== 'undefined' && propertyId) {
                        localStorage.removeItem(`sop_template_draft_${propertyId}`);
                        localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
                        window.dispatchEvent(new Event('sop_draft_updated'));
                    }
                } catch {}
                setIsDraftLoaded(false);
            } else {
                // Create template
                const response = await fetch(`/api/properties/${propertyId}/sop/templates`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to create template');

                try {
                    if (typeof window !== 'undefined' && propertyId) {
                        localStorage.removeItem(`sop_template_draft_${propertyId}`);
                        localStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_template_modal_open_${propertyId}`);
                        sessionStorage.removeItem(`sop_editing_template_id_${propertyId}`);
                        window.dispatchEvent(new Event('sop_draft_updated'));
                    }
                } catch {}
                setIsDraftLoaded(false);
            }

            onSuccess?.();
            handleCloseModal();
        } catch (err) {
            setToast({ message: err instanceof Error ? err.message : 'Error saving template', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const inputCls = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-primary/40 focus:bg-white transition-all font-medium text-slate-900 text-sm placeholder:text-slate-400";
    const labelCls = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 px-1";

    // ── 12-hour helpers ──────────────────────────────────────────────────────
    /** "HH:MM" → { h12, minute, ampm } */
    const to12 = (val: string) => {
        if (!val) return { h12: '12', minute: '00', ampm: 'AM' };
        const [h24, m] = val.split(':').map(Number);
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
        return { h12: String(h12), minute: String(m).padStart(2, '0'), ampm };
    };
    /** { h12, minute, ampm } → "HH:MM" */
    const to24 = (h12: string, minute: string, ampm: string) => {
        let h = parseInt(h12);
        if (ampm === 'AM' && h === 12) h = 0;
        if (ampm === 'PM' && h !== 12) h += 12;
        return `${String(h).padStart(2, '0')}:${minute}`;
    };
    /** "HH:MM" → "H:MM AM/PM" */
    const fmt12 = (val: string) => {
        const { h12, minute, ampm } = to12(val);
        return `${h12}:${minute} ${ampm}`;
    };

    const TimeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
        const { h12, minute, ampm } = to12(value);
        const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
        const minutes = ['00', '15', '30', '45'];
        const stepBtn = "w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-primary hover:text-white text-slate-500 transition-all text-[10px] font-black select-none";
        const valBox = "w-8 text-center font-black text-sm text-slate-900 leading-none";

        const cycleHour = (dir: 1 | -1) => {
            const idx = hours.indexOf(h12);
            const nextIdx = (idx + dir + 12) % 12;
            const next = hours[nextIdx];
            let newAmpm = ampm;
            if (dir === 1 && h12 === '11') {
                newAmpm = ampm === 'AM' ? 'PM' : 'AM';
            } else if (dir === -1 && h12 === '12') {
                newAmpm = ampm === 'AM' ? 'PM' : 'AM';
            }
            onChange(to24(next, minute, newAmpm));
        };
        const cycleMinute = (dir: 1 | -1) => {
            const idx = minutes.indexOf(minute);
            const next = minutes[(idx + dir + 4) % 4];
            onChange(to24(h12, next, ampm));
        };
        const toggleAmpm = () => onChange(to24(h12, minute, ampm === 'AM' ? 'PM' : 'AM'));

        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-2xl">
                {/* Hour stepper */}
                <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => cycleHour(1)} className={stepBtn}>▲</button>
                    <span className={valBox}>{h12.padStart(2, '0')}</span>
                    <button type="button" onClick={() => cycleHour(-1)} className={stepBtn}>▼</button>
                </div>
                <span className="font-black text-slate-300 text-lg leading-none mb-0.5">:</span>
                {/* Minute stepper */}
                <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => cycleMinute(1)} className={stepBtn}>▲</button>
                    <span className={valBox}>{minute}</span>
                    <button type="button" onClick={() => cycleMinute(-1)} className={stepBtn}>▼</button>
                </div>
                {/* AM/PM toggle */}
                <button type="button" onClick={toggleAmpm}
                    className="ml-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary font-black text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-all">
                    {ampm}
                </button>
            </div>
        );
    };

    // Compute scheduled run times preview
    const isHourly = /^every_\d+_hours?$/.test(formData.frequency);
    const scheduledTimes: string[] = React.useMemo(() => {
        if (!isHourly || !formData.start_time || !formData.end_time) return [];
        const m = formData.frequency.match(/^every_(\d+)_hours?$/);
        if (!m) return [];
        const intervalH = parseInt(m[1]);
        const [sH, sM] = formData.start_time.split(':').map(Number);
        const [eH, eM] = formData.end_time.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;
        if (endMins <= startMins) return [];
        const times: string[] = [];
        for (let t = startMins; t <= endMins; t += intervalH * 60) {
            const h = Math.floor(t / 60);
            const mn = t % 60;
            times.push(`${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`);
        }
        return times;
    }, [formData.frequency, formData.start_time, formData.end_time, isHourly]);

    if (!isOpen || !mounted) return null;

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleCloseModal}
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                    />

                    {/* Sheet */}
                    <motion.div
                        initial={{ opacity: 0, y: 60 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 60 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                        className="relative bg-white w-full sm:max-w-xl md:max-w-2xl sm:mx-4 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[94vh] sm:max-h-[90vh] overflow-hidden"
                    >
                        {/* Drag handle (mobile) */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-slate-200" />
                        </div>

                        {/* Header */}
                        <div className="flex justify-between items-start px-5 pt-3 pb-3 sm:pt-5 sm:px-6 flex-shrink-0">
                            <div>
                                <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
                                    {template ? 'Edit Checklist Template' : 'Create Checklist Template'}
                                </h2>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                        Define standard procedures
                                    </p>
                                    {!template && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Autosaved
                                            {lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={handleCloseModal}
                                className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-full transition-all flex-shrink-0 mt-0.5"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Scrollable body */}
                        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-5">

                            {/* Draft Restored Banner */}
                            {!template && isDraftLoaded && (
                                <div className="flex items-center justify-between px-3.5 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-amber-900">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                                        <p className="text-xs font-semibold truncate">
                                            Restored unsaved draft from your previous session
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDiscardDraft}
                                        className="text-[11px] font-black uppercase tracking-wider text-amber-700 hover:text-rose-600 transition-colors ml-2 flex-shrink-0"
                                    >
                                        Discard
                                    </button>
                                </div>
                            )}

                            {/* ── GENERAL INFORMATION ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-7 h-7 rounded-full border-2 border-slate-200 flex items-center justify-center">
                                        <Info size={13} className="text-slate-500" />
                                    </div>
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">General Information</span>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className={labelCls}>Template Title *</label>
                                        <input
                                            type="text"
                                            placeholder="e.g., Morning Shift Perimeter Check"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            className={inputCls}
                                            required
                                        />
                                    </div>

                                    {/* CAD Configuration (Only in AI-Enabled mode) */}
                                    {isAIEnabled && (
                                        <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                                                    <MapPin size={14} className="text-primary" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-slate-900">CAD Floor Plan</p>
                                                    <p className="text-[9px] text-slate-400 font-medium">
                                                        {templateCADStatus?.hasCAD ? 'Configured — click to edit areas' : 'Upload floor plan & map areas to steps'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleOpenCAD}
                                                disabled={isLoading}
                                                className="px-3 py-1.5 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary/90 transition-all flex items-center gap-1"
                                            >
                                                {isLoading ? <Loader2 size={10} className="animate-spin" /> : null}
                                                {templateCADStatus?.hasCAD ? 'Edit CAD' : 'Upload CAD'}
                                            </button>
                                        </div>
                                    )}

                                    <div>
                                        <label className={labelCls}>Description</label>
                                        <textarea
                                            placeholder="Briefly describe the purpose of this checklist..."
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={2}
                                            className={`${inputCls} resize-none`}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={labelCls}>Frequency</label>
                                            <select
                                                value={formData.frequency}
                                                onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                                                className={`${inputCls} appearance-none`}
                                            >
                                                <optgroup label="Hourly">
                                                    <option value="every_1_hour">Every 1 Hour</option>
                                                    <option value="every_2_hours">Every 2 Hours</option>
                                                    <option value="every_3_hours">Every 3 Hours</option>
                                                    <option value="every_4_hours">Every 4 Hours</option>
                                                    <option value="every_6_hours">Every 6 Hours</option>
                                                    <option value="every_8_hours">Every 8 Hours</option>
                                                    <option value="every_12_hours">Every 12 Hours</option>
                                                </optgroup>
                                                <optgroup label="Standard">
                                                    <option value="daily">Daily</option>
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                    <option value="on_demand">On Demand</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>Category</label>
                                            <input
                                                type="text"
                                                placeholder="general"
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className={inputCls}
                                            />
                                        </div>
                                    </div>

                                    {/* Time Window Card */}
                                    <div className="p-3.5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-0.5">
                                                Active Time Window <span className="normal-case text-[9px] text-slate-400 font-medium">(Optional)</span>
                                            </label>
                                            {formData.start_time || formData.end_time ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, start_time: '', end_time: '' })}
                                                    className="text-[9px] font-black text-rose-500 uppercase tracking-widest hover:underline flex items-center gap-1"
                                                >
                                                    <X size={10} /> Clear Window
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, start_time: '09:00', end_time: '17:00' })}
                                                    className="text-[9px] font-black text-primary uppercase tracking-widest hover:underline flex items-center gap-1"
                                                >
                                                    <Plus size={10} /> Set Window
                                                </button>
                                            )}
                                        </div>

                                        {(formData.start_time || formData.end_time) && (
                                            <>
                                                <div className="grid grid-cols-2 gap-2.5">
                                                    <div>
                                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">Start Time</p>
                                                        <TimeSelect
                                                            value={formData.start_time || '09:00'}
                                                            onChange={(v) => setFormData({ ...formData, start_time: v })}
                                                        />
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">End Time</p>
                                                        <TimeSelect
                                                            value={formData.end_time || '17:00'}
                                                            onChange={(v) => setFormData({ ...formData, end_time: v })}
                                                        />
                                                    </div>
                                                </div>

                                                {scheduledTimes.length > 0 && (
                                                    <div className="px-3 py-2 bg-primary/5 border border-primary/10 rounded-xl">
                                                        <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-1.5">Scheduled runs</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {scheduledTimes.map(t => (
                                                                <span key={t} className="px-2 py-0.5 bg-primary text-white rounded-full text-[9px] font-black">{fmt12(t)}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className={labelCls}>Assign To <span className="normal-case text-[9px] text-slate-400 font-medium">(optional)</span></label>
                                            {isLoadingMembers && (
                                                <span className="text-[9px] text-primary font-medium animate-pulse">Loading members...</span>
                                            )}
                                            {!propertyId && (
                                                <span className="text-[9px] text-amber-500 font-medium">Property required</span>
                                            )}
                                            {propertyId && !isLoadingMembers && propertyMembers.length === 0 && (
                                                <span className="text-[9px] text-slate-400 font-medium">No members found</span>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <div
                                                onClick={() => !propertyId ? setToast({ message: 'Please select a property first', type: 'error' }) : setIsUserDropdownOpen(!isUserDropdownOpen)}
                                                className={`flex flex-wrap gap-1.5 px-4 py-2.5 bg-slate-50 border rounded-2xl min-h-[48px] cursor-pointer transition-all ${!propertyId ? 'border-amber-200' : 'border-slate-200 hover:border-primary/40'}`}
                                            >
                                                {formData.assigned_to.length > 0 ? (
                                                    formData.assigned_to.map(userId => {
                                                        const member = propertyMembers.find(m => m.id === userId);
                                                        return (
                                                            <div key={userId} className="flex items-center gap-1 px-2 py-1 bg-primary text-white rounded-lg text-[10px] font-black uppercase tracking-wider">
                                                                <span>{member?.full_name || 'User'}</span>
                                                                <button type="button" onClick={(e) => { e.stopPropagation(); setFormData({ ...formData, assigned_to: formData.assigned_to.filter(id => id !== userId) }); }} className="w-3.5 h-3.5 flex items-center justify-center bg-white/20 rounded-full">
                                                                    <X size={9} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <span className="text-slate-400 text-sm font-medium self-center">Select people to assign...</span>
                                                )}
                                                <div className="ml-auto self-center text-slate-400">
                                                    <motion.div animate={{ rotate: isUserDropdownOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                    </motion.div>
                                                </div>
                                            </div>
                                            <AnimatePresence>
                                                {isUserDropdownOpen && (
                                                    <>
                                                        <div className="fixed inset-0 z-10" onClick={() => setIsUserDropdownOpen(false)} />
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 8 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: 8 }}
                                                            className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl max-h-44 overflow-y-auto p-1 shadow-xl z-20"
                                                        >
                                                            {isLoadingMembers ? (
                                                                <div className="py-4 text-center">
                                                                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading members...</div>
                                                                </div>
                                                            ) : propertyMembers.filter(m => !formData.assigned_to.includes(m.id)).length > 0 ? (
                                                                propertyMembers.filter(m => !formData.assigned_to.includes(m.id)).map((member: any) => (
                                                                    <button key={member.id} type="button" onClick={() => setFormData({ ...formData, assigned_to: [...formData.assigned_to, member.id] })}
                                                                        className="flex items-center gap-3 w-full p-2.5 hover:bg-slate-50 rounded-xl text-left transition-all">
                                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-black text-primary">{member.full_name?.[0]}</div>
                                                                        <div>
                                                                            <div className="text-[11px] font-black text-slate-800 uppercase tracking-wide">{member.full_name}</div>
                                                                            <div className="text-[9px] text-slate-400 font-medium uppercase">{member.propertyRole || 'Member'}</div>
                                                                        </div>
                                                                    </button>
                                                                ))
                                                            ) : (
                                                                <div className="py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                                    {!propertyId ? 'Select a property first' : propertyMembers.length === 0 ? 'No members found in this property' : 'All members selected'}
                                                                </div>
                                                            )}
                                                        </motion.div>
                                                    </>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── STEPS & CHECKLIST ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-7 h-7 rounded-full border-2 border-amber-200 bg-amber-50 flex items-center justify-center">
                                        <Plus size={13} className="text-amber-500" />
                                    </div>
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Steps & Checklist</span>
                                </div>

                                {/* Existing items */}
                                {items.length > 0 && (
                                    <div className="space-y-2.5 mb-3">
                                        {items.map((item, idx) => (
                                            <motion.div
                                                key={idx}
                                                layout
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-3.5 shadow-2xs hover:border-slate-300 transition-all space-y-2.5"
                                            >
                                                {/* Top Row: Index + Thumbnail + Title + Badges + Actions Toolbar */}
                                                <div className="flex items-start justify-between gap-2.5">
                                                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                                        <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-600 flex-shrink-0 mt-0.5">
                                                            {idx + 1}
                                                        </div>

                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <p className="font-black text-sm text-slate-900 leading-tight break-words">{item.title}</p>
                                                                {(() => {
                                                                    const refCount = Array.isArray(item.reference_photos) && item.reference_photos.length > 0
                                                                        ? item.reference_photos.length
                                                                        : (item.reference_photo_url ? 1 : 0);
                                                                    if (refCount === 0) return null;
                                                                    return (
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200/70 rounded-md text-[8px] font-black uppercase tracking-wider">
                                                                            <ImageIcon size={9} />
                                                                            {refCount > 1 ? `${refCount} Clean Benchmarks` : 'Clean Photo'}
                                                                        </span>
                                                                    );
                                                                })()}
                                                                {item.cad_area_id && (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/70 rounded-md text-[8px] font-black uppercase tracking-wider">
                                                                        <MapPin size={9} />
                                                                        CAD Area
                                                                    </span>
                                                                )}
                                                                {Array.isArray(item.parameters) && item.parameters.length > 0 && (
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200/70 rounded-md text-[8px] font-black uppercase tracking-wider">
                                                                        {item.parameters.length} Parameter{item.parameters.length > 1 ? 's' : ''}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {item.description && (
                                                                <p className="text-[11px] text-slate-500 font-medium line-clamp-2 mt-0.5 leading-snug">
                                                                    {item.description}
                                                                </p>
                                                            )}

                                                            {(item.start_time || item.end_time) && (
                                                                <div className="flex items-center gap-1 mt-1">
                                                                    <Clock size={10} className="text-primary/70" />
                                                                    <span className="text-[9px] font-black text-primary/80 uppercase tracking-wider">
                                                                        {item.start_time ? fmt12(item.start_time) : '—'} – {item.end_time ? fmt12(item.end_time) : '—'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Compact Actions Toolbar: Camera + Edit + Delete */}
                                                    <div className="flex items-center gap-1 flex-shrink-0 bg-slate-50 p-1 rounded-xl border border-slate-100">
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            multiple
                                                            className="hidden"
                                                            id={`ref-photo-${idx}`}
                                                            onChange={(e) => {
                                                                const files = e.target.files;
                                                                if (files && files.length > 0) handleInitiatePhotoUpload(idx, files);
                                                                e.target.value = '';
                                                            }}
                                                        />
                                                        <label
                                                            htmlFor={`ref-photo-${idx}`}
                                                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
                                                                referencePhotoUploads[idx]?.uploading
                                                                    ? 'text-primary bg-primary/10'
                                                                    : item.reference_photo_url
                                                                    ? 'text-emerald-700 hover:bg-emerald-100/70 bg-emerald-50'
                                                                    : 'text-slate-500 hover:text-primary hover:bg-white'
                                                            }`}
                                                            title={item.reference_photo_url ? 'Add / manage clean benchmark photos' : 'Upload clean reference photo(s)'}
                                                        >
                                                            {referencePhotoUploads[idx]?.uploading ? (
                                                                <Loader2 size={13} className="animate-spin" />
                                                            ) : (
                                                                <Camera size={13} />
                                                            )}
                                                        </label>

                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const safeParams = Array.isArray(item.parameters)
                                                                    ? item.parameters.map((p: any, pIdx: number) => ({
                                                                        id: p.id || `param_${idx}_${pIdx}_${Date.now()}`,
                                                                        name: typeof p === 'string' ? p : (p.name || p.title || `Param ${pIdx + 1}`),
                                                                        type: p.type || 'yes_no',
                                                                        is_required: p.is_required !== false,
                                                                    }))
                                                                    : [];
                                                                setNewItem({
                                                                    ...item,
                                                                    parameters: safeParams,
                                                                });
                                                                setEditingIndex(idx);
                                                                setShowStepTimeSlot(!!(item.start_time || item.end_time));
                                                                setShowParametersSection(safeParams.length > 0);
                                                            }}
                                                            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-primary hover:bg-white rounded-lg transition-all"
                                                            title="Edit Step"
                                                        >
                                                            <Edit3 size={13} />
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveItem(idx)}
                                                            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                                            title="Delete Step"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Dedicated Clean Standard Benchmark Photos Gallery Strip */}
                                                {(() => {
                                                    const refPhotos: any[] = Array.isArray(item.reference_photos) && item.reference_photos.length > 0
                                                        ? item.reference_photos
                                                        : (item.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Photo', url: item.reference_photo_url }] : []);

                                                    if (refPhotos.length === 0) return null;

                                                    return (
                                                        <div className="pt-2 border-t border-slate-100 bg-slate-50/70 rounded-xl p-2.5 space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Camera size={12} className="text-emerald-600" />
                                                                    <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider">
                                                                        {refPhotos.length > 1 ? `${refPhotos.length} Clean Benchmark Photos Added` : 'Clean Standard Photo Added'}
                                                                    </span>
                                                                    <span className="text-[9px] text-slate-400 font-medium">
                                                                        • Click photo to view
                                                                    </span>
                                                                </div>
                                                                {item.id && !item.id.startsWith('ai-') && (
                                                                    <label
                                                                        htmlFor={`ref-photo-${idx}`}
                                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider cursor-pointer shadow-2xs transition-colors"
                                                                        title="Add another clean benchmark photo"
                                                                    >
                                                                        {referencePhotoUploads[idx]?.uploading ? (
                                                                            <Loader2 size={10} className="animate-spin" />
                                                                        ) : (
                                                                            <Plus size={10} />
                                                                        )}
                                                                        <span>Add Photo</span>
                                                                    </label>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                                                                {refPhotos.map((ref, rIdx) => (
                                                                    <div key={ref.id || rIdx} className="relative group flex-shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                setPreviewImageUrl(ref.url);
                                                                            }}
                                                                            className="block relative rounded-xl overflow-hidden border-2 border-emerald-300 hover:border-emerald-500 shadow-2xs group-hover:scale-102 transition-all cursor-zoom-in text-left"
                                                                            title={`Click to view benchmark: ${ref.label || `Photo ${rIdx + 1}`}`}
                                                                        >
                                                                            <img
                                                                                src={ref.url}
                                                                                alt={ref.label || "Clean Ref"}
                                                                                className="w-18 h-18 sm:w-20 sm:h-20 object-cover"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                <Eye size={16} className="text-white drop-shadow" />
                                                                            </div>
                                                                            <div className="absolute bottom-0 inset-x-0 bg-black/80 backdrop-blur-xs px-1.5 py-0.5 text-center">
                                                                                <p className="text-[8px] font-black text-white truncate max-w-[72px]">
                                                                                    {ref.label || (refPhotos.length > 1 ? `Benchmark #${rIdx + 1}` : 'Clean Photo')}
                                                                                </p>
                                                                            </div>
                                                                        </button>
                                                                        <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    setEditingBenchmarkLabel({
                                                                                        stepIndex: idx,
                                                                                        photoId: ref.id,
                                                                                        currentLabel: ref.label || '',
                                                                                    });
                                                                                }}
                                                                                className="w-5 h-5 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110"
                                                                                title="Rename / label benchmark"
                                                                            >
                                                                                <Edit3 size={10} />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    handleRemoveReferencePhoto(idx, ref.id);
                                                                                }}
                                                                                className="w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110"
                                                                                title={`Cancel / delete ${ref.label || 'benchmark photo'}`}
                                                                            >
                                                                                <X size={11} strokeWidth={2.5} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Parameter Chips Preview (Full Width across bottom of step card) */}
                                                {Array.isArray(item.parameters) && item.parameters.length > 0 && (
                                                    <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 items-center">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-0.5">Parameters:</span>
                                                        {item.parameters.map((p: any, pIdx: number) => (
                                                            <span
                                                                key={p.id || pIdx}
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 border border-slate-200/80 rounded-md text-[9px] font-bold text-slate-700"
                                                            >
                                                                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                                                <span>{p.name}</span>
                                                                <span className="text-[8px] text-slate-400 uppercase font-bold">
                                                                    ({p.type === 'yes_no' ? 'Y/N' : p.type})
                                                                </span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </motion.div>
                                        ))}
                                    </div>
                                )}

                                {/* Add step form */}
                                <div className={`rounded-2xl p-4 space-y-3 transition-all ${
                                    editingIndex !== null 
                                        ? 'bg-amber-50/50 border-2 border-amber-300 shadow-xs' 
                                        : 'bg-slate-50 border border-dashed border-slate-300'
                                }`}>
                                    {editingIndex !== null && (
                                        <div className="flex items-center justify-between pb-2 border-b border-amber-200/80">
                                            <div className="flex items-center gap-1.5 text-amber-900 font-black text-xs uppercase tracking-wider">
                                                <Edit3 size={13} className="text-amber-600" />
                                                <span>Editing Step #{editingIndex + 1}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingIndex(null);
                                                    setShowStepTimeSlot(false);
                                                    setShowParametersSection(false);
                                                    setParamDraftName('');
                                                    setNewItem({ title: '', description: '', requires_photo: false, requires_comment: false, type: 'checkbox', is_optional: false, start_time: '', end_time: '', parameters: [] });
                                                }}
                                                className="text-[10px] font-bold text-amber-700 hover:text-rose-600 uppercase tracking-wider transition-colors"
                                            >
                                                Cancel Edit
                                            </button>
                                        </div>
                                    )}
                                    <input
                                        type="text"
                                        placeholder="Step Title"
                                        value={newItem.title}
                                        onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                                        className={inputCls}
                                    />
                                    <textarea
                                        placeholder="Step Description / Instructions..."
                                        value={newItem.description}
                                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                                        rows={2}
                                        className={`${inputCls} resize-none`}
                                    />
                                    {/* Clean Standard Reference Photos (shown when editing a step) */}
                                    {editingIndex !== null && (
                                        <div className="bg-emerald-50/50 border border-emerald-200/90 rounded-2xl p-3.5 space-y-3">
                                            {(!items[editingIndex]?.id || items[editingIndex]?.id?.startsWith('ai-')) ? (
                                                <div className="flex items-center gap-2 text-emerald-800 text-xs font-medium">
                                                    <Info size={14} className="text-emerald-600 flex-shrink-0" />
                                                    <span>Click <strong>Update Step</strong> and <strong>Save Changes</strong> first to enable clean benchmark photo uploads for this newly added step.</span>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                        <div>
                                                            <p className="text-[10px] font-black text-emerald-950 uppercase tracking-widest flex items-center gap-1.5">
                                                                <Camera size={13} className="text-emerald-600" />
                                                                Clean Standard Benchmark Photos
                                                            </p>
                                                            <p className="text-[9px] text-emerald-700 font-medium mt-0.5">
                                                                Upload & label benchmarks (e.g. Washbasin, Commode, Floor). You can select multiple photos at once.
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                multiple
                                                                className="hidden"
                                                                id={`ref-photo-edit-${editingIndex}`}
                                                                onChange={(e) => {
                                                                    const files = e.target.files;
                                                                    if (files && files.length > 0) handleInitiatePhotoUpload(editingIndex, files);
                                                                    e.target.value = '';
                                                                }}
                                                            />
                                                            <label
                                                                htmlFor={`ref-photo-edit-${editingIndex}`}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer shadow-2xs transition-colors"
                                                            >
                                                                {referencePhotoUploads[editingIndex]?.uploading ? (
                                                                    <>
                                                                        <Loader2 size={12} className="animate-spin" />
                                                                        <span>Uploading...</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Plus size={12} />
                                                                        <span>Upload & Label Clean Photos</span>
                                                                    </>
                                                                )}
                                                            </label>
                                                        </div>
                                                    </div>

                                                    {/* Existing benchmark thumbnails */}
                                                    {(() => {
                                                        const currentItem = items[editingIndex];
                                                        const refPhotos: any[] = Array.isArray(currentItem?.reference_photos) && currentItem.reference_photos.length > 0
                                                            ? currentItem.reference_photos
                                                            : (currentItem?.reference_photo_url ? [{ id: 'ref_1', label: 'Clean Benchmark', url: currentItem.reference_photo_url }] : []);

                                                        if (refPhotos.length === 0) return null;

                                                        return (
                                                            <div className="flex items-center gap-2 pt-2 border-t border-emerald-200/60 overflow-x-auto pb-1 scrollbar-thin">
                                                                {refPhotos.map((ref: any, rIdx: number) => (
                                                                    <div key={ref.id || rIdx} className="relative group flex-shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                setPreviewImageUrl(ref.url);
                                                                            }}
                                                                            className="block relative rounded-xl overflow-hidden cursor-zoom-in text-left border border-emerald-300 shadow-2xs group-hover:scale-102 transition-transform"
                                                                            title={`Click to view benchmark: ${ref.label || `Photo ${rIdx + 1}`}`}
                                                                        >
                                                                            <img
                                                                                src={ref.url}
                                                                                alt={ref.label || "Clean"}
                                                                                className="w-16 h-16 rounded-xl object-cover"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                <Eye size={14} className="text-white drop-shadow" />
                                                                            </div>
                                                                            <span className="absolute bottom-1 left-1 right-1 px-1 py-0.5 bg-black/80 backdrop-blur-xs text-[7px] font-black text-white rounded text-center truncate pointer-events-none">
                                                                                {ref.label || (refPhotos.length > 1 ? `#${rIdx + 1}` : 'Clean')}
                                                                            </span>
                                                                        </button>
                                                                        <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    setEditingBenchmarkLabel({
                                                                                        stepIndex: editingIndex,
                                                                                        photoId: ref.id,
                                                                                        currentLabel: ref.label || '',
                                                                                    });
                                                                                }}
                                                                                className="w-5 h-5 rounded-full bg-slate-900/90 text-white flex items-center justify-center hover:bg-primary shadow-xs"
                                                                                title="Rename / label benchmark"
                                                                            >
                                                                                <Edit3 size={9} />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    handleRemoveReferencePhoto(editingIndex, ref.id);
                                                                                }}
                                                                                className="w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-md transition-transform hover:scale-110"
                                                                                title="Cancel / delete benchmark photo"
                                                                            >
                                                                                <X size={11} strokeWidth={2.5} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                </>
                                            )}
                                        </div>
                                    )}

                                    <div>
                                        <label className={labelCls}>Response Type</label>
                                        <select value={newItem.type} onChange={(e) => setNewItem({ ...newItem, type: e.target.value as any })} className={`${inputCls} appearance-none`}>
                                            <option value="checkbox">Checkbox</option>
                                            <option value="text">Text Input</option>
                                            <option value="number">Number Input</option>
                                            <option value="yes_no">Yes / No Toggle</option>
                                        </select>
                                    </div>

                                    {/* Checklist Parameters (Optional Sub-checks under this Step) */}
                                    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-[10px] font-black text-slate-800 uppercase tracking-widest">
                                                    Parameters / Checkpoints <span className="normal-case text-[9px] text-slate-400 font-medium">(Optional)</span>
                                                </p>
                                                <p className="text-[9px] text-slate-400 font-medium mt-0.5">
                                                    Sub-checks like Carpet, Lights, Dusting. No photo required for parameters.
                                                </p>
                                            </div>
                                            {(!newItem.parameters || newItem.parameters.length === 0) && !showParametersSection ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowParametersSection(true)}
                                                    className="text-[9px] font-black text-primary uppercase tracking-widest hover:underline px-1"
                                                >
                                                    + Add Parameters
                                                </button>
                                            ) : null}
                                        </div>

                                        {(showParametersSection || (newItem.parameters && newItem.parameters.length > 0)) && (
                                            <div className="space-y-2 pt-1 border-t border-slate-100">
                                                {/* List of drafted parameters */}
                                                {newItem.parameters && newItem.parameters.length > 0 && (
                                                    <div className="space-y-1.5 mb-2">
                                                        {newItem.parameters.map((param, pIdx) => (
                                                            <div key={param.id || pIdx} className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-600 text-[8px] font-black flex items-center justify-center">
                                                                        {pIdx + 1}
                                                                    </span>
                                                                    <span className="text-xs font-bold text-slate-800">{param.name}</span>
                                                                    <span className="px-1.5 py-0.5 bg-white text-[8px] font-black text-slate-500 uppercase rounded border border-slate-100">
                                                                        {param.type === 'yes_no' ? 'Yes / No' : param.type}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setParamDraftName(param.name);
                                                                            setParamDraftType(param.type || 'yes_no');
                                                                            handleRemoveParam(param.id, pIdx);
                                                                        }}
                                                                        className="text-slate-400 hover:text-primary p-1 rounded-lg transition-colors"
                                                                        title="Edit parameter"
                                                                    >
                                                                        <Edit3 size={12} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveParam(param.id, pIdx)}
                                                                        className="text-slate-400 hover:text-rose-500 p-1 rounded-lg transition-colors"
                                                                        title="Remove parameter"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Input row for adding a parameter */}
                                                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. Carpet, Lights, Dusting"
                                                        value={paramDraftName}
                                                        onChange={(e) => setParamDraftName(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                handleAddParam();
                                                            }
                                                        }}
                                                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:border-primary"
                                                    />
                                                    <div className="flex gap-2 items-center">
                                                        <select
                                                            value={paramDraftType}
                                                            onChange={(e) => setParamDraftType(e.target.value as any)}
                                                            className="flex-1 sm:w-28 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-black appearance-none focus:outline-none focus:border-primary"
                                                        >
                                                            <option value="yes_no">Yes / No</option>
                                                            <option value="checkbox">Checkbox</option>
                                                            <option value="text">Text</option>
                                                            <option value="number">Number</option>
                                                        </select>
                                                        <button
                                                            type="button"
                                                            onClick={handleAddParam}
                                                            className="px-3.5 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-slate-800 transition-all flex items-center justify-center gap-1 flex-shrink-0"
                                                        >
                                                            <Plus size={11} /> Add Checkpoint
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Step-level time slot */}
                                    {!showStepTimeSlot ? (
                                        <button type="button"
                                            onClick={() => { setShowStepTimeSlot(true); setNewItem({ ...newItem, start_time: '09:00', end_time: '17:00' }); }}
                                            className="text-[9px] font-black text-primary uppercase tracking-widest hover:underline px-1">
                                            + Set Step Time Slot
                                        </button>
                                    ) : (
                                        <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Step Time Slot</p>
                                                <button type="button"
                                                    onClick={() => { setShowStepTimeSlot(false); setNewItem({ ...newItem, start_time: '', end_time: '' }); }}
                                                    className="text-[9px] font-black text-slate-400 hover:text-rose-500 uppercase tracking-widest">
                                                    × Remove
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">From</p>
                                                    <TimeSelect value={newItem.start_time || '09:00'} onChange={(v) => setNewItem({ ...newItem, start_time: v })} />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">To</p>
                                                    <TimeSelect value={newItem.end_time || '17:00'} onChange={(v) => setNewItem({ ...newItem, end_time: v })} />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <button type="button" onClick={handleAddItem}
                                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:opacity-90 transition-all">
                                        {editingIndex !== null ? <><Check size={14} /> Update Step</> : <><Plus size={14} /> Add Step</>}
                                    </button>
                                    {editingIndex !== null && (
                                        <button type="button" onClick={() => { setEditingIndex(null); setShowStepTimeSlot(false); setShowParametersSection(false); setParamDraftName(''); setNewItem({ title: '', description: '', requires_photo: false, requires_comment: false, type: 'checkbox', is_optional: false, start_time: '', end_time: '', parameters: [] }); }}
                                            className="w-full text-[10px] font-black text-slate-400 py-1.5 hover:text-slate-600 uppercase tracking-widest transition-all">
                                            Cancel Editing
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* bottom spacing */}
                            <div className="h-2" />
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 bg-white flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={handleCloseModal}
                                    className="text-slate-500 font-black uppercase tracking-widest text-[10px] hover:text-slate-800 transition-all px-2 py-2">
                                    Cancel
                                </button>
                                {!template && isDraftLoaded && (
                                    <button type="button" onClick={handleDiscardDraft}
                                        className="text-rose-500 hover:text-rose-700 font-black uppercase tracking-widest text-[10px] transition-all px-2 py-2">
                                        Discard Draft
                                    </button>
                                )}
                            </div>
                            <button onClick={handleSubmit} disabled={isLoading}
                                className="flex-1 ml-4 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all shadow-lg disabled:opacity-50">
                                {isLoading ? 'Saving...' : template ? 'Save Changes' : 'Create Template'}
                            </button>
                        </div>
                    </motion.div>

                    {/* ── MULTI-BENCHMARK PHOTO LABELING MODAL ── */}
                    {stagingModal && stagingModal.isOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
                                {/* Header */}
                                <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/60 to-slate-50">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                                            <Tag size={18} />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                                                Label Benchmark Photos
                                            </h3>
                                            <p className="text-[11px] text-slate-500 font-medium">
                                                Step: <strong className="text-slate-800">{items[stagingModal.stepIndex]?.title || 'Checklist Step'}</strong>
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            stagingModal.photos.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch {} });
                                            setStagingModal(null);
                                        }}
                                        className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>

                                {/* Instruction Tip */}
                                <div className="px-5 py-2.5 bg-emerald-50/50 border-b border-emerald-100/70 text-[11px] text-emerald-800 flex items-center gap-2">
                                    <Info size={14} className="text-emerald-600 flex-shrink-0" />
                                    <span>Assign a specific name (e.g. Washbasin, Commode, Floor) to each clean benchmark so AI Vision can accurately classify cleaner submissions and detect missing areas.</span>
                                </div>

                                {/* Scrollable Photos List */}
                                <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
                                    {stagingModal.photos.map((photo, pIdx) => (
                                        <div key={photo.id || pIdx} className="bg-slate-50/80 border border-slate-200 rounded-2xl p-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border border-slate-200 bg-black flex-shrink-0">
                                                <img src={photo.previewUrl} alt={`Benchmark ${pIdx + 1}`} className="w-full h-full object-cover" />
                                                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 text-[8px] font-black text-white rounded">
                                                    #{pIdx + 1}
                                                </span>
                                            </div>

                                            <div className="flex-1 w-full space-y-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <label className="text-[10px] font-black text-slate-700 uppercase tracking-wider">
                                                        Benchmark Area Name
                                                    </label>
                                                    {stagingModal.photos.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                try { URL.revokeObjectURL(photo.previewUrl); } catch {}
                                                                setStagingModal(prev => prev ? {
                                                                    ...prev,
                                                                    photos: prev.photos.filter((_, i) => i !== pIdx),
                                                                } : null);
                                                            }}
                                                            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 uppercase"
                                                        >
                                                            Remove Photo
                                                        </button>
                                                    )}
                                                </div>

                                                <input
                                                    type="text"
                                                    value={photo.label}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setStagingModal(prev => prev ? {
                                                            ...prev,
                                                            photos: prev.photos.map((p, i) => i === pIdx ? { ...p, label: val } : p),
                                                        } : null);
                                                    }}
                                                    placeholder="e.g. Washbasin, Toilet Commode, Floor..."
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />

                                                {/* Suggestion Chips */}
                                                <div className="flex flex-wrap gap-1 items-center">
                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mr-1">Quick:</span>
                                                    {COMMON_BENCHMARK_TAGS.map(tag => (
                                                        <button
                                                            key={tag}
                                                            type="button"
                                                            onClick={() => {
                                                                setStagingModal(prev => prev ? {
                                                                    ...prev,
                                                                    photos: prev.photos.map((p, i) => i === pIdx ? { ...p, label: tag } : p),
                                                                } : null);
                                                            }}
                                                            className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border ${
                                                                photo.label.toLowerCase() === tag.toLowerCase()
                                                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                                                    : 'bg-white hover:bg-emerald-50 text-slate-600 border-slate-200 hover:border-emerald-300'
                                                            }`}
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Modal Footer */}
                                <div className="p-4 sm:p-5 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            stagingModal.photos.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch {} });
                                            setStagingModal(null);
                                        }}
                                        disabled={isUploadingStaging}
                                        className="px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleConfirmStagingUpload}
                                        disabled={isUploadingStaging || stagingModal.photos.length === 0}
                                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm flex items-center gap-2 disabled:opacity-50 transition-colors"
                                    >
                                        {isUploadingStaging ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                <span>Uploading & Saving...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Check size={14} />
                                                <span>Upload & Save {stagingModal.photos.length} Benchmark{stagingModal.photos.length > 1 ? 's' : ''}</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── RENAME BENCHMARK LABEL MODAL ── */}
                    {editingBenchmarkLabel && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                                            <Tag size={15} />
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">Rename Benchmark</h4>
                                            <p className="text-[10px] text-slate-500 font-medium">Update the area name for this photo</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setEditingBenchmarkLabel(null)}
                                        className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>

                                <div>
                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">
                                        Benchmark Area Label
                                    </label>
                                    <input
                                        type="text"
                                        value={editingBenchmarkLabel.currentLabel}
                                        onChange={(e) => setEditingBenchmarkLabel(prev => prev ? { ...prev, currentLabel: e.target.value } : null)}
                                        placeholder="e.g. Washbasin, Commode, Floor..."
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                        autoFocus
                                    />
                                </div>

                                <div className="flex flex-wrap gap-1 items-center">
                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mr-1">Quick:</span>
                                    {COMMON_BENCHMARK_TAGS.slice(0, 5).map(tag => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => setEditingBenchmarkLabel(prev => prev ? { ...prev, currentLabel: tag } : null)}
                                            className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border ${
                                                editingBenchmarkLabel.currentLabel.toLowerCase() === tag.toLowerCase()
                                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                                    : 'bg-slate-50 hover:bg-emerald-50 text-slate-600 border-slate-200'
                                            }`}
                                        >
                                            {tag}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => setEditingBenchmarkLabel(null)}
                                        disabled={isSavingLabel}
                                        className="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSaveBenchmarkLabel(editingBenchmarkLabel.stepIndex, editingBenchmarkLabel.photoId, editingBenchmarkLabel.currentLabel)}
                                        disabled={isSavingLabel || !editingBenchmarkLabel.currentLabel.trim()}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {isSavingLabel ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                        <span>Save Label</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {toast && (
                        <Toast message={toast.message} type={toast.type} visible={true} onClose={() => setToast(null)} duration={3000} />
                    )}

                    {activeTemplateId && (
                        <SOPCADConfigModal
                            isOpen={showCADModal}
                            onClose={() => setShowCADModal(false)}
                            propertyId={propertyId}
                            templateId={activeTemplateId}
                            templateTitle={formData.title || template?.title}
                            items={items.map((it: any) => ({ id: it.id, title: it.title, order_index: it.order_index, reference_photo_url: it.reference_photo_url }))}
                            onItemsUpdate={(updated) => {
                                setItems(prev => prev.map(p => {
                                    const match = updated.find(u => u.id === p.id);
                                    return match ? { ...p, reference_photo_url: match.reference_photo_url } : p;
                                }));
                            }}
                            onSuccess={() => {
                                setToast({ message: 'CAD areas updated', type: 'success' });
                                onSuccess?.();
                            }}
                        />
                    )}

                    {previewImageUrl && (
                        <ImagePreviewModal
                            isOpen={Boolean(previewImageUrl)}
                            imageUrl={previewImageUrl}
                            onClose={() => setPreviewImageUrl(null)}
                        />
                    )}
                </div>
            )}
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
};

export default SOPTemplateFormModal;
