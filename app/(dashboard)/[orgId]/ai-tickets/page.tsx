"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { TicketStatusBadge } from '@/frontend/components/ai-tickets/TicketStatusBadge';
import { TicketDetailsModal } from '@/frontend/components/ai-tickets/TicketDetailsModal';
import FeedbackModal from '@/frontend/components/ui/FeedbackModal';
import { Bot, Search, RefreshCw, ChevronRight, Bug, Lightbulb, CheckCircle2, AlertCircle, Image as ImageIcon, Filter, Layers, Plus } from 'lucide-react';

export default function AITicketsDashboard() {
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

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
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
  }, [tickets, searchTerm, selectedType, selectedStatus, properties]);

  // KPI Metrics
  const stats = useMemo(() => {
    const total = tickets.length;
    const bugs = tickets.filter(t => t.type === 'bug').length;
    const features = tickets.filter(t => t.type === 'feature').length;
    const resolved = tickets.filter(t => ['approved', 'deployed'].includes(t.status)).length;
    return { total, bugs, features, resolved };
  }, [tickets]);

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
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-elevated text-text-primary rounded-xl transition-all border border-border text-sm font-semibold shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 text-primary ${loading ? 'animate-spin' : ''}`} />
            Refresh Live
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 bg-surface border border-border rounded-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Total Reports</span>
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-black text-text-primary mt-2">{stats.total}</p>
        </div>

        <div className="p-5 bg-surface border border-border rounded-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-500 uppercase tracking-wider">Bugs Reported</span>
            <Bug className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-black text-rose-500 mt-2">{stats.bugs}</p>
        </div>

        <div className="p-5 bg-surface border border-border rounded-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">Feature Requests</span>
            <Lightbulb className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-500 mt-2">{stats.features}</p>
        </div>

        <div className="p-5 bg-surface border border-border rounded-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Resolved / Fixed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-500 mt-2">{stats.resolved}</p>
        </div>
      </div>

      {/* Controls & Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-surface border border-border p-4 rounded-2xl shadow-sm">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search report text, user, property..."
            className="w-full bg-black/5 dark:bg-white/5 border border-border rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Type Filter */}
        <div className="flex p-1 bg-black/5 dark:bg-white/5 rounded-xl border border-border shrink-0">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === 'all' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setSelectedType('bug')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
              selectedType === 'bug' ? 'bg-rose-500 text-white shadow-sm' : 'text-text-secondary'
            }`}
          >
            <Bug className="w-3 h-3" /> Bugs
          </button>
          <button
            onClick={() => setSelectedType('feature')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
              selectedType === 'feature' ? 'bg-amber-500 text-white shadow-sm' : 'text-text-secondary'
            }`}
          >
            <Lightbulb className="w-3 h-3" /> Features
          </button>
        </div>

        {/* Status Dropdown */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="bg-black/5 dark:bg-white/5 border border-border rounded-xl px-3 py-2 text-xs font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 shrink-0"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="analyzing">Analyzing</option>
          <option value="coding">Coding</option>
          <option value="approved">Approved</option>
          <option value="deployed">Deployed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/5 dark:bg-white/5 border-b border-border">
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Ticket ID</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Type</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Report & Category</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Submitted By & Property</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Status</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider">Date</th>
                <th className="px-6 py-3.5 text-xs font-bold text-text-secondary uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && tickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-text-tertiary">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                      <span className="text-sm font-medium">Loading feedback reports...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-text-tertiary">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertCircle className="w-8 h-8 opacity-40" />
                      <span className="text-sm font-medium">No feedback or issue reports found matching your criteria.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => (
                  <tr 
                    key={ticket.id} 
                    onClick={() => setSelectedTicket(ticket)}
                    className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-xs font-mono font-bold text-text-secondary bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md border border-border">
                        #{ticket.id.substring(0, 8)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold capitalize border ${
                        ticket.type === 'bug' 
                          ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' 
                          : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      }`}>
                        {ticket.type === 'bug' ? <Bug className="w-3 h-3" /> : <Lightbulb className="w-3 h-3" />}
                        {ticket.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-text-primary max-w-sm line-clamp-1">
                            {ticket.error_text || ticket.feature_description}
                          </div>
                          <div className="text-xs text-text-tertiary mt-0.5 flex items-center gap-2">
                            <span className="capitalize font-medium text-primary">
                              {ticket.error_category || ticket.target_module || 'General'}
                            </span>
                            {(ticket.severity || ticket.priority) && (
                              <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-border font-bold">
                                {ticket.severity || ticket.priority}
                              </span>
                            )}
                          </div>
                        </div>
                        {ticket.attachments && ticket.attachments.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
                            <ImageIcon className="w-3 h-3" /> {ticket.attachments.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-text-primary">
                        {ticket.submitted_by_name || 'Anonymous User'}
                      </div>
                      <div className="text-xs text-text-secondary font-normal">
                        {ticket.property_id && properties[ticket.property_id] 
                          ? properties[ticket.property_id] 
                          : (ticket.submitted_by_role ? `Role: ${ticket.submitted_by_role}` : 'All Properties')
                        }
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-text-secondary font-mono">
                      {new Date(ticket.created_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button className="p-1.5 rounded-lg text-text-tertiary group-hover:text-primary group-hover:bg-primary/10 transition-all ml-auto">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {selectedTicket && (
        <TicketDetailsModal 
          ticket={selectedTicket} 
          onClose={() => setSelectedTicket(null)} 
        />
      )}

      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
      />

    </div>
  );
}
