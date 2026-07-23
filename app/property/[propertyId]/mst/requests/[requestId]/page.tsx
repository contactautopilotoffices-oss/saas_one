'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { ArrowLeft, MapPin, Clock, AlertTriangle, User, CheckCircle2, Activity, Camera, Video, Upload, Loader2, Play, Sparkles, Pencil, Image as ImageIcon, History, Package, XCircle, UserCog, GitBranch, Share2, Trash2, ClipboardCheck } from 'lucide-react';
import MediaCaptureModal, { MediaFile } from '@/frontend/components/shared/MediaCaptureModal';

function formatTimeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

function MediaSlotCard({
    label,
    photoUrl,
    videoUrl,
    onUpload,
    isUploading,
}: {
    label: string;
    photoUrl?: string | null;
    videoUrl?: string | null;
    onUpload: () => void;
    isUploading?: boolean;
}) {
    const hasVideo = Boolean(videoUrl);
    const hasPhoto = Boolean(photoUrl);
    const hasMedia = hasVideo || hasPhoto;

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                <button
                    onClick={onUpload}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-500 disabled:opacity-50 transition-colors"
                >
                    {isUploading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <Upload className="w-3.5 h-3.5" />
                    )}
                    {isUploading ? 'Uploading…' : 'Upload'}
                </button>
            </div>

            <div className="aspect-video relative flex items-center justify-center bg-slate-50">
                {hasVideo ? (
                    <video
                        src={videoUrl!}
                        controls
                        playsInline
                        className="w-full h-full object-cover"
                    />
                ) : hasPhoto ? (
                    <img src={photoUrl!} alt={label} className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Camera className="w-8 h-8" />
                        <span className="text-xs">No media yet</span>
                        <button
                            onClick={onUpload}
                            className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-500 transition-colors"
                        >
                            <Upload className="w-3.5 h-3.5" /> Add photo or video
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function RequestDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const propertyId = params?.propertyId as string;
    const requestId = params?.requestId as string;
    const [ticket, setTicket] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [property, setProperty] = useState<any>(null);

    // Media upload state
    const [showMediaModal, setShowMediaModal] = useState(false);
    const [uploadingType, setUploadingType] = useState<'before' | 'after' | null>(null);
    const [isUploadingBefore, setIsUploadingBefore] = useState(false);
    const [isUploadingAfter, setIsUploadingAfter] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'details' | 'photos' | 'materials' | 'timeline'>('details');

    const supabase = createClient();

    const fetchData = async () => {
        if (!requestId || !propertyId) return;
        setIsLoading(true);

        const { data: ticketData, error: ticketError } = await supabase
            .from('tickets')
            .select(`
                *,
                creator:users!raised_by(full_name, email),
                category:issue_categories(name, code, icon)
            `)
            .eq('id', requestId)
            .single();

        if (ticketError) console.error('Error fetching ticket:', ticketError);
        else setTicket(ticketData);

        const { data: propertyData, error: propertyError } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single();

        if (propertyError) console.error('Error fetching property:', propertyError);
        else setProperty(propertyData);

        setIsLoading(false);
    };

    useEffect(() => { fetchData(); }, [requestId, propertyId]);

    const openUpload = (type: 'before' | 'after') => {
        setUploadingType(type);
        setUploadError(null);
        setShowMediaModal(true);
    };

    const handleMediaUpload = async (media: MediaFile) => {
        if (!uploadingType || !ticket?.id) return;
        setShowMediaModal(false);

        const setUploading = uploadingType === 'before' ? setIsUploadingBefore : setIsUploadingAfter;
        setUploading(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append('file', media.file);
            formData.append('type', uploadingType);

            const endpoint = media.type === 'video'
                ? `/api/tickets/${ticket.id}/videos`
                : `/api/tickets/${ticket.id}/photos`;

            const res = await fetch(endpoint, { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Upload failed');
            }
            await fetchData();
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
            setUploadingType(null);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center text-slate-500">
                Loading request details...
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="min-h-screen bg-white flex flex-col items-center justify-center text-slate-500 gap-4">
                <p>Request not found.</p>
                <button onClick={() => router.back()} className="flex items-center gap-2 text-emerald-600 hover:text-emerald-500">
                    <ArrowLeft className="w-4 h-4" /> Go Back
                </button>
            </div>
        );
    }

    const priorityColors: Record<string, string> = {
        urgent: 'bg-red-50 text-red-600 border-red-100',
        high: 'bg-orange-50 text-orange-600 border-orange-100',
        medium: 'bg-blue-50 text-blue-600 border-blue-100',
        low: 'bg-slate-50 text-slate-600 border-slate-100',
    };

    const statusColors: Record<string, string> = {
        open: 'bg-orange-50 text-orange-600 border-orange-100',
        in_progress: 'bg-blue-50 text-blue-600 border-blue-100',
        assigned: 'bg-slate-50 text-slate-500 border-slate-200',
        resolved: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        closed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    };

    const formatDueTime = (dateString?: string) => {
        if (!dateString) return null;
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans">
            {/* Compact Header */}
            <header className="px-6 pt-4 pb-0 bg-white">
                {/* Back Arrow - isolated top left */}
                <button
                    onClick={() => router.back()}
                    className="mb-3 p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>

                {/* Tags Row */}
                <div className="flex flex-wrap items-center gap-2 mb-5">
                    {ticket.location && (
                        <span className="px-3 py-1 bg-slate-50 text-slate-500 rounded text-[10px] font-semibold uppercase tracking-wider border border-slate-100">
                            {ticket.location}
                        </span>
                    )}
                    {ticket.ticket_number && (
                        <span className="px-3 py-1 bg-slate-50 text-slate-500 rounded text-[10px] font-semibold uppercase tracking-wider border border-slate-100">
                            {ticket.ticket_number}
                        </span>
                    )}
                    {ticket.priority && (
                        <span className={`px-3 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border ${priorityColors[ticket.priority as string] || priorityColors.medium}`}>
                            {ticket.priority} Priority
                        </span>
                    )}
                    {ticket.enhanced_classification && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-slate-50 text-slate-500 rounded text-[10px] font-semibold uppercase tracking-wider border border-slate-100">
                            <Sparkles className="w-3 h-3 text-purple-400" />
                            AI-Assisted
                        </span>
                    )}
                    {(ticket.procurement_requests_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-600 rounded text-[10px] font-semibold uppercase tracking-wider border border-amber-100">
                            <Package className="w-3 h-3" />
                            {ticket.procurement_requests_count} Material Request{ticket.procurement_requests_count > 1 ? 's' : ''}
                        </span>
                    )}
                </div>

                {/* Title Row with Action Icons */}
                <div className="flex items-start justify-between gap-4">
                    <h1 className="text-[26px] font-bold text-slate-900 leading-tight">
                        {ticket.title || 'Untitled Request'}
                    </h1>
                    <div className="flex items-center gap-1 flex-shrink-0 pt-1">
                        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
                            <Share2 className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Description + Status Row */}
                <div className="flex items-start justify-between gap-6 mt-3">
                    <div className="flex-1 min-w-0">
                        {ticket.description && (
                            <p className="text-[13px] text-slate-500 italic flex items-start gap-2 leading-relaxed">
                                <Sparkles className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                                <span>&ldquo;{ticket.description}&rdquo;</span>
                            </p>
                        )}
                    </div>

                    {/* Status & Due - aligned right */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusColors[ticket.status as string] || statusColors.assigned}`}>
                            {ticket.status?.replace('_', ' ')}
                        </span>
                        {ticket.sla_deadline && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                <Clock className="w-3 h-3" />
                                <span>Due {formatDueTime(ticket.sla_deadline)}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 mt-6">
                    <button className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors">
                        <UserCog className="w-4 h-4" />
                        Reassign
                    </button>
                    <button className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-100 rounded-full text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-100 transition-colors">
                        <XCircle className="w-4 h-4" />
                        Force Close
                    </button>
                    <button
                        onClick={() => router.push(`/property/${propertyId}/flow-map`)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                        <GitBranch className="w-4 h-4" />
                        Flow Map
                    </button>
                    <button className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-full text-[11px] font-bold uppercase tracking-wider text-emerald-600 hover:bg-emerald-100 transition-colors">
                        <Package className="w-4 h-4" />
                        Material Request
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-8 mt-6 border-b border-slate-200">
                    {[
                        { id: 'details', label: 'DETAILS', icon: Pencil },
                        { id: 'photos', label: 'PHOTOS', icon: Camera },
                        { id: 'materials', label: 'MATERIALS', icon: ClipboardCheck },
                        { id: 'timeline', label: 'TIMELINE', icon: Clock },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 pb-3 text-[11px] font-bold tracking-wider transition-colors relative ${
                                activeTab === tab.id
                                    ? 'text-slate-900'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            <tab.icon className="w-3.5 h-3.5" />
                            {tab.label}
                            {activeTab === tab.id && (
                                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-900 rounded-t-full" />
                            )}
                        </button>
                    ))}
                </div>
            </header>

            <main className="px-6 py-5 max-w-5xl mx-auto">
                {activeTab === 'photos' && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Photos & Videos</h3>
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <Camera className="w-3 h-3" /> Photo
                                    <span className="mx-1">·</span>
                                    <Video className="w-3 h-3" /> Video supported
                                </div>
                            </div>

                            {uploadError && (
                                <div className="mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2 border border-red-100">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                    {uploadError}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <MediaSlotCard
                                    label="Before"
                                    photoUrl={ticket.photo_before_url}
                                    videoUrl={ticket.video_before_url}
                                    onUpload={() => openUpload('before')}
                                    isUploading={isUploadingBefore}
                                />
                                <MediaSlotCard
                                    label="After"
                                    photoUrl={ticket.photo_after_url}
                                    videoUrl={ticket.video_after_url}
                                    onUpload={() => openUpload('after')}
                                    isUploading={isUploadingAfter}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'materials' && (
                    <div className="bg-white border border-slate-200 rounded-xl p-6">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Material Requests</h3>
                        <p className="text-xs text-slate-500">No material requests linked to this ticket.</p>
                    </div>
                )}

                {activeTab === 'timeline' && (
                    <div className="bg-white border border-slate-200 rounded-xl p-6 opacity-50">
                        <h3 className="text-sm font-bold mb-4 text-slate-700">Activity Log</h3>
                        <p className="text-xs text-slate-500">No recent activity.</p>
                    </div>
                )}

                {activeTab === 'details' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Content */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Media Section */}
                            <div className="bg-white border border-slate-200 rounded-xl p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Photos & Videos</h3>
                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                        <Camera className="w-3 h-3" /> Photo
                                        <span className="mx-1">·</span>
                                        <Video className="w-3 h-3" /> Video supported
                                    </div>
                                </div>

                                {uploadError && (
                                    <div className="mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2 border border-red-100">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        {uploadError}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <MediaSlotCard
                                        label="Before"
                                        photoUrl={ticket.photo_before_url}
                                        videoUrl={ticket.video_before_url}
                                        onUpload={() => openUpload('before')}
                                        isUploading={isUploadingBefore}
                                    />
                                    <MediaSlotCard
                                        label="After"
                                        photoUrl={ticket.photo_after_url}
                                        videoUrl={ticket.video_after_url}
                                        onUpload={() => openUpload('after')}
                                        isUploading={isUploadingAfter}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-6">
                            {/* Property Details */}
                            <div className="bg-white border border-slate-200 rounded-xl p-6">
                                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Property Details</h3>
                                {property ? (
                                    <div className="space-y-4">
                                        <div>
                                            <p className="text-slate-900 font-bold">{property.name}</p>
                                            <div className="flex items-start gap-2 mt-2 text-xs text-slate-500">
                                                <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                                <p>{property.address || 'No address provided'}</p>
                                            </div>
                                        </div>
                                        <div className="pt-4 border-t border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs text-slate-500">Property Code</span>
                                                <code className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-700 border border-slate-200">{property.code}</code>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500">Loading property info...</p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="bg-white border border-slate-200 rounded-xl p-6">
                                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Actions</h3>
                                <button
                                    onClick={() => router.push(`/property/${propertyId}/flow-map`)}
                                    className="w-full flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 py-2.5 rounded-lg text-sm font-bold transition-colors mb-3"
                                >
                                    <Activity className="w-4 h-4" />
                                    Live Flow Map
                                </button>
                                <button className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-sm font-medium transition-colors mb-3">
                                    <CheckCircle2 className="w-4 h-4" />
                                    Accept Request
                                </button>
                                <button className="w-full flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                    <AlertTriangle className="w-4 h-4" />
                                    Report Issue
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Media Capture Modal */}
            <MediaCaptureModal
                isOpen={showMediaModal}
                onClose={() => { setShowMediaModal(false); setUploadingType(null); }}
                onCapture={handleMediaUpload}
                title={`Upload ${uploadingType === 'before' ? 'Before' : 'After'} Media`}
            />
        </div>
    );
}
