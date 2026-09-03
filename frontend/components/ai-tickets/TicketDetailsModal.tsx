"use client";

import React, { useState } from 'react';
import { X, ExternalLink, Code2, AlertTriangle, MessageSquare, Cpu, Github, Maximize2, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { TicketStatusBadge } from './TicketStatusBadge';
import { SLABreachDetailsCard } from '@/frontend/components/tickets/SLABreachDetailsCard';

interface TicketDetailsModalProps {
  ticket: any;
  onClose: () => void;
  onStatusUpdate?: () => void;
}

export function TicketDetailsModal({ ticket, onClose, onStatusUpdate }: TicketDetailsModalProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusState, setStatusState] = useState(ticket?.status || 'pending');

  if (!ticket) return null;

  const handleUpdateStatus = async (newStatus: string) => {
    setIsUpdating(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticket.id, status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update ticket status');
      }

      setStatusState(newStatus);
      if (onStatusUpdate) {
        onStatusUpdate();
      }
    } catch (err: any) {
      console.error('Failed to acknowledge ticket:', err);
      alert(err.message || 'Failed to update status');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className="relative w-full max-w-2xl bg-background border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border bg-muted/40">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-lg font-bold text-foreground">
                  Ticket #{ticket.id.substring(0, 8)}
                </h2>
                <TicketStatusBadge status={statusState} />
              </div>
              <p className="text-xs font-medium text-text-secondary">
                Submitted by <span className="font-semibold text-text-primary">{ticket.submitted_by_name || 'Anonymous'}</span> • {new Date(ticket.created_at).toLocaleString()}
              </p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-xl text-text-secondary hover:text-text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
            
            {/* User Report */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Original Report
              </h3>
              <div className="p-4 bg-surface rounded-xl border border-border text-sm text-foreground space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <span className="text-text-secondary text-xs font-bold uppercase tracking-wider min-w-[90px]">Category:</span>
                  <span className="font-bold text-text-primary capitalize bg-primary/10 text-primary px-2.5 py-0.5 rounded-full text-xs inline-block w-fit">
                    {ticket.error_category || ticket.target_module || ticket.type}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-text-secondary text-xs font-bold uppercase tracking-wider">Description:</span>
                  <p className="text-text-primary font-medium leading-relaxed whitespace-pre-wrap bg-muted/30 p-3 rounded-lg border border-border/50 text-sm">
                    {ticket.error_text || ticket.feature_description || 'No description provided.'}
                  </p>
                </div>

                {ticket.attachments && ticket.attachments.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
                      Attached Screenshots ({ticket.attachments.length})
                    </p>
                    <div className="flex gap-3 flex-wrap">
                      {ticket.attachments.map((url: string, idx: number) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPreviewImage(url)}
                          className="group relative w-24 h-24 rounded-xl overflow-hidden border border-border hover:border-primary transition-all shadow-sm bg-black/5 dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <img 
                            src={url} 
                            alt={`Screenshot ${idx + 1}`} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity text-white text-xs font-bold gap-1 backdrop-blur-[2px]">
                            <Maximize2 className="w-4 h-4" />
                            Preview
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI Analysis (If available) */}
            {ticket.ai_analysis && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-500" />
                  AI Analysis & Resolution Plan
                </h3>
                <div className="p-4 bg-purple-500/5 dark:bg-purple-950/20 rounded-xl border border-purple-500/20 text-sm text-foreground space-y-3">
                  <p className="whitespace-pre-wrap font-medium leading-relaxed">
                    {ticket.ai_analysis.explanation}
                  </p>
                  
                  {ticket.ai_analysis.filesChanged && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Modified Code Files</p>
                      {ticket.ai_analysis.filesChanged.map((file: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-xs font-mono text-text-primary bg-muted p-2.5 rounded-lg border border-border">
                          <Code2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="truncate">{file.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* GitHub PR */}
            {ticket.github_pr_url && (
              <div className="pt-2">
                <a 
                  href={ticket.github_pr_url} 
                  target="_blank" 
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 bg-muted hover:bg-primary hover:text-white text-text-primary rounded-xl transition-colors font-bold border border-border"
                >
                  <Github className="w-5 h-5" />
                  View Pull Request on GitHub
                  <ExternalLink className="w-4 h-4 ml-1 opacity-60" />
                </a>
              </div>
            )}
            
            {/* SLA Breach Breakdown */}
            {ticket.sla_deadline && (
              <SLABreachDetailsCard ticket={ticket} />
            )}

            {/* Failure Reason */}
            {ticket.failure_reason && (
              <div className="p-4 bg-rose-500/10 rounded-xl border border-rose-500/20 text-sm text-rose-600 dark:text-rose-400 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
                <div>
                  <p className="font-bold text-rose-600 dark:text-rose-400 mb-1">Processing Error</p>
                  <p className="font-medium text-xs">{ticket.failure_reason}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-border bg-muted/40 flex items-center justify-between gap-3">
            <div className="text-xs text-text-secondary font-medium">
              Status: <span className="font-bold text-text-primary uppercase">{statusState}</span>
            </div>

            <div className="flex items-center gap-2">
              {['pending', 'analyzing', 'planning'].includes(statusState) ? (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('deployed')}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
                >
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Acknowledge (Mark as Solved)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('pending')}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-text-primary hover:bg-slate-300 rounded-xl font-bold text-xs transition-all disabled:opacity-50"
                >
                  {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Re-open Ticket
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-surface hover:bg-muted text-text-primary border border-border rounded-xl font-bold text-xs transition-all"
              >
                Close
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Fullscreen Image Preview Lightbox Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all z-10 focus:outline-none"
            title="Close Preview"
          >
            <X className="w-6 h-6" />
          </button>
          
          <div 
            className="relative max-w-5xl max-h-[90vh] overflow-hidden flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage}
              alt="Screenshot Full Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-white/10"
            />
          </div>
        </div>
      )}
    </>
  );
}
