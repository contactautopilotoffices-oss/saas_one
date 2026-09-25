'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    FileText, Search, Lock, MessageSquare, ArrowUpRight, Clock,
    User, Filter, Building2, Tag, CheckCircle, RefreshCw, Paperclip,
    Calendar, Sparkles, ExternalLink
} from 'lucide-react';

interface HRNotesTrackerTabProps {
    orgId: string;
    currentUserId?: string;
    currentUserRole?: string;
    onOpenTicket: (ticketId: string) => void;
}

interface NoteItem {
    id: string;
    ticket_id: string;
    ticket_number: string;
    ticket_subject: string;
    ticket_type: string;
    ticket_status: string;
    ticket_level: number;
    ticket_category: string;
    is_confidential: boolean;
    is_anonymous: boolean;
    submitter_name: string;
    submitter_department: string;
    submitter_location: string;
    author_id: string | null;
    author_name: string;
    author_email: string;
    author_photo: string | null;
    author_role: string;
    content: string;
    attachment_urls: string[];
    is_internal: boolean;
    created_at: string;
}

interface TicketNotesGroup {
    ticket_id: string;
    ticket_number: string;
    ticket_subject: string;
    ticket_type: string;
    ticket_status: string;
    ticket_level: number;
    ticket_category: string;
    is_confidential: boolean;
    is_anonymous: boolean;
    submitter_name: string;
    submitter_department: string;
    submitter_location: string;
    notes: NoteItem[];
    last_activity_at: string;
}

export default function HRNotesTrackerTab({
    orgId,
    currentUserId,
    currentUserRole,
    onOpenTicket
}: HRNotesTrackerTabProps) {
    const [notes, setNotes] = useState<NoteItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | 'internal' | 'public'>('all');
    const [scopeFilter, setScopeFilter] = useState<'all' | 'my_notes'>('all');
    const [includeSubmitter, setIncludeSubmitter] = useState(false);

    useEffect(() => {
        fetchNotes();
    }, [orgId, currentUserId, currentUserRole, includeSubmitter]);

    const fetchNotes = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const params = new URLSearchParams({
                orgId,
                ...(currentUserId ? { userId: currentUserId } : {}),
                ...(currentUserRole ? { role: currentUserRole } : {}),
                ...(includeSubmitter ? { includeSubmitter: 'true' } : {})
            });
            const res = await fetch(`/api/hr/notes?${params.toString()}`);
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setNotes(data.data);
            }
        } catch (err) {
            console.error('Failed to load HR notes:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const getInitials = (name: string) => {
        if (!name) return 'U';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.slice(0, 2).toUpperCase();
    };

    const formatDateTime = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return dateStr;
        }
    };

    const getRelativeTime = (dateStr: string) => {
        try {
            const diff = Date.now() - new Date(dateStr).getTime();
            const minutes = Math.floor(diff / 60000);
            if (minutes < 1) return 'Just now';
            if (minutes < 60) return `${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
        } catch {
            return '';
        }
    };

    // Filter notes based on user selections
    const filteredNotes = useMemo(() => {
        return notes.filter(item => {
            if (typeFilter === 'internal' && !item.is_internal) return false;
            if (typeFilter === 'public' && item.is_internal) return false;
            if (scopeFilter === 'my_notes' && item.author_id !== currentUserId) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const matchContent = item.content.toLowerCase().includes(q);
                const matchTicketNum = item.ticket_number.toLowerCase().includes(q);
                const matchSubject = item.ticket_subject.toLowerCase().includes(q);
                const matchAuthor = item.author_name.toLowerCase().includes(q);
                const matchSubmitter = item.submitter_name.toLowerCase().includes(q);
                const matchCategory = item.ticket_category.toLowerCase().includes(q);
                if (!matchContent && !matchTicketNum && !matchSubject && !matchAuthor && !matchSubmitter && !matchCategory) {
                    return false;
                }
            }
            return true;
        });
    }, [notes, typeFilter, scopeFilter, searchQuery, currentUserId]);

    // Group filtered notes by ticket into 1 UI box per ticket
    const groupedTickets = useMemo(() => {
        const groupsMap = new Map<string, TicketNotesGroup>();

        filteredNotes.forEach((note) => {
            let group = groupsMap.get(note.ticket_id);
            if (!group) {
                group = {
                    ticket_id: note.ticket_id,
                    ticket_number: note.ticket_number,
                    ticket_subject: note.ticket_subject,
                    ticket_type: note.ticket_type,
                    ticket_status: note.ticket_status,
                    ticket_level: note.ticket_level,
                    ticket_category: note.ticket_category,
                    is_confidential: note.is_confidential,
                    is_anonymous: note.is_anonymous,
                    submitter_name: note.submitter_name,
                    submitter_department: note.submitter_department,
                    submitter_location: note.submitter_location,
                    notes: [],
                    last_activity_at: note.created_at
                };
                groupsMap.set(note.ticket_id, group);
            }
            group.notes.push(note);
            if (new Date(note.created_at) > new Date(group.last_activity_at)) {
                group.last_activity_at = note.created_at;
            }
        });

        const list = Array.from(groupsMap.values());
        // Sort tickets by most recent note activity
        list.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());

        // Sort notes chronologically within each ticket
        list.forEach((g) => {
            g.notes.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });

        return list;
    }, [filteredNotes]);

    const stats = useMemo(() => {
        const total = notes.length;
        const internal = notes.filter(n => n.is_internal).length;
        const publicReplies = notes.filter(n => !n.is_internal).length;
        const uniqueTickets = new Set(notes.map(n => n.ticket_id)).size;
        return { total, internal, publicReplies, uniqueTickets };
    }, [notes]);

    return (
        <div className="space-y-5">
            {/* Header Description & Stats Strip */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-tr from-[#587e85] to-teal-700 text-white rounded-2xl shadow-sm">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                            HR Notes & Remarks Ledger
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Track all internal notes, backstage remarks, and public replies across tickets grouped by ticket.
                        </p>
                    </div>
                </div>

                {/* Live Count Badges */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                        <span className="text-slate-400 font-medium mr-1.5">Total Notes:</span>
                        <span className="font-extrabold text-slate-900 dark:text-white">{stats.total}</span>
                    </div>

                    <div className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-300">
                        <span className="font-medium mr-1.5">🔒 Internal Notes:</span>
                        <span className="font-extrabold">{stats.internal}</span>
                    </div>

                    <div className="px-3 py-1.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/80 text-xs text-teal-900 dark:text-teal-300">
                        <span className="font-medium mr-1.5">💬 Public Replies:</span>
                        <span className="font-extrabold">{stats.publicReplies}</span>
                    </div>

                    <div className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 text-xs text-indigo-900 dark:text-indigo-300">
                        <span className="font-medium mr-1.5">Tickets Involved:</span>
                        <span className="font-extrabold">{stats.uniqueTickets}</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => fetchNotes(true)}
                        disabled={refreshing}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
                        title="Refresh Notes"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#587e85]' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                {/* Search Bar */}
                <div className="relative flex-1 max-w-xl">
                    <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search notes by keyword, ticket #, author, employee, or topic..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] font-medium placeholder-slate-400"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Filter Controls */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Note Type Filter */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setTypeFilter('all')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                typeFilter === 'all'
                                    ? 'bg-[#587e85] text-white shadow-xs'
                                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            All ({stats.total})
                        </button>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('internal')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                typeFilter === 'internal'
                                    ? 'bg-amber-600 text-white shadow-xs'
                                    : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                            }`}
                        >
                            <Lock className="w-3 h-3" />
                            <span>Internal Notes ({stats.internal})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setTypeFilter('public')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                typeFilter === 'public'
                                    ? 'bg-teal-600 text-white shadow-xs'
                                    : 'text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40'
                            }`}
                        >
                            <MessageSquare className="w-3 h-3" />
                            <span>Public Replies ({stats.publicReplies})</span>
                        </button>
                    </div>

                    {/* Scope Filter */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setScopeFilter('all')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                scopeFilter === 'all'
                                    ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xs'
                                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            All HR Team
                        </button>
                        <button
                            type="button"
                            onClick={() => setScopeFilter('my_notes')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                                scopeFilter === 'my_notes'
                                    ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xs'
                                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            My Notes Only
                        </button>
                        <button
                            type="button"
                            onClick={() => setIncludeSubmitter(!includeSubmitter)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                                includeSubmitter
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                            }`}
                            title="Toggle whether to include comments posted by ticket submitter employees"
                        >
                            {includeSubmitter ? '✓ Inc. Submitter Replies' : '+ Submitter Replies'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Ticket Boxes Feed */}
            {loading ? (
                <div className="p-16 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                    <div className="w-8 h-8 border-3 border-[#587e85] border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-bold text-slate-500 mt-3">Loading notes & remarks ledger...</p>
                </div>
            ) : groupedTickets.length === 0 ? (
                <div className="p-16 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                    <div className="w-12 h-12 rounded-2xl bg-[#587e85]/10 text-[#587e85] flex items-center justify-center mx-auto mb-3">
                        <FileText className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                        No Notes Found
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                        {searchQuery 
                            ? `No notes matched your search "${searchQuery}". Try a different keyword.` 
                            : 'No notes have been logged for this filter yet.'}
                    </p>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="mt-3.5 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 transition-all shadow-2xs"
                        >
                            Clear Search
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4.5">
                    {groupedTickets.map((ticketGroup) => {
                        const internalCount = ticketGroup.notes.filter(n => n.is_internal).length;
                        const publicCount = ticketGroup.notes.filter(n => !n.is_internal).length;

                        return (
                            <div
                                key={ticketGroup.ticket_id}
                                className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:shadow-md transition-all overflow-hidden flex flex-col justify-between"
                            >
                                {/* Ticket Header & Submitter Context */}
                                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {/* 1-Click Jump Ticket Number */}
                                            <button
                                                type="button"
                                                onClick={() => onOpenTicket(ticketGroup.ticket_id)}
                                                className="inline-flex items-center gap-1 font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-[#587e85]/10 text-[#587e85] hover:bg-[#587e85] hover:text-white transition-all shadow-2xs group"
                                                title="Open ticket details"
                                            >
                                                <span>#{ticketGroup.ticket_number}</span>
                                                <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                                            </button>

                                            {/* Status Badge */}
                                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                                                ticketGroup.ticket_status === 'closed'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                    : ticketGroup.ticket_status === 'resolved'
                                                    ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'
                                                    : ticketGroup.ticket_status === 'escalated'
                                                    ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300'
                                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300'
                                            }`}>
                                                {ticketGroup.ticket_status.replace(/_/g, ' ')}
                                            </span>

                                            {/* Notes Breakdown Count */}
                                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                                                <span>{ticketGroup.notes.length} {ticketGroup.notes.length === 1 ? 'Note' : 'Notes'}</span>
                                                {internalCount > 0 && (
                                                    <span className="text-amber-700 dark:text-amber-400 font-extrabold">({internalCount} 🔒 Internal)</span>
                                                )}
                                                {publicCount > 0 && (
                                                    <span className="text-teal-700 dark:text-teal-400 font-extrabold">({publicCount} 💬 Public)</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* View Ticket Action Button */}
                                        <button
                                            type="button"
                                            onClick={() => onOpenTicket(ticketGroup.ticket_id)}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white hover:bg-[#587e85] text-slate-700 hover:text-white dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-[#587e85] dark:hover:text-white border border-slate-200 dark:border-slate-700 text-xs font-bold transition-all shadow-2xs"
                                        >
                                            <span>View Ticket</span>
                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* Ticket Subject & Submitter Context */}
                                    <div className="space-y-1">
                                        <div className="text-sm font-extrabold text-slate-900 dark:text-white line-clamp-1">
                                            {ticketGroup.ticket_subject}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                                            <span className="flex items-center gap-1">
                                                {ticketGroup.is_anonymous ? <Lock className="w-3.5 h-3.5 text-amber-600" /> : <User className="w-3.5 h-3.5 text-slate-400" />}
                                                <span className="font-semibold text-slate-800 dark:text-slate-200">{ticketGroup.submitter_name}</span>
                                            </span>
                                            <span>•</span>
                                            <span>{ticketGroup.ticket_category}</span>
                                            <span>•</span>
                                            <span>{ticketGroup.submitter_location}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* All Notes Inside This Ticket's UI Box */}
                                <div className="p-4 sm:p-5 space-y-3.5 flex-1">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 tracking-wider uppercase">
                                        <span>Notes & Remarks Thread</span>
                                        <span>{ticketGroup.notes.length} Total</span>
                                    </div>

                                    <div className="space-y-3">
                                        {ticketGroup.notes.map((note) => (
                                            <div
                                                key={note.id}
                                                className={`rounded-2xl border p-3.5 transition-all text-xs space-y-2.5 ${
                                                    note.is_internal
                                                        ? 'bg-amber-50/60 dark:bg-amber-950/25 border-amber-200/90 dark:border-amber-900/40 text-amber-950 dark:text-amber-100'
                                                        : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                                                }`}
                                            >
                                                {/* Note Author & Badge Bar */}
                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                    <div className="flex items-center gap-2">
                                                        {note.author_photo ? (
                                                            <img
                                                                src={note.author_photo}
                                                                alt=""
                                                                referrerPolicy="no-referrer"
                                                                onError={(e) => {
                                                                    e.currentTarget.classList.add('!hidden');
                                                                    const fb = e.currentTarget.nextElementSibling as HTMLElement;
                                                                    if (fb) fb.classList.remove('!hidden');
                                                                }}
                                                                className="w-6 h-6 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                                                            />
                                                        ) : null}
                                                        <div className={`${note.author_photo ? '!hidden' : ''} w-6 h-6 rounded-full bg-[#587e85]/10 text-[#587e85] border border-[#587e85]/20 flex items-center justify-center text-[9.5px] font-black`}>
                                                            {getInitials(note.author_name)}
                                                        </div>
                                                        <div>
                                                            <span className="font-extrabold text-slate-900 dark:text-white mr-1.5">
                                                                {note.author_name}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 font-medium">
                                                                • {getRelativeTime(note.created_at)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Internal vs Public Channel Badge */}
                                                    {note.is_internal ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                                            <Lock className="w-2.5 h-2.5 shrink-0" />
                                                            <span>Internal Note</span>
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                                            <MessageSquare className="w-2.5 h-2.5 shrink-0" />
                                                            <span>Public Reply</span>
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Note Content */}
                                                <div className="leading-relaxed whitespace-pre-wrap font-normal text-[12.5px] pl-1">
                                                    {note.content}
                                                </div>

                                                {/* Note Attachments if any */}
                                                {note.attachment_urls && note.attachment_urls.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                                        {note.attachment_urls.map((url, i) => (
                                                            <a
                                                                key={i}
                                                                href={url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-[#587e85] border border-slate-200 dark:border-slate-700 shadow-2xs"
                                                            >
                                                                <Paperclip className="w-3 h-3 text-[#587e85]" />
                                                                <span>Attachment {i + 1}</span>
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Ticket Box Footer */}
                                <div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                                    <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                                        <Clock className="w-3 h-3 shrink-0" />
                                        <span>Latest activity: {getRelativeTime(ticketGroup.last_activity_at)}</span>
                                    </span>

                                    <button
                                        type="button"
                                        onClick={() => onOpenTicket(ticketGroup.ticket_id)}
                                        className="text-[#587e85] dark:text-[#6c9a9e] hover:underline font-bold text-xs flex items-center gap-1"
                                    >
                                        <span>Open Full Ticket Conversation</span>
                                        <ArrowUpRight className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
