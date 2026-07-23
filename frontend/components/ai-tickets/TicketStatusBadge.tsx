"use client";

import React from 'react';
import { Clock, Cpu, CheckCircle, XCircle, Github, AlertTriangle, PlayCircle } from 'lucide-react';

interface TicketStatusBadgeProps {
  status: string;
}

export function TicketStatusBadge({ status }: TicketStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return { color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', icon: Clock, label: 'Pending in Queue', pulse: false };
      case 'analyzing':
        return { color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', icon: Cpu, label: 'AI Analyzing', pulse: true };
      case 'planning':
      case 'coding':
        return { color: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20', icon: PlayCircle, label: 'AI Coding', pulse: true };
      case 'validating':
      case 'fixing_errors':
        return { color: 'bg-purple-500/10 text-purple-500 border-purple-500/20', icon: AlertTriangle, label: 'Validating Fix', pulse: true };
      case 'pr_created':
        return { color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', icon: Github, label: 'PR Created', pulse: false };
      case 'approved':
      case 'deployed':
        return { color: 'bg-green-500/10 text-green-500 border-green-500/20', icon: CheckCircle, label: 'Deployed', pulse: false };
      case 'failed':
      case 'rejected':
        return { color: 'bg-red-500/10 text-red-500 border-red-500/20', icon: XCircle, label: 'Failed', pulse: false };
      default:
        return { color: 'bg-slate-500/10 text-slate-500 border-slate-500/20', icon: Clock, label: status, pulse: false };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      {config.pulse ? (
        <span className="relative flex h-3 w-3">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.color.split(' ')[1].replace('text-', 'bg-')}`}></span>
          <span className={`relative inline-flex rounded-full h-3 w-3 ${config.color.split(' ')[1].replace('text-', 'bg-')}`}></span>
        </span>
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      {config.label}
    </div>
  );
}
