"use client";

import React, { useEffect, useState } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import { TicketStatusBadge } from '@/frontend/components/ai-tickets/TicketStatusBadge';
import { TicketDetailsModal } from '@/frontend/components/ai-tickets/TicketDetailsModal';
import { Bot, Search, RefreshCw, ChevronRight } from 'lucide-react';

export default function AITicketsDashboard() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const supabase = createClient();

  const fetchTickets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('feedback_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setTickets(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTickets();

    // Subscribe to realtime changes
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
          fetchTickets(); // Refresh the list to get new AI status
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Bot className="w-6 h-6 text-indigo-500" />
            AI Automation Tracker
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Watch the AI Orchestrator process bug reports and generate code in real-time.
          </p>
        </div>
        <button 
          onClick={fetchTickets}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-800">
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Ticket ID</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Report</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Created At</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading && tickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin mb-2" />
                      Loading tickets...
                    </div>
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No AI tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr 
                    key={ticket.id} 
                    onClick={() => setSelectedTicket(ticket)}
                    className="hover:bg-slate-800/50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-mono text-slate-400">{ticket.id.substring(0, 8)}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium capitalize ${ticket.type === 'bug' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>
                        {ticket.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-text-primary max-w-xs truncate">
                        {ticket.error_text || ticket.feature_description}
                      </div>
                      <div className="text-xs text-text-secondary mt-1">
                        {ticket.error_category}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-text-secondary">
                        {new Date(ticket.created_at).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-primary transition-colors ml-auto" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {selectedTicket && (
        <TicketDetailsModal 
          ticket={selectedTicket} 
          onClose={() => setSelectedTicket(null)} 
        />
      )}

    </div>
  );
}
