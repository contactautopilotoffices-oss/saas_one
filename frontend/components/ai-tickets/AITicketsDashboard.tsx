"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { TicketStatusBadge } from '@/frontend/components/ai-tickets/TicketStatusBadge';
import { TicketDetailsModal } from '@/frontend/components/ai-tickets/TicketDetailsModal';
import FeedbackModal from '@/frontend/components/ui/FeedbackModal';
import { Bot, Search, RefreshCw, ChevronRight, Bug, Lightbulb, CheckCircle2, AlertCircle, Image as ImageIcon, Filter, Layers, Plus } from 'lucide-react';

export interface AITicketsDashboardProps {
  propertyId?: string;
}

export default function AITicketsDashboardView({ propertyId }: AITicketsDashboardProps = {}) {
  const params = useParams();
  const orgId = params?.orgId as string;
  const [tickets, setTickets] = useState<any[]>([]);
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'bug' | 'feature'>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const supabase = createClient();

  const fetchTickets = async () => {
    setLoading(true);
    try {
      // 1. Fetch tickets via API or Supabase client
      const endpoint = orgId ? `/api/feedback?org_id=${orgId}` : `/api/feedback`;
      const res = await fetch(endpoint);
      let data: any = {};
      if (res.ok) {
        data = await res.json().catch((err) => {
          console.warn('Feedback API JSON parse error:', err);
          return {};
        });
      }

      let ticketsList = data.data || [];
      if (!ticketsList || ticketsList.length === 0) {
        // Fallback to client query if API returns empty
        let query = supabase.from('feedback_tickets').select('*').order('created_at', { ascending: false });
        if (orgId) query = query.eq('organization_id', orgId);
        const { data: dbData } = await query;
        ticketsList = dbData || [];
      }

      setTickets(ticketsList);

      // 2. Fetch property names for display
      const { data: propData } = await supabase.from('properties').select('id, name');
      if (propData) {
        const pMap: Record<string, string> = {};
        propData.forEach((p: any) => { pMap[p.id] = p.name; });
        setProperties(pMap);
      }
    } catch (err) {
      console.error('Failed to fetch feedback tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();

    // Subscribe to realtime changes on feedback_tickets
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'feedback_tickets',
        },
        (payload) => {
          console.log('Realtime update received:', payload);
          fetchTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  // Property-scoped tickets base list
  const propertyScopedTickets = useMemo(() => {
    if (!propertyId || propertyId === 'all') return tickets;
    return tickets.filter(t => t.property_id === propertyId);
  }, [tickets, propertyId]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return propertyScopedTickets.filter(t => {
      const matchesSearch = !searchTerm || 
        (t.id && t.id.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (t.error_text && t.error_text.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (t.feature_description && t.feature_description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (t.submitted_by_name && t.submitted_by_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (t.property_id && properties[t.property_id] && properties[t.property_id].toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType = selectedType === 'all' || t.type === selectedType;
      const matchesStatus = selectedStatus === 'all' || t.status === selectedStatus;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [propertyScopedTickets, searchTerm, selectedType, selectedStatus, properties]);

  // KPI Metrics
  const stats = useMemo(() => {
    const total = propertyScopedTickets.length;
    const bugs = propertyScopedTickets.filter(t => t.type === 'bug').length;
    const features = propertyScopedTickets.filter(t => t.type === 'feature').length;
    const resolved = propertyScopedTickets.filter(t => ['approved', 'deployed'].includes(t.status)).length;
    return { total, bugs, features, resolved };
  }, [propertyScopedTickets]);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Bot className="w-5 h-5" />
            </div>
            Feedback & Issue Tracker
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Real-time user feedback, bug reports, and feature requests across all properties.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsFeedbackModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl transition-all text-sm font-bold shadow-md shadow-primary/20"
          >
            <Plus className="w-4 h-4" />
            Report Bug / Issue
          </button>
          <button 
            onClick={fetchTickets}
            className="p-2.5 text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-xl border border-border transition-all"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center justify-between text-text-secondary mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total Reports</span>
            <Layers className="w-4 h-4 text-text-tertiary" />
          </div>
          <p className="text-3xl font-black text-text-primary">{stats.total}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center justify-between text-rose-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Bugs Reported</span>
            <Bug className="w-4 h-4" />
          </div>
          <p className="text-3xl font-black text-rose-600">{stats.bugs}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center justify-between text-amber-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Feature Requests</span>
            <Lightbulb className="w-4 h-4" />
          </div>
          <p className="text-3xl font-black text-amber-500">{stats.features}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center justify-between text-emerald-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Resolved / Fixed</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-3xl font-black text-emerald-600">{stats.resolved}</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-border shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        
        {/* Search */}
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input 
            type="text"
            placeholder="Search report text, user, property..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface rounded-xl border border-border text-sm text-text-primary focus:outline-none focus:border-primary transition-all placeholder:text-text-tertiary"
          />
        </div>

        {/* Type & Status Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          
          {/* Type Toggle */}
          <div className="bg-surface p-1 rounded-xl border border-border flex items-center gap-1">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedType === 'all' ? 'bg-white text-text-primary shadow-xs' : 'text-text-secondary hover:text-text-primary'}`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedType('bug')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${selectedType === 'bug' ? 'bg-rose-50 text-rose-600 shadow-xs' : 'text-text-secondary hover:text-text-primary'}`}
            >
              <Bug className="w-3.5 h-3.5" />
              Bugs
            </button>
            <button
              onClick={() => setSelectedType('feature')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${selectedType === 'feature' ? 'bg-amber-50 text-amber-600 shadow-xs' : 'text-text-secondary hover:text-text-primary'}`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Features
            </button>
          </div>

          {/* Status Dropdown */}
          <div className="relative">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="appearance-none bg-surface border border-border text-text-primary text-xs font-bold py-2 pl-3 pr-8 rounded-xl focus:outline-none focus:border-primary"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending in Queue</option>
              <option value="approved">Approved / In Backlog</option>
              <option value="rejected">Rejected / Dropped</option>
              <option value="deployed">Deployed / Fixed</option>
            </select>
            <Filter className="w-3.5 h-3.5 text-text-tertiary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-tertiary text-sm font-medium">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
            Loading reports...
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="p-12 text-center text-text-tertiary text-sm font-medium">
            No feedback or bug reports found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface border-b border-border text-xs font-black text-text-tertiary uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Ticket ID</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Report & Category</th>
                  <th className="px-6 py-4">Submitted By & Property</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTickets.map((t) => {
                  const titleText = t.error_text || t.feature_description || 'No description provided';
                  const propName = t.property_id ? (properties[t.property_id] || 'Property') : 'Global';

                  return (
                    <tr 
                      key={t.id}
                      onClick={() => setSelectedTicket(t)}
                      className="hover:bg-surface-elevated/50 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-4 font-mono font-bold text-xs text-text-secondary">
                        #{t.id ? t.id.slice(0, 8) : '---'}
                      </td>
                      <td className="px-6 py-4">
                        {t.type === 'bug' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-600 border border-rose-100">
                            <Bug className="w-3 h-3" />
                            Bug
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-600 border border-amber-100">
                            <Lightbulb className="w-3 h-3" />
                            Feature
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-md">
                        <p className="font-bold text-text-primary truncate">{titleText}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-bold text-text-tertiary uppercase bg-surface px-1.5 py-0.5 rounded border border-border">
                            {t.category || 'General'}
                          </span>
                          {t.priority && (
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              t.priority === 'high' ? 'bg-rose-100 text-rose-700' :
                              t.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {t.priority}
                            </span>
                          )}
                          {t.screenshot_url && (
                            <span className="text-[10px] text-primary flex items-center gap-1 font-bold">
                              <ImageIcon className="w-3 h-3" /> 1
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-text-primary text-xs">{t.submitted_by_name || 'Anonymous'}</p>
                        <p className="text-[11px] text-text-tertiary truncate">Role: {t.submitted_by_role || propName}</p>
                      </td>
                      <td className="px-6 py-4">
                        <TicketStatusBadge status={t.status || 'pending'} />
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-text-tertiary whitespace-nowrap">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '---'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary group-hover:text-primary group-hover:bg-surface-elevated transition-all ml-auto">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ticket Details Modal */}
      {selectedTicket && (
        <TicketDetailsModal 
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      )}

      {/* Bug / Issue Submit Modal */}
      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={() => {
          setIsFeedbackModalOpen(false);
          fetchTickets();
        }}
      />

    </div>
  );
}
