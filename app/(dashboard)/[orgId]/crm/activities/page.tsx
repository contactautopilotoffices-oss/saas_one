'use client';

import React, { useState, useEffect } from 'react';
import { CRMActivity } from '@/frontend/types/crm';
import { Activity, Phone, Video, Map, FileText, MessageSquare, CheckCircle, Edit, User, Clock, Filter } from 'lucide-react';

const ACTIVITY_ICONS: Record<string, any> = {
    created: CheckCircle,
    updated: Edit,
    call: Phone,
    meeting: Video,
    site_visit: Map,
    proposal_sent: FileText,
    followup_scheduled: MessageSquare,
    status_changed: CheckCircle,
    assigned: User,
    note_added: MessageSquare,
    email_sent: FileText,
    archived: CheckCircle,
    restored: CheckCircle
};

const ACTIVITY_COLORS: Record<string, string> = {
    created: 'bg-green-100 text-green-600',
    updated: 'bg-blue-100 text-blue-600',
    call: 'bg-purple-100 text-purple-600',
    meeting: 'bg-indigo-100 text-indigo-600',
    site_visit: 'bg-orange-100 text-orange-600',
    proposal_sent: 'bg-teal-100 text-teal-600',
    followup_scheduled: 'bg-cyan-100 text-cyan-600',
    status_changed: 'bg-emerald-100 text-emerald-600',
    assigned: 'bg-pink-100 text-pink-600',
    note_added: 'bg-yellow-100 text-yellow-600',
    email_sent: 'bg-blue-100 text-blue-600',
    archived: 'bg-slate-100 text-slate-600',
    restored: 'bg-green-100 text-green-600'
};

export default function ActivitiesPage() {
    const [activities, setActivities] = useState<CRMActivity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<string>('all');

    useEffect(() => {
        fetchActivities();
    }, [filter]);

    const fetchActivities = async () => {
        setIsLoading(true);
        try {
            // Fetch all leads to get their activities
            const res = await fetch('/api/crm/leads?page_size=50');
            if (res.ok) {
                const data = await res.json();
                // For now, we'll show activities from the first few leads
                // In production, you'd have a dedicated activities API endpoint
                const allActivities: CRMActivity[] = [];
                for (const lead of (data.leads || []).slice(0, 10)) {
                    const activityRes = await fetch(`/api/crm/activities?lead_id=${lead.id}`);
                    if (activityRes.ok) {
                        const activityData = await activityRes.json();
                        allActivities.push(...(activityData.activities || []));
                    }
                }
                setActivities(allActivities.sort((a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                ));
            }
        } catch (error) {
            console.error('Failed to fetch activities:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const filteredActivities = filter === 'all'
        ? activities
        : activities.filter(a => a.activity_type === filter);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Activities</h1>
                    <p className="text-sm text-text-secondary mt-1">
                        Track all interactions with your leads
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        filter === 'all'
                            ? 'bg-primary text-white'
                            : 'bg-slate-100 text-text-secondary hover:bg-slate-200'
                    }`}
                >
                    All
                </button>
                {['call', 'meeting', 'site_visit', 'note_added', 'status_changed'].map(type => (
                    <button
                        key={type}
                        onClick={() => setFilter(type)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                            filter === type
                                ? 'bg-primary text-white'
                                : 'bg-slate-100 text-text-secondary hover:bg-slate-200'
                        }`}
                    >
                        {React.createElement(ACTIVITY_ICONS[type] || Activity, { className: 'w-4 h-4' })}
                        {type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </button>
                ))}
            </div>

            {/* Activities List */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {isLoading ? (
                    <div className="p-6 space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
                        ))}
                    </div>
                ) : filteredActivities.length === 0 ? (
                    <div className="text-center py-12 text-text-secondary">
                        <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                        <p>No activities found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredActivities.map(activity => {
                            const Icon = ACTIVITY_ICONS[activity.activity_type] || Activity;
                            const colorClass = ACTIVITY_COLORS[activity.activity_type] || 'bg-slate-100 text-slate-600';

                            return (
                                <div key={activity.id} className="p-4 hover:bg-slate-50 transition-colors">
                                    <div className="flex items-start gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClass}`}>
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <p className="font-medium text-text-primary">
                                                    {activity.activity_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                </p>
                                                <span className="text-xs text-text-tertiary">
                                                    {formatDate(activity.created_at)}
                                                </span>
                                            </div>
                                            {activity.description && (
                                                <p className="text-sm text-text-secondary mt-1">
                                                    {activity.description}
                                                </p>
                                            )}
                                            {activity.user_info && (
                                                <p className="text-xs text-text-tertiary mt-2">
                                                    by {activity.user_info.full_name}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}