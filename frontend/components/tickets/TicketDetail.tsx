'use client';

import { useState, useEffect } from 'react';
import {
    ArrowLeft, Clock, User, MapPin, Send, CheckCircle, Circle, Camera,
    AlertTriangle, Pause, Play, Video, Upload, X, Loader2, Package, ShoppingBag, Paperclip
} from 'lucide-react';
import { motion } from 'framer-motion';
import EnhancedClassificationBadge from './EnhancedClassificationBadge';
import MediaCaptureModal, { MediaFile } from '@/frontend/components/shared/MediaCaptureModal';
import CameraCaptureModal from '@/frontend/components/shared/CameraCaptureModal';
import { parseDate } from '@/frontend/utils/date';
import ProcurementCatalogModal from '@/frontend/components/procurement/ProcurementCatalogModal';
import { useAuth } from '@/frontend/context/AuthContext';


interface TicketDetailProps {
    ticketId: string;
    onBack?: () => void;
    isAdmin?: boolean;
}

interface TimelineStep {
    step: string;
    completed: boolean;
    time: string | null;
}

interface Comment {
    id: string;
    comment: string;
    created_at: string;
    is_internal: boolean;
    user?: { full_name: string; user_photo_url?: string };
}

interface Activity {
    id: string;
    action: string;
    new_value?: string | null;
    old_value?: string | null;
    created_at: string;
    user?: { full_name: string };
}

interface EscalationLog {
    id: string;
    from_level: number;
    to_level: number | null;
    reason: string;
    escalated_at: string;
    from_employee?: { full_name: string } | null;
    to_employee?: { full_name: string } | null;
}

function MediaSlot({
    label,
    photoUrl,
    videoUrl,
    timestamp,
    onUpload,
}: {
    label: string;
    photoUrl?: string | null;
    videoUrl?: string | null;
    timestamp?: string | null;
    onUpload?: () => void;
}) {
    const hasVideo = Boolean(videoUrl);
    const hasPhoto = Boolean(photoUrl);
    const hasMedia = hasVideo || hasPhoto;

    return (
        <div>
            <p className="text-sm text-gray-400 mb-2">{label}</p>
            <div className="aspect-video bg-[#0d1117] border border-dashed border-[#30363d] rounded-xl overflow-hidden relative flex items-center justify-center">
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
                    <div className="text-center text-gray-500">
                        <Camera className="w-8 h-8 mx-auto mb-2" />
                        <span className="text-xs">No media</span>
                    </div>
                )}

                {/* Timestamp overlay */}
                {timestamp && (
                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/90 rounded text-[10px] text-white font-bold font-mono backdrop-blur-sm pointer-events-none border border-white/30 shadow-2xl z-20">
                        {parseDate(timestamp)?.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '')}
                    </div>
                )}

                {/* Upload overlay button */}
                {onUpload && (
                    <button
                        onClick={onUpload}
                        className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors backdrop-blur-sm"
                        title={`Upload ${label} media`}
                    >
                        <Upload className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}

export default function TicketDetail({ ticketId, onBack, isAdmin = false }: TicketDetailProps) {
    const { user } = useAuth();
    const userRole = user?.user_metadata?.role || '';
    const isTenant = userRole === 'tenant';

    const [ticket, setTicket] = useState<Record<string, unknown> | null>(null);
    const [timeline, setTimeline] = useState<TimelineStep[]>([]);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [newComment, setNewComment] = useState('');
    const [sendingComment, setSendingComment] = useState(false);

    // Media upload state
    const [showMediaModal, setShowMediaModal] = useState(false);
    const [uploadingType, setUploadingType] = useState<'before' | 'after' | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [escalationLogs, setEscalationLogs] = useState<EscalationLog[]>([]);
    const [procurementRequests, setProcurementRequests] = useState<any[]>([]);
    const [showProcurementModal, setShowProcurementModal] = useState(false);


    useEffect(() => {
        fetchTicketDetail();
    }, [ticketId]);

    const fetchTicketDetail = async () => {
        try {
            const response = await fetch(`/api/tickets/${ticketId}`);
            if (response.ok) {
                const data = await response.json();
                setTicket(data.ticket);
                setTimeline(data.timeline || []);
                setComments(data.comments || []);
                setActivities(data.activities || []);
                setEscalationLogs(data.escalationLogs || []);
                setProcurementRequests(data.procurementRequests || []);
            }
        } catch (error) {
            console.error('Error fetching ticket:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSendComment = async () => {
        if (!newComment.trim()) return;
        setSendingComment(true);
        try {
            const response = await fetch(`/api/tickets/${ticketId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment: newComment }),
            });
            if (response.ok) {
                const data = await response.json();
                // Ensure data is the full comment object and append it
                setComments(prev => [...prev, data]);
                setNewComment('');
            } else {
                const errorData = await response.json();
                alert(`Error: ${errorData.error || 'Failed to send comment'}`);
            }
        } catch (error) {
            console.error('Error sending comment:', error);
            alert('A network error occurred while sending your comment.');
        } finally {
            setSendingComment(false);
        }
    };

    const handleUpdateStatus = async (status: string) => {
        try {
            const response = await fetch(`/api/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (response.ok) fetchTicketDetail();
        } catch (error) {
            console.error('Error updating status:', error);
        }
    };

    const handleProcurementAction = async (requestId: string, status: 'approved' | 'rejected') => {
        try {
            const res = await fetch(`/api/procurement/requests/${requestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (res.ok) {
                await fetchTicketDetail();
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to update request');
            }
        } catch (err) {
            console.error('Procurement action error:', err);
        }
    };

    // Helper to parse timestamps robustly
    const parseDate = (d: string | null | undefined): Date | null => {
        if (!d) return null;
        if (d.includes('T')) {
            return new Date(d.endsWith('Z') || d.includes('+') ? d : `${d}Z`);
        }
        return new Date(`${d.replace(' ', 'T')}Z`);
    };

    // SLA helpers
    const slaDeadline = parseDate(ticket?.sla_deadline as string);
    const resolvedAt = parseDate(ticket?.resolved_at as string);
    // Normalize status for comparison
    const normalizedTicketStatus = (ticket?.status as string || '').toLowerCase().replace(/\s+/g, '_');
    const isResolved = ['resolved', 'closed'].includes(normalizedTicketStatus);
    const isPendingValidation = normalizedTicketStatus === 'pending_validation';

    // For pending_validation, work is done by our side - show resolution info
    // For resolved/closed, use resolved time. For active tickets, use current time.
    const referenceTime = isResolved && resolvedAt ? resolvedAt : (isPendingValidation ? (resolvedAt || new Date()) : new Date());

    // SLA is only "active" for open/assigned/in_progress tickets
    // For pending_validation, show that MST side has completed
    const isSLABreached = Boolean(ticket?.sla_breached) || (slaDeadline !== null && slaDeadline < referenceTime && !isPendingValidation);
    const breachMs = slaDeadline && isSLABreached ? referenceTime.getTime() - slaDeadline.getTime() : 0;

    const formatDuration = (ms: number): string => {
        const totalMins = Math.floor(ms / 60000);
        if (totalMins < 60) return `${totalMins}m`;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

    // Format time in local format
    const formatLocalTime = (date: Date | null) => {
        if (!date) return 'Pending';
        return date.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    const openUpload = (type: 'before' | 'after') => {
        setUploadingType(type);
        setUploadError(null);
        setShowMediaModal(true);
    };

    // Local preview state for instant photo display
    const [localPreview, setLocalPreview] = useState<{ before?: string; after?: string }>({});

    const handleMediaUpload = async (media: MediaFile) => {
        if (!uploadingType) return;
        setShowMediaModal(false);
        setIsUploading(true);
        setUploadError(null);

        try {
            // STEP 1: Show local preview IMMEDIATELY
            const localUrl = URL.createObjectURL(media.file);
            setLocalPreview((prev) => ({ ...prev, [uploadingType]: localUrl }));

            const formData = new FormData();
            formData.append('file', media.file);
            formData.append('type', uploadingType);
            formData.append('takenAt', media.takenAt);

            const endpoint = media.type === 'video'
                ? `/api/tickets/${ticketId}/videos`
                : `/api/tickets/${ticketId}/photos`;

            const res = await fetch(endpoint, { method: 'POST', body: formData });
            if (!res.ok) {
                const text = await res.text();
                let err;
                try { err = JSON.parse(text); } catch { throw new Error(`HTTP Error ${res.status}`); }
                throw new Error(err?.error || 'Upload failed');
            }

            // STEP 2: Refresh ticket data and clean up local preview
            await fetchTicketDetail();
            setLocalPreview((prev) => {
                const key = uploadingType as 'before' | 'after';
                if (prev[key]) URL.revokeObjectURL(prev[key]!);
                return { ...prev, [key]: undefined };
            });
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed');
            // Clean up local preview on error
            setLocalPreview((prev) => {
                const key = uploadingType as 'before' | 'after';
                if (prev[key]) URL.revokeObjectURL(prev[key]!);
                return { ...prev, [key]: undefined };
            });
        } finally {
            setIsUploading(false);
            setUploadingType(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="min-h-screen bg-[#0d1117] flex items-center justify-center text-gray-400">
                Ticket not found
            </div>
        );
    }

    const category = ticket.category as { name?: string } | undefined;
    const creator = ticket.creator as { full_name?: string } | undefined;
    const assignee = ticket.assignee as { full_name?: string } | undefined;

    return (
        <div className="min-h-screen bg-[#0d1117] text-white">
            {/* Header */}
            <div className="sticky top-0 bg-[#0d1117]/95 backdrop-blur border-b border-[#21262d] p-4">
                <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white mb-4">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Requests
                </button>
            </div>

            <div className="max-w-4xl mx-auto p-6 space-y-6">
                {/* Title & Badges */}
                <div>
                    <h1 className="text-2xl font-bold mb-3">{ticket.title as string}</h1>
                    <div className="flex flex-wrap gap-2">
                        {category?.name && (
                            <span className="px-3 py-1 bg-[#21262d] rounded-full text-sm">{category.name}</span>
                        )}
                        <EnhancedClassificationBadge
                            enhanced={ticket.enhanced_classification as boolean}
                            zone={ticket.classification_zone as string}
                        />
                        <span className={`px-3 py-1 rounded-full text-sm ${ticket.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                            ticket.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                'bg-blue-500/20 text-blue-400'
                            }`}>
                            {(ticket.priority as string)?.charAt(0).toUpperCase() + (ticket.priority as string)?.slice(1)} Priority
                        </span>
                        <span className={`px-3 py-1 rounded-full text-sm ${normalizedTicketStatus === 'resolved' ? 'bg-green-500/20 text-green-400' :
                            normalizedTicketStatus === 'in_progress' ? 'bg-cyan-500/20 text-cyan-400' :
                                normalizedTicketStatus === 'pending_validation' ? 'bg-violet-500/20 text-violet-400' :
                                    'bg-gray-500/20 text-gray-400'
                            }`}>
                            {(ticket.status as string)?.replace(/_/g, ' ')}
                        </span>
                    </div>
                </div>

                {/* Issue Description */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <h2 className="text-lg font-semibold mb-3">Issue Description</h2>
                    <p className="text-gray-300 mb-4">{ticket.description as string}</p>

                    <div className="flex flex-wrap gap-6 text-sm text-gray-400">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Created: {parseDate(ticket.created_at as string)?.toLocaleString()}
                        </div>
                        {creator?.full_name && (
                            <div className="flex items-center gap-2">
                                <User className="w-4 h-4" />
                                Reported by: {creator.full_name}
                            </div>
                        )}
                        {typeof ticket.location === 'string' && ticket.location && (
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4" />
                                {ticket.location as string}
                            </div>
                        )}
                    </div>
                </div>

                {/* SLA Breach Section — shown whenever sla_deadline exists */}
                {slaDeadline && (
                    <div className={`border rounded-xl p-6 ${isPendingValidation
                        ? 'bg-violet-500/10 border-violet-500/40'
                        : isSLABreached
                            ? 'bg-red-500/10 border-red-500/40'
                            : 'bg-[#161b22] border-[#30363d]'}`}>
                        {/* Header */}
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isPendingValidation ? 'bg-violet-500/20' : isSLABreached ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                                    {isPendingValidation ? (
                                        <CheckCircle className="w-5 h-5 text-violet-400" />
                                    ) : (
                                        <AlertTriangle className={`w-5 h-5 ${isSLABreached ? 'text-red-400' : 'text-green-400'}`} />
                                    )}
                                </div>
                                <div>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${isPendingValidation ? 'text-violet-400' : isSLABreached ? 'text-red-500' : 'text-slate-400'}`}>
                                        {isPendingValidation ? 'Work Completed' : isSLABreached ? 'Late' : 'On Track'}
                                    </span>
                                    <p className="text-sm text-gray-500">
                                        {isPendingValidation
                                            ? 'MST has completed the work. Awaiting client validation.'
                                            : isSLABreached
                                                ? isResolved
                                                    ? 'Ticket was resolved after the SLA deadline'
                                                    : 'Service Level Agreement has not been met'
                                                : 'Ticket is within the agreed service time'}
                                    </p>
                                </div>
                            </div>
                            {/* Stats pills */}
                            <div className="flex flex-wrap gap-2">
                                <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-center">
                                    <div className="text-base font-black text-white">{(ticket?.sla_hours as number) || 24}h</div>
                                    <div className="text-[9px] text-gray-500 uppercase tracking-wide">SLA Target</div>
                                </div>
                                {isPendingValidation && resolvedAt && (
                                    <div className="px-3 py-2 bg-violet-500/15 border border-violet-500/30 rounded-lg text-center">
                                        <div className="text-base font-black text-violet-400">Completed</div>
                                        <div className="text-[9px] text-gray-500 uppercase tracking-wide">At {formatLocalTime(resolvedAt)}</div>
                                    </div>
                                )}
                                {isSLABreached && (
                                    <div className="px-3 py-2 bg-red-500/15 border border-red-500/30 rounded-lg text-center">
                                        <div className="text-base font-black text-red-400">{formatDuration(breachMs)}</div>
                                        <div className="text-[9px] text-gray-500 uppercase tracking-wide">Overdue By</div>
                                    </div>
                                )}
                                {(ticket?.total_paused_minutes as number) > 0 && (
                                    <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-center">
                                        <div className="text-base font-black text-yellow-400">{formatDuration((ticket?.total_paused_minutes as number) * 60000)}</div>
                                        <div className="text-[9px] text-gray-500 uppercase tracking-wide">Time Paused</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Timeline of events */}
                        <div className="relative pl-4">
                            {/* Vertical line */}
                            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#30363d]" />

                            <div className="space-y-3">
                                {/* Created */}
                                <div className="flex items-center gap-3">
                                    <div className="w-3.5 h-3.5 rounded-full bg-gray-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                                    <div className="flex-1 flex items-center justify-between min-w-0">
                                        <span className="text-sm text-gray-400">Ticket Created</span>
                                        <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{parseDate(ticket?.created_at as string)?.toLocaleString()}</span>
                                    </div>
                                </div>

                                {/* Assigned / SLA started */}
                                {!!ticket?.assigned_at && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                                        <div className="flex-1 flex items-center justify-between min-w-0">
                                            <span className="text-sm text-gray-400">SLA Timer Started <span className="text-gray-600 text-xs">(ticket assigned)</span></span>
                                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                                                {ticket.assigned_at ? parseDate(ticket.assigned_at as string)?.toLocaleString() : 'Pending'}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Paused */}
                                {(ticket?.total_paused_minutes as number) > 0 && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                                        <div className="flex-1 flex items-center justify-between min-w-0">
                                            <span className="text-sm text-yellow-400/80">
                                                SLA Paused
                                                {!!ticket?.sla_pause_reason && <span className="text-gray-500 ml-1">— {ticket.sla_pause_reason as string}</span>}
                                            </span>
                                            <span className="text-xs text-yellow-500/70 ml-2 flex-shrink-0">+{formatDuration((ticket.total_paused_minutes as number) * 60000)} added to deadline</span>
                                        </div>
                                    </div>
                                )}

                                {/* Pending Validation - Work Completed by MST */}
                                {isPendingValidation && resolvedAt && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-3.5 h-3.5 rounded-full bg-violet-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                                        <div className="flex-1 flex items-center justify-between min-w-0">
                                            <span className="text-sm text-violet-400 font-medium">
                                                Work Completed by MST
                                            </span>
                                            <span className="text-xs text-violet-400/70 ml-2 flex-shrink-0">
                                                {formatLocalTime(resolvedAt)}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Deadline row — highlighted only for active tickets that breached */}
                                {!isPendingValidation && (
                                    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 -ml-2 ${isSLABreached ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                                        <div className={`w-3.5 h-3.5 rounded-full border-2 border-[#0d1117] flex-shrink-0 z-10 ${isSLABreached ? 'bg-red-500' : 'bg-green-500'}`} />
                                        <div className="flex-1 flex items-center justify-between min-w-0">
                                            <span className={`text-sm font-bold ${isSLABreached ? 'text-red-400' : 'text-green-400'}`}>
                                                SLA Deadline {isSLABreached ? '— Missed' : '— Met'}
                                            </span>
                                            <span className={`text-xs font-bold ml-2 flex-shrink-0 ${isSLABreached ? 'text-red-400' : 'text-green-400'}`}>
                                                {slaDeadline?.toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Resolved (if applicable) */}
                                {!!resolvedAt && !isPendingValidation && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                                        <div className="flex-1 flex items-center justify-between min-w-0">
                                            <span className="text-sm text-green-400">
                                                Resolved
                                                {isSLABreached && <span className="text-red-400/70 text-xs ml-1">(+{formatDuration(breachMs)} after deadline)</span>}
                                            </span>
                                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{resolvedAt?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Request Progress Timeline */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <h2 className="text-lg font-semibold mb-6">Request Progress</h2>

                    <div className="flex items-center justify-between">
                        {timeline.map((step, index) => (
                            <div key={step.step} className="flex flex-col items-center">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step.completed ? 'bg-green-500' : 'bg-[#30363d]'}`}>
                                    {step.completed ? (
                                        <CheckCircle className="w-5 h-5 text-white" />
                                    ) : (
                                        <Circle className="w-5 h-5 text-gray-500" />
                                    )}
                                </div>
                                <span className={`text-xs mt-2 ${step.completed ? 'text-green-400' : 'text-gray-500'}`}>
                                    {step.step}
                                </span>
                                {index < timeline.length - 1 && (
                                    <div className={`absolute h-1 w-full ${step.completed ? 'bg-green-500' : 'bg-[#30363d]'}`}
                                        style={{ left: '50%', top: '20px', width: 'calc(100% - 40px)' }} />
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-[#30363d]">
                        {timeline.map((step) => (
                            <span
                                key={step.step}
                                className={`px-3 py-1 rounded text-xs ${step.completed ? 'bg-green-500/20 text-green-400' : 'bg-[#21262d] text-gray-500'}`}
                            >
                                {step.step} {step.completed && '✓'}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Escalation Timeline */}
                {escalationLogs.length > 0 && (
                    <div className="bg-[#161b22] border border-red-500/30 rounded-xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

                        {/* Header */}
                        <div className="flex items-center justify-between gap-3 mb-6 relative z-10 flex-wrap">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0 border border-red-500/20">
                                    <AlertTriangle className="w-5 h-5 text-red-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-red-400">Escalation Timeline</h2>
                                    <p className="text-xs text-gray-400">{escalationLogs.length} escalation{escalationLogs.length > 1 ? 's' : ''} recorded</p>
                                </div>
                            </div>
                        </div>

                        {/* Timeline entries */}
                        <div className="relative pl-5 z-10">
                            <div className="absolute left-[9px] top-2 bottom-2 w-px bg-red-500/20" />
                            <div className="space-y-4">
                                {escalationLogs.map((log) => {
                                    const fromInitials = log.from_employee?.full_name
                                        ? log.from_employee.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                                        : '?';
                                    const toInitials = log.to_employee?.full_name
                                        ? log.to_employee.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                                        : '?';
                                    const reasonLabel =
                                        log.reason === 'timeout' ? 'SLA Timeout' :
                                        log.reason === 'manual' ? 'Manual' :
                                        log.reason || 'Timeout';
                                    return (
                                        <div key={log.id} className="flex items-start gap-3">
                                            <div className="w-[18px] h-[18px] rounded-full bg-red-500 border-2 border-[#161b22] flex-shrink-0 mt-1 z-10" />
                                            <div className="flex-1 bg-red-500/5 border border-red-500/10 rounded-xl p-4">
                                                {/* Level badges + reason + timestamp */}
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-xs font-bold px-3 py-1 rounded-md bg-gray-800 text-gray-400 border border-gray-700">
                                                            L{log.from_level}
                                                        </span>
                                                        <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                                        <span className="text-xs font-bold px-3 py-1 rounded-md bg-red-500/20 text-red-300 border border-red-500/30">
                                                            L{log.to_level ?? 'Final'}
                                                        </span>
                                                        <span className="text-xs px-3 py-1 rounded-full bg-orange-500/10 text-orange-400">
                                                            {reasonLabel}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs text-gray-500">
                                                        {parseDate(log.escalated_at)?.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                {/* From → To employees */}
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-gray-700 text-gray-300">
                                                            {fromInitials}
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] uppercase tracking-wider text-gray-500">From</p>
                                                            <p className="text-xs font-medium text-gray-300">{log.from_employee?.full_name || 'Unassigned'}</p>
                                                        </div>
                                                    </div>
                                                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-red-500/20 text-red-300">
                                                            {toInitials}
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] text-white/50 mb-0.5">Assigned To</p>
                                                            <p className="text-xs font-bold text-white">{log.to_employee?.full_name || 'Not Assigned'}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Media Section — Photos + Videos */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold">Photos & Videos</h2>
                        {isUploading && (
                            <div className="flex items-center gap-2 text-cyan-400 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Uploading…
                            </div>
                        )}
                    </div>

                    {uploadError && (
                        <div className="mb-4 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {uploadError}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <MediaSlot
                            label="Before"
                            photoUrl={localPreview.before || (ticket.photo_before_url as string | null)}
                            videoUrl={ticket.video_before_url as string | null}
                            timestamp={
                                activities.find(a =>
                                    a.action === 'photo_before_uploaded' ||
                                    a.action === 'video_before_uploaded' ||
                                    (a.action === 'photo_upload' && a.new_value?.includes('before')) ||
                                    (a.action === 'video_upload' && a.new_value?.includes('before'))
                                )?.old_value
                            }
                            onUpload={() => openUpload('before')}
                        />
                        <MediaSlot
                            label="After"
                            photoUrl={localPreview.after || (ticket.photo_after_url as string | null)}
                            videoUrl={ticket.video_after_url as string | null}
                            timestamp={
                                activities.find(a =>
                                    a.action === 'photo_after_uploaded' ||
                                    a.action === 'video_after_uploaded' ||
                                    (a.action === 'photo_upload' && a.new_value?.includes('after')) ||
                                    (a.action === 'video_upload' && a.new_value?.includes('after'))
                                )?.old_value
                            }
                            onUpload={() => openUpload('after')}
                        />
                    </div>
                </div>

                {/* Assigned Technician */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    {assignee?.full_name ? (
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                <User className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Assigned Staff</p>
                                <p className="font-medium">{assignee.full_name}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-400 text-center py-4">No staff assigned yet</p>
                    )}
                </div>

                {/* Procurement Requests */}
                {procurementRequests.length > 0 && (
                    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <ShoppingBag className="w-5 h-5 text-cyan-400" />
                                Material Requests
                            </h2>
                            <span className="px-3 py-1.5 bg-[#21262d] rounded-md text-xs text-gray-400">
                                {procurementRequests.length} Request{procurementRequests.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="space-y-4">
                            {procurementRequests.map((req) => (
                                <div key={req.id} className="border border-[#30363d] rounded-lg p-4 bg-[#0d1117]">
                                    <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-medium text-sm text-white">
                                                    Req #{req.id.split('-')[0]}
                                                </span>
                                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                                    req.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                                    req.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                                                    'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                    {req.status.replace('_', ' ').toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                Requested by {req.requester?.full_name || 'Unknown'} on {parseDate(req.created_at)?.toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm font-bold text-white">
                                                ₹{req.total_amount?.toLocaleString() || '0'}
                                            </div>
                                            <div className="text-xs text-gray-500 capitalize">
                                                Budget: {req.budget_type?.replace('_', ' ')}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Items Preview */}
                                    <div className="bg-[#161b22] rounded-md p-3">
                                        <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                                            Items ({req.items?.length || 0})
                                        </div>
                                        <div className="space-y-2">
                                            {req.items?.slice(0, 3).map((item: any) => (
                                                <div key={item.id} className="flex justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-gray-300">{item.name}</span>
                                                        <span className="text-xs text-gray-500">x{item.quantity}</span>
                                                    </div>
                                                    <span className="text-gray-400">₹{item.total_price?.toLocaleString() || '0'}</span>
                                                </div>
                                            ))}
                                            {(req.items?.length || 0) > 3 && (
                                                <div className="text-xs text-cyan-400 mt-2">
                                                    + {(req.items?.length || 0) - 3} more items...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    

                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Communication Thread */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <h2 className="text-lg font-semibold mb-4">Communication Thread</h2>

                    <div className="space-y-4 max-h-64 overflow-y-auto mb-4">
                        {comments.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">No comments yet. Be the first to start the conversation.</p>
                        ) : (
                            comments.map((comment) => (
                                <div key={comment.id} className="flex gap-3">
                                    <div className="w-8 h-8 bg-[#21262d] rounded-full flex items-center justify-center flex-shrink-0">
                                        <User className="w-4 h-4 text-gray-400" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium text-sm">{comment.user?.full_name || 'Unknown'}</span>
                                            <span className="text-xs text-gray-500">
                                                {parseDate(comment.created_at)?.toLocaleString()}
                                            </span>
                                        </div>
                                        <p className="text-gray-300 text-sm">{comment.comment}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="flex flex-col gap-3 pt-4 border-t border-[#30363d]">
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                placeholder="Type your message here..."
                                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                                onKeyDown={(e) => e.key === 'Enter' && handleSendComment()}
                            />
                            <button
                                onClick={handleSendComment}
                                disabled={sendingComment || !newComment.trim()}
                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 rounded-lg flex items-center gap-2 transition-all"
                            >
                                <Send className="w-4 h-4" />
                                <span className="hidden sm:inline">Send</span>
                            </button>
                        </div>
                        
                        {!isTenant && (
                            <div className="flex justify-end">
                                <button 
                                    onClick={() => setShowProcurementModal(true)}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all font-medium"
                                >
                                    <Package className="w-4 h-4" />
                                    Material Request
                                </button>
                            </div>
                        )}
                    </div>

                </div>

                {/* Admin Actions */}
                {isAdmin && (
                    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4">Admin Actions</h2>
                        <div className="flex flex-wrap gap-3">
                            <button onClick={() => handleUpdateStatus('in_progress')} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm">
                                Start Work
                            </button>
                            <button onClick={() => handleUpdateStatus('resolved')} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm">
                                Mark Resolved
                            </button>
                            <button onClick={() => handleUpdateStatus('closed')} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm">
                                Close Ticket
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Media Capture Modal */}
            <MediaCaptureModal
                isOpen={showMediaModal}
                onClose={() => { setShowMediaModal(false); setUploadingType(null); }}
                onCapture={handleMediaUpload}
                title={`Upload ${uploadingType === 'before' ? 'Before' : 'After'} Media`}
            />

            {/* Procurement Modal */}
            {ticket && (
                <ProcurementCatalogModal 
                    isOpen={showProcurementModal}
                    onClose={() => {
                        setShowProcurementModal(false);
                        fetchTicketDetail(); // Refresh to show the procurement activity log
                    }}
                    ticketId={ticketId}
                    propertyId={ticket.property_id as string}
                    organizationId={ticket.organization_id as string}
                    isProcurementUser={user?.user_metadata?.role?.toLowerCase().includes('procurement')}
                />
            )}
        </div>
    );
}

