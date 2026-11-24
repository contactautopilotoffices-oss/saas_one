'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Send, Loader2, CheckCircle, AlertCircle, Camera, Image as ImageIcon, Video, Play, Pause, AtSign, Search, Activity, Paperclip } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import { playTickleSound } from '@/frontend/utils/sounds';
import MediaCaptureModal, { MediaFile } from '@/frontend/components/shared/MediaCaptureModal';
import {
    MAX_TICKET_FILES,
    TICKET_ATTACHMENT_ACCEPT,
    TicketFileIcon,
    checkTicketFile,
    formatFileSize,
    uploadTicketFile,
} from '@/frontend/components/tickets/TicketAttachments';

interface TicketCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId?: string;
    organizationId?: string;
    onSuccess?: (ticket: unknown) => void;
    isAdminMode?: boolean;
    organizations?: any[];
    properties?: any[];
    showInternalToggle?: boolean; // shown for all roles except tenant
    showCriticalToggle?: boolean; // shown for ops_super_admin and org_super_admin
    userRole?: string;
}

interface Classification {
    category: string | null;
    confidence: number;
    isVague: boolean;
    status?: string;
}

export default function TicketCreateModal({
    isOpen,
    onClose,
    propertyId,
    organizationId,
    onSuccess,
    isAdminMode = false,
    organizations = [],
    properties = [],
    showInternalToggle = false,
    showCriticalToggle = false,
}: TicketCreateModalProps) {
    const [description, setDescription] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [isCritical, setIsCritical] = useState(false);
    const [mediaFile, setMediaFile] = useState<MediaFile | null>(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [showMediaModal, setShowMediaModal] = useState(false);
    // Owner 2026-11-03: optional documents / images attached to the request (uploaded after the ticket is created)
    const [attachments, setAttachments] = useState<File[]>([]);
    const [attachmentWarning, setAttachmentWarning] = useState<string | null>(null);
    const attachInputRef = useRef<HTMLInputElement>(null);
    // Owner 2026-11-24: an image picked through Attach while there is no Before photo yet waits here until the
    // user says whether it is a photo of the issue (becomes the Before photo) or a document (stays an attachment).
    const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [classification, setClassification] = useState<Classification | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Admin Mode State
    const [selectedOrgId, setSelectedOrgId] = useState(organizationId || '');
    const [selectedPropId, setSelectedPropId] = useState(propertyId || '');
    const [availableProperties, setAvailableProperties] = useState<any[]>(properties || []);
    const supabase = createClient();
    const { user } = useAuth();

    // @mention state
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const mentionDropdownRef = useRef<HTMLDivElement>(null);
    const [propertyUsers, setPropertyUsers] = useState<{ id: string; full_name: string; role?: string; designation?: string; email?: string }[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionSearch, setMentionSearch] = useState('');
    const [mentionStartIndex, setMentionStartIndex] = useState(-1);
    const [showMentionDropdown, setShowMentionDropdown] = useState(false);
    const [taggedUser, setTaggedUser] = useState<{ id: string; full_name: string } | null>(null);

    useEffect(() => {
        if (properties && properties.length > 0) {
            setAvailableProperties(properties);
        }
    }, [properties]);

    // Fetch property users for @mention via backend API
    useEffect(() => {
        const pid = isAdminMode ? selectedPropId : propertyId;
        const oid = isAdminMode ? selectedOrgId : organizationId;
        if (!pid && !oid) {
            setPropertyUsers([]);
            return;
        }

        let isMounted = true;
        setIsLoadingUsers(true);
        const params = new URLSearchParams();
        if (pid) params.append('propertyId', pid);
        if (oid) params.append('organizationId', oid);

        fetch(`/api/tickets/mention-users?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (isMounted && data.users) {
                    setPropertyUsers(data.users);
                }
            })
            .catch(err => console.error('Failed to load mention users:', err))
            .finally(() => {
                if (isMounted) setIsLoadingUsers(false);
            });

        return () => { isMounted = false; };
    }, [propertyId, selectedPropId, organizationId, selectedOrgId, isAdminMode]);

    // Close mention dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                mentionDropdownRef.current &&
                !mentionDropdownRef.current.contains(e.target as Node) &&
                textareaRef.current &&
                !textareaRef.current.contains(e.target as Node)
            ) {
                setShowMentionDropdown(false);
                setMentionSearch('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleOrgChange = async (orgId: string) => {
        setSelectedOrgId(orgId);
        setSelectedPropId('');
        if (orgId) {
            const { data } = await supabase
                .from('properties')
                .select('id, name, code')
                .eq('organization_id', orgId)
                .eq('status', 'active');
            setAvailableProperties(data || []);
        } else {
            setAvailableProperties([]);
        }
    };

    const handleMediaCapture = (media: MediaFile) => {
        setMediaFile(media);
        setShowMediaModal(false);
        // The Camera photo is the Before photo now, so an unanswered Attach image is a plain attachment
        if (pendingPhoto) {
            setAttachments(prev => [...prev, pendingPhoto]);
            setPendingPhoto(null);
        }
    };

    const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setDescription(val);
        const cursor = e.target.selectionStart ?? val.length;
        const textBeforeCursor = val.slice(0, cursor);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
            const query = textBeforeCursor.slice(atIndex + 1);
            if (!query.includes(' ') && !query.includes('\n')) {
                setMentionQuery(query);
                setMentionStartIndex(atIndex);
                setShowMentionDropdown(true);
                return;
            }
        }
        setShowMentionDropdown(false);
        setMentionQuery('');
    };

    const handleMentionSelect = (user: { id: string; full_name: string }) => {
        const atIdx = mentionStartIndex >= 0 ? mentionStartIndex : description.lastIndexOf('@');
        const queryLen = mentionQuery.length;
        const before = atIdx >= 0 ? description.slice(0, atIdx) : description;
        const after = atIdx >= 0 ? description.slice(atIdx + 1 + queryLen) : '';
        setDescription(`${before}@${user.full_name} ${after}`.trimStart());
        setTaggedUser(user);
        setShowMentionDropdown(false);
        setMentionQuery('');
        setMentionSearch('');
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const activeFilter = (mentionSearch || mentionQuery).trim().toLowerCase();
    const filteredMentionUsers = activeFilter
        ? propertyUsers.filter(u =>
            u.full_name.toLowerCase().includes(activeFilter) ||
            (u.role && u.role.toLowerCase().includes(activeFilter)) ||
            (u.designation && u.designation.toLowerCase().includes(activeFilter)) ||
            (u.email && u.email.toLowerCase().includes(activeFilter))
          )
        : propertyUsers;

    const handleSubmit = async () => {
        if (!description.trim()) {
            setError('Please describe the issue');
            return;
        }

        const finalOrgId = isAdminMode ? selectedOrgId : organizationId;
        const finalPropId = isAdminMode ? selectedPropId : propertyId;

        if (!finalOrgId || !finalPropId) {
            setError('Please select an organization and property');
            return;
        }

        const tempId = `temp-${Date.now()}`;
        const currentDesc = description.trim();
        const currentMedia = mediaFile;
        const currentAttachments = [...attachments];
        const currentTagged = taggedUser;
        const currentCritical = isCritical;
        const currentInternal = isInternal;

        const effectiveInternal = showInternalToggle ? currentInternal : false;
        const effectiveTagged = showInternalToggle ? currentTagged : null;

        // Build optimistic ticket for instant display
        const optimisticTicket: any = {
            id: tempId,
            ticket_number: 'AP-CREATING...',
            title: currentDesc.split('\n')[0].slice(0, 100),
            description: currentDesc,
            property_id: finalPropId,
            organization_id: finalOrgId,
            status: effectiveTagged ? 'assigned' : 'open',
            priority: showCriticalToggle && currentCritical ? 'critical' : 'medium',
            internal: effectiveInternal,
            is_internal: effectiveInternal,
            created_at: new Date().toISOString(),
            photo_before_url: currentMedia ? currentMedia.preview : undefined,
            video_before_url: currentMedia?.type === 'video' ? currentMedia.preview : undefined,
            raised_by: user?.id,
            creator: {
                id: user?.id,
                full_name: user?.user_metadata?.full_name || user?.email || 'You',
                user_photo_url: user?.user_metadata?.user_photo_url || null,
            },
            assignee: effectiveTagged ? { id: effectiveTagged.id, full_name: effectiveTagged.full_name } : null,
        };

        // Instant optimistic feedback: play sound, notify parent, close modal immediately
        playTickleSound();
        onSuccess?.(optimisticTicket);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ticket-created', { detail: { ticket: optimisticTicket } }));
            window.dispatchEvent(new CustomEvent('request-created', { detail: { ticket: optimisticTicket } }));
        }

        handleReset();
        onClose();

        // Background sync to backend: create ticket + upload media and attachments
        (async () => {
            try {
                const response = await fetch('/api/tickets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description: currentDesc,
                        propertyId: finalPropId,
                        organizationId: finalOrgId,
                        isInternal: effectiveInternal,
                        assignedTo: effectiveTagged?.id,
                        ...(showCriticalToggle && currentCritical ? { priority: 'critical' } : {}),
                    }),
                });

                const data = await response.json();
                if (!response.ok || !data.ticket) throw new Error(data.error || 'Failed to create ticket');

                const serverTicket = data.ticket;
                const ticketWithPreview = {
                    ...serverTicket,
                    photo_before_url: currentMedia ? currentMedia.preview : serverTicket.photo_before_url,
                    video_before_url: currentMedia?.type === 'video' ? currentMedia.preview : serverTicket.video_before_url,
                };

                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('ticket-created', { detail: { ticket: ticketWithPreview, tempId } }));
                    window.dispatchEvent(new CustomEvent('request-created', { detail: { ticket: ticketWithPreview, tempId } }));
                }

                // Background upload of media
                if (currentMedia && serverTicket.id) {
                    try {
                        const formData = new FormData();
                        formData.append('file', currentMedia.file);
                        formData.append('type', 'before');
                        formData.append('takenAt', currentMedia.takenAt || new Date().toISOString());

                        const endpoint = currentMedia.type === 'video'
                            ? `/api/tickets/${serverTicket.id}/videos`
                            : `/api/tickets/${serverTicket.id}/photos`;

                        const mediaResponse = await fetch(endpoint, { method: 'POST', body: formData });
                        if (mediaResponse.ok) {
                            const mediaJson = await mediaResponse.json();
                            if (mediaJson.url && typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('ticket-created', {
                                    detail: { ticket: { ...serverTicket, photo_before_url: mediaJson.url }, tempId: serverTicket.id }
                                }));
                            }
                        }
                    } catch (mediaErr) {
                        console.error('[TicketCreateModal] Media upload failed in background:', mediaErr);
                    }
                }

                // Background upload of attachments
                if (currentAttachments.length > 0 && serverTicket.id) {
                    for (const file of currentAttachments) {
                        await uploadTicketFile(serverTicket.id, file);
                    }
                }
            } catch (err) {
                console.error('[TicketCreateModal] Background ticket creation failed:', err);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('ticket-create-failed', { detail: { tempId } }));
                }
            }
        })();
    };

    const handleAttachPick = (list: FileList | null) => {
        const picked = Array.from(list || []);
        if (attachInputRef.current) attachInputRef.current.value = '';
        if (!picked.length) return;
        const problem = picked.map(checkTicketFile).find(Boolean);
        if (problem) {
            setError(String(problem));
            return;
        }
        const room = MAX_TICKET_FILES - attachments.length;
        if (picked.length > room) {
            setError(`You can attach at most ${MAX_TICKET_FILES} files to a request.`);
            return;
        }
        setError(null);
        // No Before photo yet: hold back the first image and ask what it is
        const photo = mediaFile || pendingPhoto ? undefined : picked.find(canBeBeforePhoto);
        if (photo) setPendingPhoto(photo);
        setAttachments(prev => [...prev, ...picked.filter(f => f !== photo)]);
    };

    // Same limits the Before-photo upload route enforces (image, 10 MB at most)
    const canBeBeforePhoto = (file: File) => file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024;

    const setBeforePhotoFrom = (file: File) => {
        setMediaFile({
            file,
            type: 'image',
            preview: URL.createObjectURL(file),
            takenAt: new Date(file.lastModified || Date.now()).toISOString(),
        });
    };

    const answerPendingPhoto = (isIssuePhoto: boolean) => {
        if (!pendingPhoto) return;
        if (isIssuePhoto) setBeforePhotoFrom(pendingPhoto);
        else setAttachments(prev => [...prev, pendingPhoto]);
        setPendingPhoto(null);
    };

    const handleReset = () => {
        setDescription('');
        setIsInternal(false);
        setIsCritical(false);
        setMediaFile(null);
        setAttachments([]);
        setPendingPhoto(null);
        setAttachmentWarning(null);
        setClassification(null);
        setError(null);
        setSuccess(false);
        setTaggedUser(null);
        setShowMentionDropdown(false);
        setMentionQuery('');
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-200">
                        <h2 className="text-lg sm:text-xl font-black text-slate-900">Raise a New Request</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors p-1 hover:bg-slate-100 rounded-lg">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-4 sm:p-6 space-y-4 overflow-y-auto custom-scrollbar">
                        {success ? (
                            <div className="text-center py-8">
                                <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
                                <h3 className="text-xl font-display font-semibold text-text-primary mb-2">Request Submitted!</h3>
                                <p className="text-text-secondary font-body text-sm mb-4">Your request has been created and will be reviewed shortly.</p>
                                {attachmentWarning && (
                                    <div className="flex items-start gap-2 text-left text-amber-600 text-xs font-body bg-amber-50 border border-amber-200 rounded-xl p-3">
                                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        <span>{attachmentWarning}</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                {isAdminMode && (
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">Organization</label>
                                            <select
                                                value={selectedOrgId}
                                                onChange={(e) => handleOrgChange(e.target.value)}
                                                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                                            >
                                                <option value="">Select Org</option>
                                                {organizations?.map(org => (
                                                    <option key={org.id} value={org.id}>{org.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">Property</label>
                                            <select
                                                value={selectedPropId}
                                                onChange={(e) => setSelectedPropId(e.target.value)}
                                                disabled={!selectedOrgId}
                                                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                                            >
                                                <option value="">Select Property</option>
                                                {availableProperties.map(prop => (
                                                    <option key={prop.id} value={prop.id}>{prop.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Description */}
                                <div>
                                    <label className="text-sm font-bold text-slate-700 mb-2 flex items-center justify-between flex-wrap gap-2">
                                        <span className="flex items-center gap-2">
                                            <span>Description</span>
                                            {showInternalToggle && <span className="text-xs font-normal text-slate-400 hidden xs:inline">type @ to assign someone</span>}
                                        </span>
                                        {showInternalToggle && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!showMentionDropdown) {
                                                        const cursor = textareaRef.current?.selectionStart ?? description.length;
                                                        const newDesc = description.slice(0, cursor) + '@' + description.slice(cursor);
                                                        setDescription(newDesc);
                                                        setMentionStartIndex(cursor);
                                                        setMentionQuery('');
                                                        setMentionSearch('');
                                                        setShowMentionDropdown(true);
                                                        setTimeout(() => textareaRef.current?.focus(), 0);
                                                    } else {
                                                        setShowMentionDropdown(false);
                                                        setMentionSearch('');
                                                    }
                                                }}
                                                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 active:scale-95 transition-all px-3 py-1.5 rounded-xl touch-manipulation"
                                            >
                                                <AtSign className="w-3.5 h-3.5" />
                                                <span>Mention / Assign</span>
                                            </button>
                                        )}
                                    </label>
                                    <div className="relative">
                                        <textarea
                                            ref={textareaRef}
                                            value={description}
                                            onChange={handleDescriptionChange}
                                            onKeyDown={(e) => {
                                                if (showMentionDropdown && e.key === 'Escape') {
                                                    setShowMentionDropdown(false);
                                                    setMentionSearch('');
                                                    e.preventDefault();
                                                }
                                            }}
                                            placeholder="Describe the issue in your own words...&#10;Example: Leaking tap in kitchenette, 2nd floor"
                                            className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all text-sm font-medium"
                                        />

                                        {/* @mention dropdown: positioned relative to textarea on all devices so it never gets trapped or clipped */}
                                        {showMentionDropdown && (
                                            <div
                                                ref={mentionDropdownRef}
                                                className="absolute inset-x-0 top-full mt-1.5 z-50 max-h-64 rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                                            >
                                                {/* Dropdown Header */}
                                                <div className="px-4 py-3 sm:px-3 sm:py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                                            <AtSign className="w-3.5 h-3.5 text-primary" />
                                                        </div>
                                                        <span className="text-xs sm:text-[11px] font-black text-slate-800 uppercase tracking-wider">Assign to user</span>
                                                        <span className="text-xs sm:text-[10px] font-bold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
                                                            {filteredMentionUsers.length}
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setShowMentionDropdown(false);
                                                            setMentionSearch('');
                                                        }}
                                                        className="text-slate-400 hover:text-slate-700 active:bg-slate-200 p-1.5 rounded-xl transition-all"
                                                        aria-label="Close user selection"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>

                                                {/* Search Input */}
                                                <div className="p-3 sm:p-2 border-b border-slate-100 bg-white shrink-0">
                                                    <div className="relative">
                                                        <Search className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                                        <input
                                                            type="text"
                                                            value={mentionSearch}
                                                            onChange={(e) => setMentionSearch(e.target.value)}
                                                            placeholder="Search name, role, or email..."
                                                            className="w-full pl-9 pr-9 py-2.5 sm:py-1.5 text-sm sm:text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all font-medium"
                                                            autoFocus
                                                        />
                                                        {mentionSearch && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setMentionSearch('')}
                                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* User List */}
                                                <div className="overflow-y-auto max-h-[50vh] sm:max-h-48 divide-y divide-slate-100 custom-scrollbar overscroll-contain">
                                                    {isLoadingUsers ? (
                                                        <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                                                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                                            <span>Loading team members...</span>
                                                        </div>
                                                    ) : filteredMentionUsers.length === 0 ? (
                                                        <div className="p-6 text-center text-xs text-slate-400">
                                                            {activeFilter ? (
                                                                <>No team members matching &ldquo;{activeFilter}&rdquo;</>
                                                            ) : (
                                                                <>No users available for assignment</>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        filteredMentionUsers.map(user => (
                                                            <button
                                                                key={user.id}
                                                                type="button"
                                                                onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(user); }}
                                                                onTouchEnd={(e) => { e.preventDefault(); handleMentionSelect(user); }}
                                                                className="w-full flex items-center justify-between px-4 py-3 sm:px-3 sm:py-2.5 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left min-h-[50px] sm:min-h-0"
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className="w-9 h-9 sm:w-7 sm:h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                                                        <span className="text-xs sm:text-[10px] font-black text-primary">
                                                                            {user.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                                                        </span>
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm sm:text-xs font-bold text-slate-900 truncate">{user.full_name}{user.role === 'it' && ' (IT)'}</p>
                                                                        {user.email && <p className="text-xs sm:text-[10px] text-slate-400 truncate font-medium">{user.email}</p>}
                                                                    </div>
                                                                </div>
                                                                {user.role && (
                                                                    <span className="text-[10px] sm:text-[9px] font-bold text-slate-600 bg-slate-100 border border-slate-200/80 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 ml-2">
                                                                        {user.role.replace(/_/g, ' ')}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Tagged user chip */}
                                    {taggedUser && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-xs text-slate-500">Assigned to:</span>
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs font-bold">
                                                <AtSign className="w-3 h-3" />
                                                {taggedUser.full_name}
                                                <button
                                                    type="button"
                                                    onClick={() => { setTaggedUser(null); setDescription(description.replace(`@${taggedUser.full_name} `, '').replace(`@${taggedUser.full_name}`, '')); }}
                                                    className="ml-0.5 hover:text-red-500 transition-colors"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Internal toggle — hidden for tenant role */}
                                {showInternalToggle && (
                                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">Internal ticket</p>
                                            <p className="text-xs text-slate-400 mt-0.5">Not visible to tenants</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsInternal(v => !v)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isInternal ? 'bg-amber-500' : 'bg-slate-300'}`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isInternal ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </div>
                                )}

                                {/* Critical Priority toggle — shown for ops & org super admin */}
                                {showCriticalToggle && (
                                    <div className={`flex items-center justify-between px-4 py-3 border rounded-xl transition-colors ${isCritical ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
                                        <div className="flex items-center gap-2.5">
                                            <Activity className={`w-4 h-4 ${isCritical ? 'text-rose-600 animate-pulse' : 'text-rose-500'}`} />
                                            <div>
                                                <p className={`text-sm font-bold ${isCritical ? 'text-rose-700' : 'text-slate-700'}`}>
                                                    {isCritical ? 'Critical Request' : 'Mark Critical'}
                                                </p>
                                                <p className="text-xs text-slate-400 mt-0.5">
                                                    Flags ticket as Critical priority &amp; notifies selected Omnichannel recipients
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsCritical(v => !v)}
                                            aria-pressed={isCritical}
                                            aria-label={isCritical ? 'Critical Request' : 'Mark Critical'}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isCritical ? 'bg-rose-500' : 'bg-slate-300'}`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isCritical ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </div>
                                )}

                                {/* Media Preview */}
                                {mediaFile && (
                                    <div className="relative rounded-xl overflow-hidden bg-black">
                                        {mediaFile.type === 'image' ? (
                                            <>
                                                <img src={mediaFile.preview} alt="Before photo" className="w-full h-40 object-cover" />
                                                <span className="absolute top-2 left-2 text-[10px] font-black uppercase tracking-wider text-white bg-emerald-600 px-2 py-0.5 rounded-full">Before photo</span>
                                            </>
                                        ) : (
                                            <div className="relative w-full h-40">
                                                <video
                                                    ref={videoRef}
                                                    src={mediaFile.preview}
                                                    className="w-full h-full object-cover"
                                                    onEnded={() => setIsVideoPlaying(false)}
                                                    onPause={() => setIsVideoPlaying(false)}
                                                    onPlay={() => setIsVideoPlaying(true)}
                                                />
                                                {/* Overlay — hidden while playing, shown when paused */}
                                                <div
                                                    className={`absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer transition-opacity ${isVideoPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}
                                                    onClick={() => {
                                                        if (!videoRef.current) return;
                                                        if (videoRef.current.paused) {
                                                            videoRef.current.play();
                                                        } else {
                                                            videoRef.current.pause();
                                                        }
                                                    }}
                                                >
                                                    <div className="bg-white/20 backdrop-blur-sm rounded-full p-3 hover:bg-white/30 transition-colors">
                                                        {isVideoPlaying
                                                            ? <Pause className="w-6 h-6 text-white fill-white" />
                                                            : <Play className="w-6 h-6 text-white fill-white" />
                                                        }
                                                    </div>
                                                    {!isVideoPlaying && (
                                                        <span className="absolute bottom-2 left-3 text-white text-xs font-bold bg-black/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                            <Video className="w-3 h-3" /> Video attached
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => { setMediaFile(null); setIsVideoPlaying(false); }}
                                            className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}

                                {/* Attachments (optional) */}
                                {attachments.length > 0 && (
                                    <ul className="space-y-2">
                                        {attachments.map((file, i) => (
                                            <li key={`${file.name}-${i}`} className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                                                <TicketFileIcon name={file.name} className="w-4 h-4 text-primary flex-shrink-0" />
                                                <span className="flex-1 min-w-0 truncate text-xs font-bold text-slate-700" title={file.name}>{file.name}</span>
                                                <span className="text-[10px] text-slate-400 flex-shrink-0">{formatFileSize(file.size)}</span>
                                                {!mediaFile && !pendingPhoto && canBeBeforePhoto(file) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setBeforePhotoFrom(file);
                                                            setAttachments(prev => prev.filter((_, idx) => idx !== i));
                                                        }}
                                                        disabled={isSubmitting}
                                                        className="text-[11px] font-bold text-primary underline flex-shrink-0 disabled:opacity-50"
                                                    >
                                                        Use as Before photo
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                                    disabled={isSubmitting}
                                                    title="Remove file"
                                                    className="text-slate-400 hover:text-red-500 transition-colors p-0.5 disabled:opacity-50"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <input
                                    ref={attachInputRef}
                                    type="file"
                                    multiple
                                    accept={TICKET_ATTACHMENT_ACCEPT}
                                    className="hidden"
                                    onChange={(e) => handleAttachPick(e.target.files)}
                                />

                                {/* Image picked through Attach with no Before photo yet: ask what it is */}
                                {pendingPhoto && (
                                    <div role="group" aria-labelledby="pending-photo-question" className="p-3 bg-slate-50 border border-slate-300 rounded-xl space-y-3">
                                        <div className="flex items-center gap-2">
                                            <ImageIcon className="w-4 h-4 text-primary flex-shrink-0" />
                                            <p id="pending-photo-question" className="text-sm font-bold text-slate-800">What is this photo?</p>
                                            <span className="flex-1 min-w-0 truncate text-[11px] text-slate-400 text-right" title={pendingPhoto.name}>{pendingPhoto.name}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => answerPendingPhoto(true)}
                                                className="text-left px-3 py-2 bg-emerald-50 border border-emerald-400 rounded-xl hover:bg-emerald-100 transition-colors"
                                            >
                                                <span className="block text-sm font-bold text-slate-800">Photo of the issue</span>
                                                <span className="block text-[11px] text-slate-500">Saved as the Before photo</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => answerPendingPhoto(false)}
                                                className="text-left px-3 py-2 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 transition-colors"
                                            >
                                                <span className="block text-sm font-bold text-slate-800">Document</span>
                                                <span className="block text-[11px] text-slate-500">Bill, quote or form. Saved in attachments</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Actions Row */}
                                <div className="flex items-center gap-3 pt-4">
                                    {/* Camera / Media button */}
                                    <button
                                        onClick={() => setShowMediaModal(true)}
                                        className="flex-1 flex flex-col items-center justify-center gap-1 px-2 py-3 bg-slate-100 border border-slate-300 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors active:scale-95 text-center h-20"
                                    >
                                        <Camera className="w-6 h-6 text-slate-600" />
                                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide hidden sm:block">Camera</span>
                                    </button>

                                    {/* Attach files button (optional: PDF, Word, Excel, images) */}
                                    <button
                                        type="button"
                                        onClick={() => attachInputRef.current?.click()}
                                        disabled={isSubmitting || !!pendingPhoto || attachments.length >= MAX_TICKET_FILES}
                                        title={attachments.length >= MAX_TICKET_FILES ? `At most ${MAX_TICKET_FILES} files` : 'Attach PDF, Word, Excel or images'}
                                        className="flex-1 flex flex-col items-center justify-center gap-1 px-2 py-3 bg-slate-100 border border-slate-300 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors active:scale-95 text-center h-20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Paperclip className="w-6 h-6 text-slate-600" />
                                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide hidden sm:block">
                                            Attach{attachments.length > 0 ? ` (${attachments.length})` : ''}
                                        </span>
                                    </button>

                                    {/* Submit */}
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting || !!pendingPhoto || !description.trim()}
                                        className="flex-[2] flex flex-col items-center justify-center gap-1 px-2 py-3 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-primary/30 active:scale-95 h-20"
                                    >
                                        {isSubmitting ? (
                                            <Loader2 className="w-5 h-5 animate-spin mb-1" />
                                        ) : (
                                            <Send className="w-5 h-5 mb-1" />
                                        )}
                                        <span className="font-black uppercase tracking-widest text-xs">Submit</span>
                                    </button>
                                </div>

                                {/* Error */}
                                {error && (
                                    <div className="flex items-center gap-2 text-error text-xs font-body">
                                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                        {error}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <MediaCaptureModal
                        isOpen={showMediaModal}
                        onClose={() => setShowMediaModal(false)}
                        onCapture={handleMediaCapture}
                        title="Add Photo or Video"
                    />
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
