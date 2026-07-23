'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, CheckCircle2, ChevronRight, Loader2, X, Paperclip, Circle, Eye, Video, Play, ArrowLeft, MoreVertical, Lock, Calendar, Clock, Repeat, Upload, AlertCircle, RefreshCw } from 'lucide-react';


import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import CameraCaptureModal from '@/frontend/components/shared/CameraCaptureModal';
import VideoCaptureModal from '@/frontend/components/shared/VideoCaptureModal';
import { compressImage } from '@/frontend/utils/image-compression';
import { compressVideo } from '@/frontend/utils/video-compression';
import { uploadWithProgress } from '@/frontend/utils/upload-with-progress';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { Toast } from '@/frontend/components/ui/Toast';
import { playTickleSound } from '@/frontend/utils/sounds';
import ImagePreviewModal from '@/frontend/components/shared/ImagePreviewModal';
import VideoPreviewModal from '@/frontend/components/shared/VideoPreviewModal';


interface SOPChecklistRunnerProps {
    templateId: string;
    completionId?: string;
    isSuperAdmin?: boolean;
    propertyId: string;
    completionDate?: string; // e.g. YYYY-MM-DD for historical completion
    onComplete?: () => void;
    onCancel?: () => void;
}

/** Format HH:MM (24h) → "H:MM AM/PM" */
function fmt12Step(hhmm: string): string {
    if (!hhmm) return '00:00 AM';
    const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const SOPChecklistRunner: React.FC<SOPChecklistRunnerProps> = ({ templateId, completionId, isSuperAdmin = false, propertyId, completionDate, onComplete, onCancel }) => {
    const [completion, setCompletion] = useState<any>(null);
    const [template, setTemplate] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [activeCameraItemId, setActiveCameraItemId] = useState<string | null>(null);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [activeVideoItemId, setActiveVideoItemId] = useState<string | null>(null);
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
    const [itemValues, setItemValues] = useState<Record<string, string | number | boolean>>({});
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const [currentUser, setCurrentUser] = useState<any>(null);

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [liveNow, setLiveNow] = useState(() => new Date());
    const supabase = React.useMemo(() => createClient(), []);
    const hasInitialized = React.useRef(false);

    // Upload tracking: local preview URL → { progress, error, retrying, compressing }
    const [uploadProgress, setUploadProgress] = useState<Record<string, { progress: number; error?: string; retrying?: boolean; compressing?: boolean }>>({});

    // Store pending files for retry functionality
    const pendingFiles = useRef<Record<string, { file: File; type: 'photo' | 'video'; itemId: string }>>({});

    // Tick every second so expiry is detected live
    useEffect(() => {
        const id = setInterval(() => setLiveNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    // Time-window logic: distinguishes between Early, Active, and Late states.
    // FORCED to Asia/Kolkata (IST) timezone.
    const windowStatus = useMemo(() => {
        if (!template?.end_time || !completion?.completion_date) return { isWindowClosed: false, isLate: false, isUpcoming: false };
        
        // Extract YYYY-MM-DD reliably
        const dateStr = typeof completion.completion_date === 'string' 
            ? completion.completion_date.slice(0, 10) 
            : new Date(completion.completion_date).toISOString().slice(0, 10);

        const startStr = (template.start_time ?? '00:00').slice(0, 5);
        const endStr = template.end_time.slice(0, 5);

        // Construct ISO strings with the IST offset (+05:30)
        const windowStart = new Date(`${dateStr}T${startStr}:00+05:30`);
        let windowEnd = new Date(`${dateStr}T${endStr}:00+05:30`);
        
        const [sH, sM] = startStr.split(':').map(Number);
        const [eH, eM] = endStr.split(':').map(Number);

        if (eH < sH || (eH === sH && eM < sM)) {
            // Overnight shift: ends on the next calendar day
            windowEnd.setDate(windowEnd.getDate() + 1);
        }
        
        const isUpcoming = liveNow < windowStart;
        const isLate = liveNow > windowEnd;
        const withinWindow = !isUpcoming && !isLate;

        return { isWindowClosed: !withinWindow, isLate, isUpcoming };
    }, [template, completion?.completion_date, liveNow]);

    // Destructure for easier use in JSX
    const { isWindowClosed, isLate, isUpcoming } = windowStatus;

    // Slot overdue check for hourly checklists
    const isSlotOverdue = useMemo(() => {
        if (!template || isWindowClosed || !completion?.completion_date) return false;
        const hourlyMatch = template.frequency?.match(/^every_(\d+)_hours?$/);
        if (hourlyMatch) {
            const intervalH = parseInt(hourlyMatch[1]);
            const slotTime = completion.slot_time || '00:00';
            const dateStr = completion.completion_date;
            
            // Construct slot start in IST
            const slotStartMs = new Date(`${dateStr}T${slotTime.slice(0, 5)}:00+05:30`).getTime();
            const slotEndMs = slotStartMs + intervalH * 3_600_000;
            return liveNow.getTime() > slotEndMs;
        }
        return false;
    }, [template, completion, liveNow, isWindowClosed]);

    // Combined expiration check
    const isExpired = isLate || isSlotOverdue;

    // Read-only logic removed per user request: "checklist should be any time editable by anyone at any time"
    const isReadOnly = false;

    // Realtime: sync item checks + completion status changes made by other users
    useEffect(() => {
        if (!completion?.id) return;

        const channel = supabase
            .channel(`sop_session:${completion.id}`)
            // Item-level changes (checkbox, value, photo)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'sop_completion_items',
                    filter: `completion_id=eq.${completion.id}`,
                },
                (payload) => {
                    const updated = payload.new as any;
                    
                    // If checked_by is present but name unknown, fetch it
                    if (updated.checked_by && !userNames[updated.checked_by]) {
                        supabase.from('users').select('full_name').eq('id', updated.checked_by).single().then(({ data }) => {
                            if (data?.full_name) {
                                setUserNames(prev => ({ ...prev, [updated.checked_by]: data.full_name }));
                            }
                        });
                    }

                    setCompletion((prev: any) => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            items: prev.items.map((item: any) =>
                                item.id === updated.id ? { ...item, ...updated } : item
                            ),
                        };
                    });
                    setItemValues((prev) => ({
                        ...prev,
                        [updated.checklist_item_id]: updated.value !== null ? updated.value : (updated.is_checked ? true : false),
                    }));
                }
            )
            // Completion status change (e.g. another user submits → status = 'completed')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'sop_completions',
                    filter: `id=eq.${completion.id}`,
                },
                (payload) => {
                    const updated = payload.new as any;
                    setCompletion((prev: any) => prev ? { ...prev, ...updated } : prev);
                    if (updated.status === 'completed') {
                        onComplete?.();
                    }
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [completion?.id, supabase, onComplete]);

    useEffect(() => {
        const initializeChecklist = async () => {
            // We rely on the parent component's 'key' prop to unmount/remount
            // but we still want to avoid double-firing within a single mount.
            if (hasInitialized.current) return;
            hasInitialized.current = true;
            console.log('SOPChecklistRunner: Initializing...', { templateId, completionId, propertyId, completionDate });

            try {
                setIsLoading(true);

                // Refresh session to prevent timeout
                const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
                if (sessionError) {
                    console.warn('SOPChecklistRunner: Session refresh warning:', sessionError.message);
                }

                const { data: { user } } = await supabase.auth.getUser();
                setCurrentUser(user);
                console.log('SOPChecklistRunner: User fetched', user?.id);

                // Fetch template (skip property_id filter if not provided — checklist deep-link page)
                let templateQuery = supabase
                    .from('sop_templates')
                    .select(`*, items:sop_checklist_items(*)`)
                    .eq('id', templateId);
                if (propertyId) templateQuery = (templateQuery as any).eq('property_id', propertyId);

                const { data: templateData, error: templateError } = await templateQuery.single();

                if (templateError || !templateData) {
                    const msg = templateError?.message || 'Template not found';
                    throw new Error(msg);
                }

                // Sort items by section_title and order_index
                if (templateData.items) {
                    templateData.items.sort((a: any, b: any) => {
                        if (a.section_title !== b.section_title) {
                            if (!a.section_title) return -1;
                            if (!b.section_title) return 1;
                            return a.section_title.localeCompare(b.section_title);
                        }
                        return (a.order_index || 0) - (b.order_index || 0);
                    });
                }

                setTemplate(templateData); // Set template here
                console.log('SOPChecklistRunner: Template fetched', templateData?.id);

                // Use resolved propertyId — fall back to template row's property_id if prop not passed
                const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
                const resolvedPropertyId = validPropId || templateData.property_id;
                if (!resolvedPropertyId) throw new Error('Property ID could not be resolved for this template. Check RLS on sop_templates or properties table.');

                let completionData: any;

                if (completionId) {
                    // Fetch existing completion via API (supabaseAdmin, bypasses RLS)
                    const res = await fetch(`/api/properties/${resolvedPropertyId}/sop/completions/${completionId}`);
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || 'Failed to load completion');
                    completionData = json.completion;
                } else {
                    // Start new session via API (supabaseAdmin, bypasses RLS)
                    const res = await fetch(`/api/properties/${resolvedPropertyId}/sop/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            templateId, 
                            completionDate // Pass historical date if provided
                        }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || 'Failed to start checklist');
                    completionData = json.completion;
                }

                setCompletion(completionData);
                console.log('SOPChecklistRunner: Completion session fetched/started', completionData?.id);

                // Initialize item values and user names cache
                const initialValues: Record<string, any> = {};
                const initialNames: Record<string, string> = {};
                completionData.items?.forEach((i: any) => {
                    // Try to use value first, if text/number/yes_no, otherwise fallback to checked status
                    initialValues[i.checklist_item_id] = i.value !== null ? i.value : (i.is_checked ? true : false);
                    
                    if (i.checked_by && i.checked_by_user?.full_name) {
                        initialNames[i.checked_by] = i.checked_by_user.full_name;
                    }
                });
                setItemValues(initialValues);
                setUserNames(initialNames);
                setIsLoading(false);
                console.log('SOPChecklistRunner: Loading finished');
            } catch (err: any) {
                const msg = err?.message || err?.error_description || (typeof err === 'string' ? err : null) || JSON.stringify(err) || 'Unknown error';
                console.error('Initialization error:', msg, err);
                setToast({ message: `Error loading checklist: ${msg}`, type: 'error' });
                setIsLoading(false); 
                console.log('SOPChecklistRunner: Loading finished with error');
            }
        };

        const timeoutId = setTimeout(() => {
            if (isLoading) {
                console.warn('SOPChecklistRunner: Initialization timed out');
                setToast({ message: 'Loading is taking longer than expected. Please check your connection.', type: 'error' });
                setIsLoading(false);
            }
        }, 30000);

        initializeChecklist();

        // Periodic session refresh every 5 minutes to prevent timeout on long checklists
        const sessionRefreshInterval = setInterval(async () => {
            try {
                const { error: refreshError } = await supabase.auth.refreshSession();
                if (refreshError) {
                    console.warn('[SOPChecklistRunner] Periodic session refresh failed:', refreshError.message);
                } else {
                    console.log('[SOPChecklistRunner] Session refreshed successfully');
                }
            } catch (err) {
                console.warn('[SOPChecklistRunner] Periodic session refresh error:', err);
            }
        }, 5 * 60 * 1000); // 5 minutes

        return () => {
            clearTimeout(timeoutId);
            clearInterval(sessionRefreshInterval);
        };
    }, [templateId, completionId, propertyId, completionDate]);

    const handleItemToggle = async (itemId: string, value: any = null) => {
        if (isReadOnly) return;
        if (!itemId) {
            console.error('[SOP Debug] handleItemToggle called without itemId');
            return;
        }

        console.log(`[SOP Debug] handleItemToggle initiated for itemId: ${itemId}`);

        try {
            const findContext = (comp: any, temp: any) => {
                const tItem = temp?.items?.find((i: any) =>
                    String(i.id).toLowerCase() === String(itemId).toLowerCase()
                );
                const cItem = comp?.items?.find((i: any) =>
                    String(i.checklist_item_id).toLowerCase() === String(itemId).toLowerCase()
                );
                return { tItem, cItem };
            };

            const { tItem: templateItem, cItem: item } = findContext(completion, template);
            
            if (!templateItem) {
                console.error('[SOP Debug] Template item not found for ID:', itemId);
                return;
            }

            if (!item) {
                console.warn('[SOP Debug] Completion item not found in session for ID:', itemId);
                setToast({ message: 'Session out of sync. Please refresh the checklist.', type: 'error' });
                return;
            }

            const newValue = value !== null ? value : !item.is_checked;
            const isChecked = templateItem.type === 'checkbox' ? !!newValue : true;
            const dbValue = templateItem.type !== 'checkbox' ? String(newValue) : null;

            // ── OPTIMISTIC UPDATE ──
            const previousCompletion = { ...completion };

            const optimisticItems = completion.items.map((i: any) => {
                if (String(i.checklist_item_id).toLowerCase() === String(itemId).toLowerCase()) {
                    return { 
                        ...i, 
                        is_checked: isChecked, 
                        value: dbValue, 
                        checked_by: currentUser?.id,
                        checked_by_user: currentUser ? { full_name: currentUser.user_metadata?.full_name || 'You' } : i.checked_by_user
                    };
                }
                return i;
            });

            setCompletion({ ...completion, items: optimisticItems });
            setItemValues({ ...itemValues, [itemId]: newValue });

            // Refresh session before API call to prevent timeout
            await supabase.auth.refreshSession();

            const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
            const resolvedPropId = validPropId || completion?.property_id || template?.property_id;
            const res = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item: {
                        completionItemId: item.id,
                        is_checked: isChecked,
                        value: dbValue,
                    }
                }),
            });
            
            if (!res.ok) {
                const errorData = await res.json();

                // Handle session expiry specifically
                if (res.status === 401) {
                    // Try to refresh session and retry once
                    const { error: refreshErr } = await supabase.auth.refreshSession();
                    if (!refreshErr) {
                        // Retry the request once
                        const retryRes = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item: {
                                    completionItemId: item.id,
                                    is_checked: isChecked,
                                    value: dbValue,
                                }
                            }),
                        });

                        if (retryRes.ok) {
                            const data = await retryRes.json();
                            if (data.success && data.completion) {
                                setCompletion(data.completion);
                                return;
                            }
                        }
                    }
                    setToast({ message: 'Session expired. Please refresh the page.', type: 'error' });
                    return;
                }

                throw new Error(errorData.error || 'Failed to update checklist point');
            }

            const data = await res.json();
            if (data.success && data.completion) {
                // Final state sync with server data
                setCompletion(data.completion);
                // Update user names cache
                const newNames: Record<string, string> = { ...userNames };
                let namesChanged = false;
                data.completion.items.forEach((i: any) => {
                    if (i.checked_by && i.checked_by_user?.full_name && !newNames[i.checked_by]) {
                        newNames[i.checked_by] = i.checked_by_user.full_name;
                        namesChanged = true;
                    }
                });
                if (namesChanged) setUserNames(newNames);
            }
        } catch (err) {
            console.error('[SOP Debug] handleItemToggle Exception:', err);
            // ── ROLLBACK ──
            if (completion) setCompletion(completion); 
            setToast({ message: 'Sync failed. Reverting changes...', type: 'error' });
        }
    };

    const stampTimestamp = (file: File): Promise<File> => new Promise((resolve) => {
        const originalLastModified = file.lastModified; // Capture before any async work
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 1024;
            let w = img.width, h = img.height;
            if (w > h && w > maxSize) { h = (h * maxSize) / w; w = maxSize; }
            else if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; }
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, w, h);
            // Use the file's own lastModified time (= actual capture time)
            const capturedAt = new Date(originalLastModified);
            const ts = capturedAt.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '');
            const fontSize = Math.max(14, Math.round(w * 0.028));
            ctx.font = `bold ${fontSize}px monospace`;
            const pad = Math.round(fontSize * 0.5);
            const tw = ctx.measureText(ts).width;
            const x = w - tw - pad * 2;
            const y = h - fontSize - pad * 2;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.roundRect(x, y, tw + pad * 2, fontSize + pad * 2, 4);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(ts, x + pad, y + fontSize + pad * 0.6);
            canvas.toBlob(blob => {
                // Preserve original lastModified so subsequent reads still get the correct capture time
                resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp', lastModified: originalLastModified }) : file);
            }, 'image/webp', 0.88);
        };
        img.src = URL.createObjectURL(file);
    });

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, itemId: string) => {
        const file = e.target.files?.[0];
        // Pass original file directly — handlePhotoCapture will stamp the timestamp
        if (file) handlePhotoCapture(file, itemId);
    };

    const handlePhotoCapture = async (file: File, itemId?: string) => {
        const targetItemId = itemId || activeCameraItemId;
        if (!completion || !targetItemId) return;

        const item = completion.items.find((i: any) => i.checklist_item_id === targetItemId);
        if (!item) return;

        const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
        const resolvedPropId = validPropId || completion?.property_id || template?.property_id;
        const uploadKey = `${item.id}-photo`;

        // Capture actual photo time BEFORE any async processing
        const photoTakenAt = new Date(file.lastModified).toISOString();

        // STEP 1: Show original photo IMMEDIATELY (before any processing)
        const originalPreviewUrl = URL.createObjectURL(file);
        setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, compressing: true } }));
        setCompletion((prev: any) => prev ? {
            ...prev,
            items: prev.items.map((i: any) =>
                i.checklist_item_id === targetItemId ? { ...i, photo_url: originalPreviewUrl, _isLocalPreview: true, _isCompressing: true, checked_at: photoTakenAt } : i
            ),
        } : prev);

        try {
            // STEP 2: Process (compress) in background - user sees original during this time
            const stamped = await stampTimestamp(file);
            const compressedFile = await compressImage(stamped);

            // Store file for retry functionality
            pendingFiles.current[uploadKey] = { file: compressedFile, type: 'photo', itemId: targetItemId };

            // STEP 3: Replace original preview with compressed preview, start upload
            const localPreviewUrl = URL.createObjectURL(compressedFile);
            URL.revokeObjectURL(originalPreviewUrl);

            setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, compressing: false } }));
            setCompletion((prev: any) => prev ? {
                ...prev,
                items: prev.items.map((i: any) =>
                    i.checklist_item_id === targetItemId ? { ...i, photo_url: localPreviewUrl, _isCompressing: false } : i
                ),
            } : prev);

            // Upload with progress tracking (retry on failure)
            const maxRetries = 2;
            let lastError: Error | null = null;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, retrying: true } }));
                    }

                    const data = await uploadWithProgress(
                        `/api/properties/${resolvedPropId}/sop/photos`,
                        compressedFile,
                        {
                            completionId: completion.id,
                            completionItemId: String(item.id),
                        },
                        (progress) => setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress, retrying: attempt > 0 } }))
                    );

                    // Success - save photo URL to database
                    const photoRes = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item: { completionItemId: item.id, photo_url: data.url } }),
                    });
                    if (!photoRes.ok) throw new Error('Failed to save photo URL');

                    // Replace local preview with real URL
                    URL.revokeObjectURL(localPreviewUrl);
                    delete pendingFiles.current[uploadKey];
                    setUploadProgress(prev => {
                        const newProgress = { ...prev };
                        delete newProgress[uploadKey];
                        return newProgress;
                    });

                    setCompletion((prev: any) => prev ? {
                        ...prev,
                        items: prev.items.map((i: any) =>
                            i.checklist_item_id === targetItemId ? { ...i, photo_url: data.url, _isLocalPreview: false, checked_at: photoTakenAt } : i
                        ),
                    } : prev);

                    setShowCameraModal(false);
                    setActiveCameraItemId(null);
                    setToast({ message: 'Photo uploaded successfully', type: 'success' });
                    return; // Exit on success

                } catch (err) {
                    lastError = err as Error;
                    if (attempt < maxRetries) {
                        // Wait before retry (exponential backoff: 1s, 2s)
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                    }
                }
            }

            // All retries failed
            throw lastError;

        } catch (err: any) {
            console.error('Error uploading photo:', err);
            // Clean up local URLs
            URL.revokeObjectURL(originalPreviewUrl);
            // Mark upload as failed
            setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, error: err.message || 'Upload failed' } }));
            // Revert to no photo (or keep last valid photo if there was one)
            setCompletion((prev: any) => prev ? {
                ...prev,
                items: prev.items.map((i: any) =>
                    i.checklist_item_id === targetItemId ? { ...i, photo_url: item.photo_url || null, _isLocalPreview: false, _isCompressing: false } : i
                ),
            } : prev);
            setToast({ message: err.message || 'Error uploading photo', type: 'error' });
        }
    };

    const handleVideoCapture = async (file: File) => {
        const targetItemId = activeVideoItemId;
        if (!completion || !targetItemId) return;

        const item = completion.items.find((i: any) => i.checklist_item_id === targetItemId);
        if (!item) return;

        const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
        const resolvedPropId = validPropId || completion?.property_id || template?.property_id;
        const uploadKey = `${item.id}-video`;

        // STEP 1: Show original video IMMEDIATELY (before any processing)
        const originalPreviewUrl = URL.createObjectURL(file);
        setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, compressing: true } }));
        setCompletion((prev: any) => prev ? {
            ...prev,
            items: prev.items.map((i: any) =>
                i.checklist_item_id === targetItemId ? { ...i, video_url: originalPreviewUrl, _isLocalPreview: true, _isCompressing: true } : i
            ),
        } : prev);

        try {
            // STEP 2: Process (compress) in background - user sees original during this time
            const compressedFile = await compressVideo(file);

            // Store file for retry functionality
            pendingFiles.current[uploadKey] = { file: compressedFile, type: 'video', itemId: targetItemId };

            // STEP 3: Replace original preview with compressed preview, start upload
            const localPreviewUrl = URL.createObjectURL(compressedFile);
            URL.revokeObjectURL(originalPreviewUrl);

            setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, compressing: false } }));
            setCompletion((prev: any) => prev ? {
                ...prev,
                items: prev.items.map((i: any) =>
                    i.checklist_item_id === targetItemId ? { ...i, video_url: localPreviewUrl, _isCompressing: false } : i
                ),
            } : prev);

            // Upload with progress tracking (retry on failure)
            const maxRetries = 2;
            let lastError: Error | null = null;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, retrying: true } }));
                    }

                    const data = await uploadWithProgress(
                        `/api/properties/${resolvedPropId}/sop/videos`,
                        compressedFile,
                        {
                            completionId: completion.id,
                            completionItemId: String(item.id),
                        },
                        (progress) => setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress, retrying: attempt > 0 } }))
                    );

                    // Success - save video URL to database
                    const videoRes = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item: { completionItemId: item.id, video_url: data.url } }),
                    });
                    if (!videoRes.ok) throw new Error('Failed to save video URL');

                    // Replace local preview with real URL
                    URL.revokeObjectURL(localPreviewUrl);
                    delete pendingFiles.current[uploadKey];
                    setUploadProgress(prev => {
                        const newProgress = { ...prev };
                        delete newProgress[uploadKey];
                        return newProgress;
                    });

                    setCompletion((prev: any) => prev ? {
                        ...prev,
                        items: prev.items.map((i: any) =>
                            i.checklist_item_id === targetItemId ? { ...i, video_url: data.url, _isLocalPreview: false } : i
                        ),
                    } : prev);

                    setShowVideoModal(false);
                    setActiveVideoItemId(null);
                    setToast({ message: 'Video uploaded successfully', type: 'success' });
                    return; // Exit on success

                } catch (err) {
                    lastError = err as Error;
                    if (attempt < maxRetries) {
                        // Wait before retry (exponential backoff: 1s, 2s)
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                    }
                }
            }

            // All retries failed
            throw lastError;

        } catch (err: any) {
            console.error('Error uploading video:', err);
            // Mark upload as failed
            setUploadProgress(prev => ({ ...prev, [uploadKey]: { progress: 0, error: err.message || 'Upload failed' } }));
            // Revert to previous video URL or null
            setCompletion((prev: any) => prev ? {
                ...prev,
                items: prev.items.map((i: any) =>
                    i.checklist_item_id === targetItemId ? { ...i, video_url: item.video_url || null, _isLocalPreview: false } : i
                ),
            } : prev);
            setToast({ message: err.message || 'Error uploading video', type: 'error' });
        }
    };

    const handleRemoveMedia = async (itemId: string, type: 'photo' | 'video') => {
        if (!completion || !itemId) return;
        try {
            setIsSaving(true);
            const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
            const resolvedPropId = validPropId || completion?.property_id || template?.property_id;
            const item = completion.items.find((i: any) => i.checklist_item_id === itemId);
            if (!item) return;

            const updatePayload = type === 'photo' ? { photo_url: null } : { video_url: null };

            const res = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item: { completionItemId: item.id, ...updatePayload } }),
            });

            if (!res.ok) throw new Error('Failed to remove media');

            setCompletion((prev: any) => ({
                ...prev,
                items: prev.items.map((i: any) =>
                    i.checklist_item_id === itemId ? { ...i, ...updatePayload } : i
                ),
            }));
            setToast({ message: `${type === 'photo' ? 'Photo' : 'Video'} removed`, type: 'success' });
        } catch (err: any) {
            setToast({ message: err.message || 'Error removing media', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmit = async () => {
        if (!completion) return;

        try {
            setIsSaving(true);

            // Check mandatory items and evidence requirements
            const missingEvidence: string[] = [];
            const missingMandatory: string[] = [];

            template.items.forEach((item: any) => {
                const comp = completion.items.find((c: any) => c.checklist_item_id === item.id);
                const hasInteraction = comp && (comp.is_checked || (comp.value !== null && comp.value !== ''));
                
                // 1. Mandatory check (STRICT)
                if (!item.is_optional && !hasInteraction) {
                    missingMandatory.push(`"${item.title}"`);
                }

                // 2. Evidence check (SOFT - per user request to loosen rule)
                if (hasInteraction) {
                    if (item.requires_photo && !comp.photo_url) {
                        missingEvidence.push(`Photo for "${item.title}"`);
                    }
                    if (item.requires_comment && (!comp.comment || comp.comment.trim() === '')) {
                        missingEvidence.push(`Comment for "${item.title}"`);
                    }
                }
            });

            if (missingMandatory.length > 0) {
                setToast({
                    message: `Mandatory items missing: ${missingMandatory[0]}`,
                    type: 'error',
                });
                setIsSaving(false);
                return;
            }

            // Evidence check logic removed per user request (staff can add if they want)

            // Update completion status via API (supabaseAdmin, bypasses RLS)
            const validPropId = (!propertyId || propertyId === 'undefined' || propertyId === 'null') ? null : propertyId;
            const resolvedPropId = validPropId || completion?.property_id || template?.property_id;
            const submitRes = await fetch(`/api/properties/${resolvedPropId}/sop/completions/${completion.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'completed'
                }),
            });
            if (!submitRes.ok) throw new Error('Failed to submit checklist');

            playTickleSound();
            setToast({ message: 'Checklist submitted successfully!', type: 'success' });
            setTimeout(() => onComplete?.(), 1500);
        } catch (err) {
            setToast({ message: 'Error submitting checklist', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 rounded-full w-full" />
                <div className="space-y-4 pt-6">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-3xl" />)}
                </div>
            </div>
        );
    }

    if (!template || !completion) {
        return <div className="text-center py-24 text-slate-500 font-black uppercase text-xs tracking-widest">Error loading checklist data</div>;
    }

    const fmt12Step = (t: string) => {
        const [h24, m] = t.slice(0, 5).split(':').map(Number);
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    const checkedCount = completion.items.filter((cItem: any) => {
        const hasInteraction = cItem.is_checked || cItem.value;
        return hasInteraction;
    }).length;

    const progress = completion.items.length > 0 ? (checkedCount / completion.items.length) * 100 : 0;


    return (
        <div className="flex flex-col min-h-screen bg-white">
            {/* ── TOP HEADER ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-20">
                <button onClick={onCancel} className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full transition-all">
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-base font-black text-slate-900 tracking-tight truncate max-w-[55%] text-center">{template.title}</h1>
                    <button className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-full transition-all">
                        <MoreVertical size={20} />
                    </button>
            </div>

            {/* ── SESSION META ── */}
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center flex-wrap gap-4">
                <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        {new Date(completion.completion_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                </div>
                {(template.start_time || template.end_time) && (
                    <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-slate-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                            {(() => {
                                const freq = template.frequency || '';
                                const hourlyMatch = freq.match(/^every_(\d+)_hours?$/i);
                                
                                // Robust slot time extraction with IST conversion
                                let slotTime = completion?.slot_time;
                                if (!slotTime && hourlyMatch && (completion?.due_at || completion?.created_at)) {
                                    const date = new Date(completion.due_at || completion.created_at);
                                    slotTime = date.toLocaleTimeString('en-GB', { 
                                        timeZone: 'Asia/Kolkata', 
                                        hour12: false, 
                                        hour: '2-digit', 
                                        minute: '2-digit',
                                        second: '2-digit'
                                    });
                                }
                                
                                if (hourlyMatch && slotTime) {
                                    const intervalH = parseInt(hourlyMatch[1]);
                                    const [h, m] = slotTime.split(':').map(Number);
                                    const endH = (h + intervalH) % 24;
                                    const slotEnd = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
                                    return `${fmt12Step(slotTime)} – ${fmt12Step(slotEnd)}`;
                                }
                                return `${template.start_time ? fmt12Step(template.start_time) : '00:00'} – ${template.end_time ? fmt12Step(template.end_time) : '23:59'}`;
                            })()}
                        </span>
                    </div>
                )}
                <div className="flex items-center gap-1.5">
                    <Repeat size={12} className="text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        {(() => {
                            const freq = template.frequency || '';
                            const hourlyMatch = freq.match(/^every_(\d+)_hours?$/i);
                            if (hourlyMatch) return `Every ${hourlyMatch[1]} hr${parseInt(hourlyMatch[1]) > 1 ? 's' : ''}`;
                            const map: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', on_demand: 'On Demand' };
                            return map[freq.toLowerCase()] ?? freq.replace(/_/g, ' ');
                        })()}
                    </span>
                </div>
            </div>

            {/* ── PROGRESS BAR ── */}
            <div className="px-6 pb-4 bg-white">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Completion</span>
                    <span className="text-[10px] font-black text-primary uppercase tracking-widest">{Math.round(progress)}% — {checkedCount}/{completion.items.length} PTS</span>
                </div>
                <div className="w-full bg-slate-50 rounded-full h-1.5 overflow-hidden">
                    <motion.div
                        className="bg-primary h-full rounded-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.4)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: "circOut" }}
                    />
                </div>
            </div>

            {/* ── BANNERS ── */}
            <div className="px-6 space-y-2">
                {isUpcoming && completion?.status !== 'completed' ? (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-50/50 border border-blue-100 backdrop-blur-sm">
                        <div className="p-2 bg-blue-100 rounded-xl">
                            <Clock size={14} className="text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Checklist Not Started</p>
                            <p className="text-[9px] font-medium text-blue-600/80">Please wait for the start time.</p>
                        </div>
                    </div>
                ) : isLate && completion?.status !== 'completed' ? (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-rose-50/50 border border-rose-100 backdrop-blur-sm">
                        <div className="p-2 bg-rose-100 rounded-xl">
                            <Clock size={14} className="text-rose-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Late Entry Mode</p>
                            <p className="text-[9px] font-medium text-rose-600/80">The time for this checklist has passed.</p>
                        </div>
                    </div>
                ) : completion?.status === 'completed' ? (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-sm ${completion.is_late ? 'bg-rose-50/50 border-rose-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                        <div className={`p-2 rounded-xl ${completion.is_late ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                            <CheckCircle2 size={14} className={completion.is_late ? 'text-rose-600' : 'text-emerald-600'} />
                        </div>
                        <div className="flex-1">
                            <p className={`text-[10px] font-black uppercase tracking-widest ${completion.is_late ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {completion.is_late ? 'Completed Late' : 'Checklist Completed'}
                            </p>
                            <p className={`text-[9px] font-medium ${completion.is_late ? 'text-rose-600/80' : 'text-emerald-600/80'}`}>
                                This record is saved.
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* ── CHECKLIST ITEMS ── */}
            <div className="flex-1 overflow-y-auto pb-24">
                {(() => {
                    let currentSection: string | null = null;
                    return template.items.map((item: any, index: number) => {
                        const showSectionHeader = item.section_title !== currentSection;
                        if (showSectionHeader) currentSection = item.section_title;

                        const completionItem = completion.items.find((c: any) => c.checklist_item_id === item.id);
                    const isChecked = completionItem?.is_checked;
                    const hasValue = completionItem?.value || isChecked;
                    const value = itemValues[item.id];

                    // Per-item time slot logic
                    const itemSlotLocked = (() => {
                        if (!item.end_time || isChecked || hasValue) return false;
                        const nowMins = liveNow.getHours() * 60 + liveNow.getMinutes();
                        const [sH, sM] = (item.start_time ?? '00:00').slice(0, 5).split(':').map(Number);
                        const [eH, eM] = item.end_time.slice(0, 5).split(':').map(Number);
                        
                        const startMins = sH * 60 + sM;
                        const endMins = eH * 60 + eM;
                        const isOvernight = endMins <= startMins;

                        const withinWindow = isOvernight
                            ? (nowMins >= startMins || nowMins < endMins)
                            : (nowMins >= startMins && nowMins <= endMins);

                        return !withinWindow;
                    })();
                    const itemSlotUpcoming = (() => {
                        // If it's currently closed but it's AFTER the end time on a normal day
                        if (!item.start_time || isChecked || hasValue) return false;
                        const nowMins = liveNow.getHours() * 60 + liveNow.getMinutes();
                        const [sH, sM] = item.start_time.slice(0, 5).split(':').map(Number);
                        const [eH, eM] = (item.end_time ?? '23:59').slice(0, 5).split(':').map(Number);
                        
                        const startMins = sH * 60 + sM;
                        const endMins = eH * 60 + eM;
                        const isOvernight = endMins <= startMins;

                        // Upcoming means we haven't reached start time yet
                        if (isOvernight) {
                            // In an overnight shift, "upcoming" only happens in the gap between endMins and startMins
                            return (nowMins >= endMins && nowMins < startMins);
                        }
                        return nowMins < startMins;
                    })();
                    const itemDisabled = isReadOnly; // Per-item slot locks removed per user request


                        return (
                            <React.Fragment key={item.id}>
                                {showSectionHeader && (
                                    <div className="px-4 py-2 bg-slate-50 border-y border-slate-100 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-primary rounded-full" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            {item.section_title || 'General'}
                                        </span>
                                    </div>
                                )}
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={`border-b border-slate-100 ${isReadOnly ? 'opacity-60' : ''}`}
                                >
                            {/* Item title row */}
                            <div className="flex items-start gap-3 px-4 pt-4 pb-1">
                                {item.type === 'checkbox' ? (
                                    <button onClick={() => handleItemToggle(item.id)} disabled={itemDisabled} className="flex-shrink-0 mt-0.5 disabled:opacity-60 disabled:cursor-not-allowed">
                                        <AnimatePresence mode="wait">
                                            {isChecked ? (
                                                <motion.div key="checked" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
                                                    <CheckCircle2 size={24} className="text-primary" />
                                                </motion.div>
                                            ) : (
                                                <motion.div key="unchecked" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
                                                    <Circle size={24} className="text-slate-300" />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </button>
                                ) : (
                                    <div className="w-6 h-6 rounded-full border-2 border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <span className="text-[9px] font-black text-slate-400">{index + 1}</span>
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <h3 className={`font-black text-base tracking-tight ${isChecked ? 'text-primary' : 'text-slate-900'}`}>{item.title}</h3>
                                    {/* Checked by indicator */}
                                    {isChecked && (
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                                <div className="w-1 h-1 rounded-full bg-slate-300" />
                                                By {completionItem?.checked_by_user?.full_name || userNames[completionItem?.checked_by] || 'Staff'}
                                            </span>
                                        </div>
                                    )}
                                    {/* Step time slot badge */}
                                    {(item.start_time || item.end_time) && (
                                        <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest
                                                ${itemSlotLocked ? 'bg-rose-100 text-rose-600' : itemSlotUpcoming ? 'bg-amber-100 text-amber-600' : 'bg-primary/10 text-primary'}`}>
                                                {item.start_time ? fmt12Step(item.start_time) : '—'} – {item.end_time ? fmt12Step(item.end_time) : '—'}
                                                {itemSlotLocked ? ' · Closed' : itemSlotUpcoming ? ' · Upcoming' : ''}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="pb-2" />

                            {/* Photo preview — full width with upload progress */}
                            {completionItem?.photo_url && (
                                <div className="mx-4 mb-3 rounded-2xl overflow-hidden relative group">
                                    {/* Upload progress overlay */}
                                    {(() => {
                                        const uploadState = uploadProgress[`${completionItem?.id}-photo`];
                                        const isUploading = uploadState && uploadState.progress < 100 && !uploadState.compressing;
                                        const isCompressing = uploadState?.compressing;
                                        const hasError = uploadState?.error;

                                        return (
                                            <>
                                                <div
                                                    className={`cursor-pointer ${hasError ? 'opacity-70' : ''}`}
                                                    onClick={() => !isUploading && !isCompressing && !hasError && setPreviewImageUrl(completionItem.photo_url!)}
                                                >
                                                    <img src={completionItem.photo_url} alt="Proof" className="w-full h-48 object-cover" />

                                                    {/* Compressing overlay */}
                                                    {isCompressing && (
                                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                                                            <Loader2 size={24} className="text-white animate-spin mb-2" />
                                                            <span className="text-xs font-bold text-white">Processing...</span>
                                                        </div>
                                                    )}

                                                    {/* Upload progress overlay */}
                                                    {isUploading && (
                                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                                                            <div className="w-3/4 bg-white/20 rounded-full h-2 overflow-hidden mb-2">
                                                                <motion.div
                                                                    className="bg-white h-full rounded-full"
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${uploadState.progress}%` }}
                                                                    transition={{ duration: 0.3 }}
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-2 text-white">
                                                                <Upload size={14} className="animate-pulse" />
                                                                <span className="text-xs font-bold">
                                                                    {uploadState.retrying ? 'Retrying...' : `Uploading ${uploadState.progress}%`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Upload error overlay */}
                                                    {hasError && (
                                                        <div className="absolute inset-0 bg-rose-900/70 flex flex-col items-center justify-center">
                                                            <AlertCircle size={28} className="text-white mb-2" />
                                                            <span className="text-xs font-bold text-white text-center px-4">{hasError}</span>
                                                            <span className="text-[10px] text-white/70 mt-1">Tap retry to try again</span>
                                                        </div>
                                                    )}

                                                    {/* Success/Preview overlay */}
                                                    {!isUploading && !isCompressing && !hasError && (
                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                                                            <Eye size={28} className="text-white" />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Delete / Retry button */}
                                                {!isUploading && !isCompressing && (
                                                    hasError ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // Retry: use stored file from pendingFiles
                                                                const stored = pendingFiles.current[`${completionItem?.id}-photo`];
                                                                if (stored) {
                                                                    handlePhotoCapture(stored.file, item.id);
                                                                }
                                                            }}
                                                            className="absolute top-3 right-3 w-8 h-8 bg-amber-500 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-amber-600 transition-all z-10"
                                                            title="Retry upload"
                                                        >
                                                            <RefreshCw size={16} />
                                                        </button>
                                                    ) : !completionItem?._isLocalPreview && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRemoveMedia(item.id, 'photo'); }}
                                                            className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-rose-500 transition-all z-10"
                                                            title="Delete photo"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    )
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Video preview — full width with upload progress */}
                            {completionItem?.video_url && (
                                <div className="mx-4 mb-3 rounded-2xl overflow-hidden relative group">
                                    {(() => {
                                        const uploadState = uploadProgress[`${completionItem?.id}-video`];
                                        const isUploading = uploadState && uploadState.progress < 100 && !uploadState.compressing;
                                        const isCompressing = uploadState?.compressing;
                                        const hasError = uploadState?.error;

                                        return (
                                            <>
                                                <div
                                                    className={`cursor-pointer ${hasError ? 'opacity-70' : ''}`}
                                                    onClick={() => !isUploading && !isCompressing && !hasError && setPreviewVideoUrl(completionItem.video_url!)}
                                                >
                                                    <video src={completionItem.video_url} className="w-full h-48 object-cover" muted playsInline />

                                                    {/* Compressing overlay */}
                                                    {isCompressing && (
                                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                                                            <Loader2 size={24} className="text-white animate-spin mb-2" />
                                                            <span className="text-xs font-bold text-white">Processing video...</span>
                                                        </div>
                                                    )}

                                                    {/* Upload progress overlay */}
                                                    {isUploading && (
                                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                                                            <div className="w-3/4 bg-white/20 rounded-full h-2 overflow-hidden mb-2">
                                                                <motion.div
                                                                    className="bg-white h-full rounded-full"
                                                                    initial={{ width: 0 }}
                                                                    animate={{ width: `${uploadState.progress}%` }}
                                                                    transition={{ duration: 0.3 }}
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-2 text-white">
                                                                <Upload size={14} className="animate-pulse" />
                                                                <span className="text-xs font-bold">
                                                                    {uploadState.retrying ? 'Retrying...' : `Uploading ${uploadState.progress}%`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Upload error overlay */}
                                                    {hasError && (
                                                        <div className="absolute inset-0 bg-rose-900/70 flex flex-col items-center justify-center">
                                                            <AlertCircle size={28} className="text-white mb-2" />
                                                            <span className="text-xs font-bold text-white text-center px-4">{hasError}</span>
                                                            <span className="text-[10px] text-white/70 mt-1">Tap retry to try again</span>
                                                        </div>
                                                    )}

                                                    {/* Success/Preview overlay */}
                                                    {!isUploading && !isCompressing && !hasError && (
                                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-all">
                                                            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                                                                <Play size={22} className="text-white ml-1" />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Delete / Retry button */}
                                                {!isUploading && !isCompressing && (
                                                    hasError ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // Retry: use stored file from pendingFiles
                                                                const stored = pendingFiles.current[`${completionItem?.id}-video`];
                                                                if (stored) {
                                                                    handleVideoCapture(stored.file);
                                                                }
                                                            }}
                                                            className="absolute top-3 right-3 w-8 h-8 bg-amber-500 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-amber-600 transition-all z-10"
                                                            title="Retry upload"
                                                        >
                                                            <RefreshCw size={16} />
                                                        </button>
                                                    ) : !completionItem?._isLocalPreview && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRemoveMedia(item.id, 'video'); }}
                                                            className="absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-rose-500 transition-all z-10"
                                                            title="Delete video"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    )
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Dynamic input */}
                            {item.type === 'text' && (
                                <div className="px-4 mb-3">
                                    <input type="text" value={String(value || '')} onChange={(e) => handleItemToggle(item.id, e.target.value)}
                                        disabled={itemDisabled} placeholder="Enter observation..."
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:outline-none focus:border-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed" />
                                </div>
                            )}
                            {item.type === 'number' && (
                                <div className="px-4 mb-3">
                                    <input type="number" value={String(value || '')} onChange={(e) => handleItemToggle(item.id, e.target.value)}
                                        disabled={itemDisabled} placeholder="Enter value..."
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:outline-none focus:border-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed" />
                                </div>
                            )}
                            {item.type === 'yes_no' && (
                                <div className="px-4 mb-3 flex gap-3">
                                    <button onClick={() => handleItemToggle(item.id, 'yes')} disabled={itemDisabled}
                                        className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed ${value === 'yes' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>Yes</button>
                                    <button onClick={() => handleItemToggle(item.id, 'no')} disabled={itemDisabled}
                                        className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed ${value === 'no' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-500'}`}>No</button>
                                </div>
                            )}

                            {/* Media documentation */}
                            <div className="px-4 pb-4">
                                <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-0.5">Media Documentation</p>
                                <p className="text-[11px] text-slate-400 font-medium mb-3">
                                    {item.description || 'Upload or capture required proof of completion'}
                                </p>
                                <div className="flex gap-2">
                                    {/* CAPTURE */}
                                    <button onClick={() => { setActiveCameraItemId(item.id); setShowCameraModal(true); }} disabled={itemDisabled}
                                        className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${completionItem?.photo_url ? 'border-primary/30 bg-primary/5 text-primary' : 'border-slate-200 text-primary hover:border-primary/40'}`}>
                                        <Camera size={18} />
                                        <span className="text-[9px] font-black uppercase tracking-widest">{completionItem?.photo_url ? 'Retake' : 'Capture'}</span>
                                    </button>
                                    {/* GALLERY */}
                                    <label className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all ${itemDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-slate-400'} ${completionItem?.photo_url ? 'border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 text-slate-500'}`}>
                                        <Paperclip size={18} />
                                        <span className="text-[9px] font-black uppercase tracking-widest">Gallery</span>
                                        <input type="file" accept="image/*" className="hidden" disabled={itemDisabled} onChange={(e) => handleFileSelect(e, item.id)} />
                                    </label>
                                    {/* 15S VIDEO */}
                                    <button onClick={() => { setActiveVideoItemId(item.id); setShowVideoModal(true); }} disabled={itemDisabled}
                                        className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${completionItem?.video_url ? 'border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                                        <Video size={18} />
                                        <span className="text-[9px] font-black uppercase tracking-widest">{completionItem?.video_url ? 'Re-Record' : '15s Video'}</span>
                                    </button>
                                </div>
                            </div>
                                </motion.div>
                            </React.Fragment>
                        );
                    });
                })()}
            </div>

            {/* ── STICKY FOOTER ── */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-4 py-3 flex gap-3 z-20">
                <button onClick={onCancel}
                    className="flex-1 py-3.5 border border-slate-200 text-slate-600 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-50 transition-all">
                    {isReadOnly ? 'Close' : 'Cancel'}
                </button>
                {isReadOnly ? (
                    <div className="flex-[2] py-3.5 bg-slate-100 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 cursor-not-allowed">
                        <Lock size={11} />
                        {isWindowClosed ? 'Window Closed' : 'Submitted'}
                    </div>
                ) : (
                    <button onClick={handleSubmit} disabled={isSaving}
                        className="flex-[2] py-3.5 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:opacity-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isSaving ? (
                            <><Loader2 size={13} className="animate-spin" /> Saving...</>
                        ) : (
                            <>{checkedCount}/{completion.items.length} Done <ChevronRight size={14} /></>
                        )}
                    </button>
                )}
            </div>

            {/* Camera Modal */}
            <CameraCaptureModal
                isOpen={showCameraModal}
                onClose={() => {
                    setShowCameraModal(false);
                    setActiveCameraItemId(null);
                }}
                onCapture={handlePhotoCapture}
                title="Checklist Visual Audit"
            />

            {/* Image Preview Modal */}
            <ImagePreviewModal
                isOpen={!!previewImageUrl}
                onClose={() => setPreviewImageUrl(null)}
                imageUrl={previewImageUrl}
                title="Audit Proof"
            />

            {/* Video Capture Modal */}
            <VideoCaptureModal
                isOpen={showVideoModal}
                onClose={() => {
                    setShowVideoModal(false);
                    setActiveVideoItemId(null);
                }}
                onCapture={handleVideoCapture}
                title="Checklist Video Audit"
                maxDuration={15}
            />

            {/* Video Preview Modal */}
            <VideoPreviewModal
                isOpen={!!previewVideoUrl}
                onClose={() => setPreviewVideoUrl(null)}
                videoUrl={previewVideoUrl}
                title="Video Proof"
            />

            {/* Toast */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    visible={true}
                    onClose={() => setToast(null)}
                    duration={3000}
                />
            )}
        </div>
    );
};

export default SOPChecklistRunner;
