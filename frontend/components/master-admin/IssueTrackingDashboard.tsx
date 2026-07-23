'use client';

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, AlertCircle, CheckCircle, Clock, Filter,
  Search, RefreshCw, X, ChevronDown, Eye, MessageSquare,
  Bug, Zap, Database, Monitor, Smartphone, Activity
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';

interface IssueLog {
  id: string;
  category: string;
  severity: string;
  source: string;
  error_message: string;
  stack_trace?: string;
  page_url?: string;
  page_route?: string;
  component_name?: string;
  browser?: string;
  os?: string;
  device?: string;
  occurrence_count: number;
  status: string;
  resolution_notes?: string;
  occurred_at: string;
  first_seen_at: string;
  last_seen_at: string;
  user?: { full_name: string; email: string };
  property?: { name: string; code: string };
  organization?: { name: string };
  assignee?: { full_name: string; email: string };
}

interface Summary {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  critical: number;
  high: number;
}

const categoryIcons: Record<string, React.ReactNode> = {
  ui_error: <Monitor className="w-4 h-4" />,
  api_error: <Zap className="w-4 h-4" />,
  db_error: <Database className="w-4 h-4" />,
  performance: <Activity className="w-4 h-4" />,
  ux_friction: <Smartphone className="w-4 h-4" />,
  user_feedback: <MessageSquare className="w-4 h-4" />,
};

const categoryColors: Record<string, string> = {
  ui_error: 'bg-red-100 text-red-700 border-red-200',
  api_error: 'bg-orange-100 text-orange-700 border-orange-200',
  db_error: 'bg-purple-100 text-purple-700 border-purple-200',
  performance: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  ux_friction: 'bg-blue-100 text-blue-700 border-blue-200',
  user_feedback: 'bg-green-100 text-green-700 border-green-200',
};

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500', text: 'text-red-500', border: 'border-red-500' },
  high: { bg: 'bg-orange-500', text: 'text-orange-500', border: 'border-orange-500' },
  medium: { bg: 'bg-yellow-500', text: 'text-yellow-500', border: 'border-yellow-500' },
  low: { bg: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500' },
};

export default function IssueTrackingDashboard() {
  const [issues, setIssues] = useState<IssueLog[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<IssueLog | null>(null);
  const [filter, setFilter] = useState({
    status: 'all',
    category: 'all',
    severity: 'all',
    period: 'all',
  });
  const [searchQuery, setSearchQuery] = useState('');

  const supabase = createClient();

  const fetchIssues = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.status !== 'all') params.set('status', filter.status);
      if (filter.category !== 'all') params.set('category', filter.category);
      if (filter.severity !== 'all') params.set('severity', filter.severity);
      if (filter.period !== 'all') params.set('period', filter.period);
      params.set('limit', '100');

      const res = await fetch(`/api/internal/issue-logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
        setSummary(data.summary || null);
      } else if (res.status === 401) {
        console.error('Unauthorized - not a master admin');
        setIssues([]);
      } else {
        const errorData = await res.json();
        console.error('Failed to fetch issues:', errorData);
        setIssues([]);
      }
    } catch (error) {
      console.error('Failed to fetch issues:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchIssues();
  }, [filter]);

  const updateIssueStatus = async (issueId: string, status: string, notes?: string) => {
    try {
      const res = await fetch(`/api/internal/issue-logs/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution_notes: notes }),
      });

      if (res.ok) {
        fetchIssues();
        setSelectedIssue(null);
      }
    } catch (error) {
      console.error('Failed to update issue:', error);
    }
  };

  const filteredIssues = issues.filter(issue =>
    !searchQuery ||
    issue.error_message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    issue.page_route?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    issue.user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Issue Tracking</h1>
          <p className="text-sm text-gray-500">Monitor and resolve system issues automatically</p>
        </div>
        <button
          onClick={fetchIssues}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <SummaryCard
            label="Total Issues"
            value={summary.total}
            icon={<Bug className="w-5 h-5" />}
            color="blue"
          />
          <SummaryCard
            label="Critical"
            value={summary.critical}
            icon={<AlertCircle className="w-5 h-5" />}
            color="red"
            highlight={summary.critical > 0}
          />
          <SummaryCard
            label="High"
            value={summary.high}
            icon={<AlertTriangle className="w-5 h-5" />}
            color="orange"
          />
          <SummaryCard
            label="UI Errors"
            value={summary.byCategory.ui_error || 0}
            icon={<Monitor className="w-5 h-5" />}
            color="red"
          />
          <SummaryCard
            label="API Errors"
            value={summary.byCategory.api_error || 0}
            icon={<Zap className="w-5 h-5" />}
            color="orange"
          />
          <SummaryCard
            label="DB Errors"
            value={summary.byCategory.db_error || 0}
            icon={<Database className="w-5 h-5" />}
            color="purple"
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search issues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <FilterSelect
            label="Status"
            value={filter.status}
            onChange={(v) => setFilter(f => ({ ...f, status: v }))}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'open', label: 'Open' },
              { value: 'investigating', label: 'Investigating' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'ignored', label: 'Ignored' },
            ]}
          />

          {/* Category Filter */}
          <FilterSelect
            label="Category"
            value={filter.category}
            onChange={(v) => setFilter(f => ({ ...f, category: v }))}
            options={[
              { value: 'all', label: 'All Categories' },
              { value: 'ui_error', label: 'UI Error' },
              { value: 'api_error', label: 'API Error' },
              { value: 'db_error', label: 'DB Error' },
              { value: 'performance', label: 'Performance' },
              { value: 'ux_friction', label: 'UX Friction' },
              { value: 'user_feedback', label: 'User Feedback' },
            ]}
          />

          {/* Severity Filter */}
          <FilterSelect
            label="Severity"
            value={filter.severity}
            onChange={(v) => setFilter(f => ({ ...f, severity: v }))}
            options={[
              { value: 'all', label: 'All Severity' },
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />

          {/* Period Filter */}
          <FilterSelect
            label="Period"
            value={filter.period}
            onChange={(v) => setFilter(f => ({ ...f, period: v }))}
            options={[
              { value: 'all', label: 'All Time' },
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This Week' },
              { value: 'month', label: 'This Month' },
            ]}
          />
        </div>
      </div>

      {/* Issues List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-8 text-center">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400" />
              <p className="mt-2 text-gray-500">Loading issues...</p>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle className="w-12 h-12 mx-auto text-green-400" />
              <p className="mt-2 text-gray-900 font-medium">No issues found</p>
              <p className="text-sm text-gray-500">
                {filter.status !== 'all' || filter.category !== 'all' || filter.severity !== 'all'
                  ? 'Try adjusting your filters'
                  : 'All systems are running smoothly'}
              </p>
            </div>
          ) : (
            filteredIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onClick={() => setSelectedIssue(issue)}
              />
            ))
          )}
        </div>
      </div>

      {/* Issue Detail Modal */}
      <AnimatePresence>
        {selectedIssue && (
          <IssueDetailModal
            issue={selectedIssue}
            onClose={() => setSelectedIssue(null)}
            onUpdateStatus={updateIssueStatus}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Summary Card Component
function SummaryCard({
  label,
  value,
  icon,
  color,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  highlight?: boolean;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  };

  return (
    <div
      className={`p-4 rounded-xl border ${colorClasses[color]} ${
        highlight ? 'ring-2 ring-red-500 ring-offset-2' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

// Filter Select Component
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Issue Row Component
function IssueRow({ issue, onClick }: { issue: IssueLog; onClick: () => void }) {
  const timeAgo = getTimeAgo(issue.occurred_at);

  return (
    <div
      className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Severity Indicator */}
        <div className={`w-2 h-2 rounded-full mt-2 ${
          severityColors[issue.severity]?.bg || 'bg-gray-400'
        }`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Category Badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
              categoryColors[issue.category] || 'bg-gray-100 text-gray-700 border-gray-200'
            }`}>
              {categoryIcons[issue.category]}
              {issue.category.replace('_', ' ')}
            </span>

            {/* Severity Badge */}
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
              severityColors[issue.severity]?.bg || 'bg-gray-400'
            } text-white`}>
              {issue.severity}
            </span>

            {/* Occurrence Count */}
            {issue.occurrence_count > 1 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                x{issue.occurrence_count}
              </span>
            )}
          </div>

          <p className="text-sm font-medium text-gray-900 truncate">{issue.error_message}</p>

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            {issue.page_route && (
              <span className="truncate">{issue.page_route}</span>
            )}
            {issue.user && (
              <span>{issue.user.full_name}</span>
            )}
            {issue.property && (
              <span>{issue.property.name}</span>
            )}
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            issue.status === 'open' ? 'bg-red-100 text-red-700' :
            issue.status === 'investigating' ? 'bg-yellow-100 text-yellow-700' :
            issue.status === 'resolved' ? 'bg-green-100 text-green-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {issue.status}
          </span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    </div>
  );
}

// Issue Detail Modal
function IssueDetailModal({
  issue,
  onClose,
  onUpdateStatus,
}: {
  issue: IssueLog;
  onClose: () => void;
  onUpdateStatus: (id: string, status: string, notes?: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [showActions, setShowActions] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                severityColors[issue.severity]?.bg || 'bg-gray-400'
              }`} />
              <h2 className="text-lg font-bold text-gray-900">Issue Details</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
          {/* Error Message */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Error Message
            </label>
            <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-3 rounded-lg">
              {issue.error_message}
            </p>
          </div>

          {/* Stack Trace */}
          {issue.stack_trace && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Stack Trace
              </label>
              <pre className="mt-1 text-xs text-red-600 bg-red-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono">
                {issue.stack_trace}
              </pre>
            </div>
          )}

          {/* Context Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Category
              </label>
              <p className="mt-1 text-sm text-gray-900 capitalize">
                {issue.category.replace('_', ' ')}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Severity
              </label>
              <p className="mt-1 text-sm text-gray-900 capitalize font-bold">
                {issue.severity}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Page
              </label>
              <p className="mt-1 text-sm text-gray-900">
                {issue.page_route || 'N/A'}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Component
              </label>
              <p className="mt-1 text-sm text-gray-900">
                {issue.component_name || 'N/A'}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Browser
              </label>
              <p className="mt-1 text-sm text-gray-900">
                {issue.browser || 'N/A'} / {issue.os || 'N/A'}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Occurrences
              </label>
              <p className="mt-1 text-sm text-gray-900">
                {issue.occurrence_count} time(s)
              </p>
            </div>
          </div>

          {/* User & Property Info */}
          {issue.user && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  User
                </label>
                <p className="mt-1 text-sm text-gray-900">
                  {issue.user.full_name}
                </p>
                <p className="text-xs text-gray-500">{issue.user.email}</p>
              </div>
              {issue.property && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Property
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {issue.property.name}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Resolution Notes */}
          {issue.resolution_notes && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Resolution Notes
              </label>
              <p className="mt-1 text-sm text-gray-900 bg-green-50 p-3 rounded-lg">
                {issue.resolution_notes}
              </p>
            </div>
          )}

          {/* Resolution Form */}
          {showActions && issue.status !== 'resolved' && (
            <div className="border-t border-gray-200 pt-6">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Add Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe how this was resolved..."
                className="w-full mt-2 p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="flex gap-2">
            {issue.status === 'open' && (
              <button
                onClick={() => {
                  onUpdateStatus(issue.id, 'investigating', notes);
                  setShowActions(false);
                }}
                className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
              >
                Investigating
              </button>
            )}
            <button
              onClick={() => {
                onUpdateStatus(issue.id, 'resolved', notes);
                setShowActions(false);
              }}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              Mark Resolved
            </button>
            {issue.status !== 'ignored' && (
              <button
                onClick={() => {
                  onUpdateStatus(issue.id, 'ignored', notes);
                  setShowActions(false);
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                Ignore
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Helper function
function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
