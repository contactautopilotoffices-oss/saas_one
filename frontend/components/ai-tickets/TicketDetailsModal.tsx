"use client";

import React from 'react';
import { X, ExternalLink, Code2, AlertTriangle, MessageSquare, Cpu, Github } from 'lucide-react';
import { TicketStatusBadge } from './TicketStatusBadge';

interface TicketDetailsModalProps {
  ticket: any;
  onClose: () => void;
}

export function TicketDetailsModal({ ticket, onClose }: TicketDetailsModalProps) {
  if (!ticket) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-surface border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-800 bg-slate-900/50">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold text-text-primary">
                Ticket {ticket.id.substring(0, 8)}
              </h2>
              <TicketStatusBadge status={ticket.status} />
            </div>
            <p className="text-sm text-text-secondary">
              Submitted by {ticket.submitted_by_name || 'Anonymous'} • {new Date(ticket.created_at).toLocaleString()}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* User Report */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Original Report
            </h3>
            <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-800 text-sm text-text-primary">
              <p><span className="text-slate-500 mr-2">Category:</span> {ticket.error_category || ticket.type}</p>
              <p className="mt-2"><span className="text-slate-500 mr-2">Description:</span> {ticket.error_text || ticket.feature_description}</p>
              {ticket.error_page_url && (
                <p className="mt-2"><span className="text-slate-500 mr-2">Page URL:</span> <a href={ticket.error_page_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ticket.error_page_url}</a></p>
              )}
            </div>
          </div>

          {/* AI Analysis (If available) */}
          {ticket.ai_analysis && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-400" />
                AI Analysis & Fix
              </h3>
              <div className="p-4 bg-purple-900/10 rounded-xl border border-purple-500/20 text-sm text-text-primary">
                <p className="whitespace-pre-wrap">{ticket.ai_analysis.explanation}</p>
                
                {ticket.ai_analysis.filesChanged && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Modified Files</p>
                    {ticket.ai_analysis.filesChanged.map((file: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-xs font-mono text-slate-300 bg-slate-900 p-2 rounded-md border border-slate-800">
                        <Code2 className="w-3 h-3 text-emerald-400" />
                        {file.path}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GitHub PR */}
          {ticket.github_pr_url && (
            <div className="pt-4 border-t border-slate-800">
              <a 
                href={ticket.github_pr_url} 
                target="_blank" 
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors font-medium border border-slate-700"
              >
                <Github className="w-5 h-5" />
                View Pull Request on GitHub
                <ExternalLink className="w-4 h-4 ml-1 opacity-50" />
              </a>
            </div>
          )}
          
          {/* Failure Reason */}
          {ticket.failure_reason && (
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/20 text-sm text-red-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-medium text-red-300 mb-1">Processing Failed</p>
                <p>{ticket.failure_reason}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
