'use client';

import { useState, useEffect } from 'react';
import {
    Loader2,
    Check,
    AlertCircle,
    Building2,
    MapPin,
    User,
    Image as ImageIcon,
    Save,
    Sparkles,
    Search,
    ExternalLink,
    RefreshCw,
    ToggleLeft,
    ToggleRight,
    PhoneCall,
    ShieldCheck,
    Send,
    Clock,
    CheckCircle2,
    MessageSquare,
    Radio,
    ArrowRight,
    UploadCloud,
} from 'lucide-react';

interface CampaignConfig {
    campaign: string;
    city: string;
    outreach_enabled: boolean;
    property_name: string;
    property_photo_url: string;
    assigned_user_id: string | null;
    assigned_advisor_name: string | null;
    is_pilot: boolean;
}

interface OrgMember {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    role?: string;
}

interface LeadOutreachConfigManagerProps {
    orgId: string;
}

const PRESET_CENTRE_PHOTOS = [
    { label: 'Bangalore (Purva Gainz)', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80' },
    { label: 'Mumbai (Marathon Futurex)', url: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80' },
    { label: 'Mumbai (Kanakia Wall Street)', url: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80' },
    { label: 'Noida (Skymark One)', url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80' },
    { label: 'Pune (World Trade Centre)', url: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80' },
];

export default function LeadOutreachConfigManager({ orgId }: LeadOutreachConfigManagerProps) {
    const [campaigns, setCampaigns] = useState<CampaignConfig[]>([]);
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingCamp, setSavingCamp] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Live Test Simulator State (Testing on 7028232515)
    const [testPhone, setTestPhone] = useState('7028232515');
    const [testName, setTestName] = useState('Test Client');
    const [testCampaign, setTestCampaign] = useState('Test Campaign');
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [testMonitorData, setTestMonitorData] = useState<any>(null);
    const [isPollingMonitor, setIsPollingMonitor] = useState(false);
    const [isRefreshingMonitor, setIsRefreshingMonitor] = useState(false);
    const [uploadingPhotoCamp, setUploadingPhotoCamp] = useState<string | null>(null);
    const [nudgeSettings, setNudgeSettings] = useState<{
        nudge_enabled: boolean;
        nudge_delay_hours: number;
        nudge_template_name: string;
    }>({
        nudge_enabled: true,
        nudge_delay_hours: 4,
        nudge_template_name: 'autopilot_lead_nudge_v1',
    });
    const [isSavingNudge, setIsSavingNudge] = useState(false);

    const handleSaveNudge = async (updates: Partial<typeof nudgeSettings>) => {
        setIsSavingNudge(true);
        const next = { ...nudgeSettings, ...updates };
        setNudgeSettings(next);
        try {
            const res = await fetch('/api/crm/outreach/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    update_nudge_settings: true,
                    ...next,
                }),
            });
            if (res.ok) {
                showToast(`Saved follow-up nudge timing: ${next.nudge_delay_hours}h delay (${next.nudge_enabled ? 'Active' : 'Paused'})`);
            } else {
                setErrorMessage('Failed to update nudge settings.');
            }
        } catch {
            setErrorMessage('Network error updating nudge settings.');
        } finally {
            setIsSavingNudge(false);
        }
    };

    const handlePhotoUpload = async (campaign: string, file: File) => {
        setUploadingPhotoCamp(campaign);
        setErrorMessage(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('campaign', campaign);
            formData.append('organization_id', orgId);

            const res = await fetch('/api/crm/outreach/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (res.ok && data.url) {
                updateLocalField(campaign, 'property_photo_url', data.url);
                showToast(`📸 Photo uploaded & saved to database for ${campaign}!`);
            } else {
                setErrorMessage(data.error || 'Failed to upload photo.');
            }
        } catch (err: any) {
            setErrorMessage(err.message || 'Error uploading photo.');
        } finally {
            setUploadingPhotoCamp(null);
        }
    };

    useEffect(() => {
        fetchConfigs();
        // Also check if there's any existing test run for 7028232515
        fetchTestMonitor('7028232515');
    }, [orgId]);

    // Auto-poll monitor every 3.5s while active
    useEffect(() => {
        if (!isPollingMonitor) return;
        const interval = setInterval(() => {
            fetchTestMonitor(testPhone);
        }, 3500);
        return () => clearInterval(interval);
    }, [isPollingMonitor, testPhone, orgId]);

    const handleSendTestMessage = async () => {
        setIsSendingTest(true);
        setErrorMessage(null);
        try {
            const matchedCamp = campaigns.find(c => c.campaign.toLowerCase() === testCampaign.toLowerCase());
            const res = await fetch('/api/crm/outreach/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    phone: testPhone,
                    name: testName,
                    campaign: testCampaign,
                    city: matchedCamp?.city || 'Bangalore',
                }),
            });
            const data = await res.json();
            if (res.ok) {
                showToast(`🚀 Test Message 1 sent to ${testPhone}! Tap a button on WhatsApp to test response.`);
                setIsPollingMonitor(true);
                fetchTestMonitor(testPhone);
            } else {
                setErrorMessage(data.error || 'Failed to dispatch test outreach message.');
            }
        } catch (err: any) {
            setErrorMessage(err.message || 'Network error sending test outreach message.');
        } finally {
            setIsSendingTest(false);
        }
    };

    const fetchTestMonitor = async (phone: string, showSpinner = false) => {
        if (showSpinner) setIsRefreshingMonitor(true);
        try {
            const res = await fetch(`/api/crm/outreach/test?phone=${encodeURIComponent(phone)}&organization_id=${orgId}`);
            if (res.ok) {
                const data = await res.json();
                setTestMonitorData(data);
            }
        } catch {}
        finally {
            if (showSpinner) setIsRefreshingMonitor(false);
        }
    };

    const fetchConfigs = async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            const res = await fetch(`/api/crm/outreach/campaigns?organization_id=${orgId}`);
            if (res.ok) {
                const data = await res.json();
                setCampaigns(data.campaigns || []);
                setMembers(data.members || []);
                if (data.nudgeSettings) {
                    setNudgeSettings(data.nudgeSettings);
                }
            } else {
                setErrorMessage('Failed to load campaign outreach configurations.');
            }
        } catch (err: any) {
            setErrorMessage(err.message || 'Network error fetching outreach settings.');
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (campaign: CampaignConfig) => {
        const nextState = !campaign.outreach_enabled;
        // Optimistic update
        setCampaigns((prev) =>
            prev.map((c) => (c.campaign === campaign.campaign ? { ...c, outreach_enabled: nextState } : c))
        );

        setSavingCamp(campaign.campaign);
        try {
            const res = await fetch('/api/crm/outreach/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    campaign: campaign.campaign,
                    outreach_enabled: nextState,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.campaign) {
                    setCampaigns((prev) =>
                        prev.map((c) => (c.campaign === campaign.campaign ? { ...c, ...data.campaign } : c))
                    );
                }
                showToast(`Outreach ${nextState ? 'enabled' : 'paused'} for ${campaign.campaign}`);
            } else {
                // Revert on error
                setCampaigns((prev) =>
                    prev.map((c) => (c.campaign === campaign.campaign ? { ...c, outreach_enabled: !nextState } : c))
                );
                setErrorMessage('Failed to update campaign status.');
            }
        } catch {
            setCampaigns((prev) =>
                prev.map((c) => (c.campaign === campaign.campaign ? { ...c, outreach_enabled: !nextState } : c))
            );
            setErrorMessage('Network error toggling campaign outreach.');
        } finally {
            setSavingCamp(null);
        }
    };

    const handleSaveDetails = async (campaign: CampaignConfig) => {
        setSavingCamp(campaign.campaign);
        try {
            const res = await fetch('/api/crm/outreach/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    campaign: campaign.campaign,
                    property_name: campaign.property_name,
                    property_photo_url: campaign.property_photo_url,
                    assigned_user_id: campaign.assigned_user_id,
                    assigned_advisor_name: campaign.assigned_advisor_name,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.campaign) {
                    setCampaigns((prev) =>
                        prev.map((c) => (c.campaign === campaign.campaign ? { ...c, ...data.campaign } : c))
                    );
                }
                showToast(`Updated settings for ${campaign.campaign}!`);
            } else {
                setErrorMessage('Failed to save campaign details.');
            }
        } catch {
            setErrorMessage('Network error saving campaign details.');
        } finally {
            setSavingCamp(null);
        }
    };

    const updateLocalField = (campKey: string, field: keyof CampaignConfig, value: any) => {
        setCampaigns((prev) =>
            prev.map((c) => {
                if (c.campaign !== campKey) return c;
                const next = { ...c, [field]: value };
                if (field === 'assigned_user_id') {
                    const match = members.find((m) => m.id === value);
                    next.assigned_advisor_name = match ? match.name : null;
                }
                return next;
            })
        );
    };

    const showToast = (msg: string) => {
        setSuccessMessage(msg);
        setTimeout(() => setSuccessMessage(null), 3500);
    };

    const filtered = campaigns.filter((c) => {
        const matchesQuery =
            c.campaign.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.property_name.toLowerCase().includes(searchQuery.toLowerCase());

        if (statusFilter === 'active') return matchesQuery && c.outreach_enabled;
        if (statusFilter === 'paused') return matchesQuery && !c.outreach_enabled;
        return matchesQuery;
    });

    const activeCount = campaigns.filter((c) => c.outreach_enabled).length;

    return (
        <div className="space-y-6">
            {/* Header / Pilot Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-700 p-6 text-white shadow-lg">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold tracking-wide uppercase">
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                            Live Bangalore Pilot Active
                        </div>
                        <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                            Automated 1-Tap Lead Outreach & Property Showcase
                        </h2>
                        <p className="text-sm text-emerald-50 max-w-2xl leading-relaxed">
                            Control which campaigns send instant WhatsApp welcomes with property showcase photos.
                            Leads receive quick-reply buttons (<strong>Call me now | Later today | Tomorrow</strong>), triggering
                            a 10-minute SLA countdown and auto-escalation.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-xs space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold text-emerald-100">
                                <ShieldCheck className="w-4 h-4 text-emerald-300" />
                                Bangalore Pilot Assignee
                            </div>
                            <div className="text-sm font-bold text-white">Harshini Ranganathan</div>
                            <div className="text-[11px] text-emerald-100/80">9494608123 · BD Specialist</div>
                        </div>

                        <button
                            onClick={fetchConfigs}
                            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title="Refresh campaigns"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Notification Toasts */}
            {successMessage && (
                <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm font-medium animate-fadeIn">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span>{successMessage}</span>
                </div>
            )}
            {errorMessage && (
                <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-sm font-medium animate-fadeIn">
                    <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* Live WhatsApp Test Simulator & BD Alert Monitor */}
            <div className="rounded-2xl border-2 border-indigo-500/30 bg-gradient-to-br from-indigo-50/60 via-surface to-slate-50 dark:from-indigo-950/20 dark:via-surface dark:to-surface-elevated p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md">
                            <Radio className="w-5 h-5 animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-text-primary">
                                    Interactive WhatsApp Outreach Simulator
                                </h3>
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                                    Instant Test Mode
                                </span>
                            </div>
                            <p className="text-xs text-text-secondary mt-0.5">
                                Send Message 1 directly to your phone without creating leads. Tap quick-reply buttons on WhatsApp to test what the BD rep receives.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {testMonitorData?.active && (
                            <button
                                type="button"
                                onClick={() => fetchTestMonitor(testPhone, true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-slate-100 dark:hover:bg-surface-elevated text-xs font-semibold text-text-secondary transition-colors"
                                title="Refresh live test log"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingMonitor ? 'animate-spin' : ''}`} />
                                Refresh Live Status
                            </button>
                        )}
                    </div>
                </div>

                {/* Input Fields & Trigger Button */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end">
                    <div className="sm:col-span-4 space-y-1">
                        <label className="text-xs font-semibold text-text-secondary flex items-center gap-1">
                            <span>Test Client Phone</span>
                            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">(Pre-configured)</span>
                        </label>
                        <div className="relative">
                            <PhoneCall className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                            <input
                                type="text"
                                value={testPhone}
                                onChange={(e) => setTestPhone(e.target.value)}
                                placeholder="7028232515"
                                className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border text-sm font-mono text-text-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                        <label className="text-xs font-semibold text-text-secondary">Client Name</label>
                        <input
                            type="text"
                            value={testName}
                            onChange={(e) => setTestName(e.target.value)}
                            placeholder="Test Client"
                            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        />
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                        <label className="text-xs font-semibold text-text-secondary">Simulated Campaign</label>
                        <select
                            value={testCampaign}
                            onChange={(e) => setTestCampaign(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        >
                            <option value="Test Campaign">Test Campaign (Active)</option>
                            {campaigns.map((c) => (
                                <option key={c.campaign} value={c.campaign}>
                                    {c.campaign} {c.outreach_enabled ? '(ON)' : '(OFF)'}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="sm:col-span-2">
                        <button
                            type="button"
                            onClick={handleSendTestMessage}
                            disabled={isSendingTest}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm disabled:opacity-50 h-[38px]"
                        >
                            {isSendingTest ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    Send Message
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Live BD Rep Monitor & Response Feed */}
                {testMonitorData?.active && (
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-surface p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-text-primary flex items-center gap-1.5 uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                <Radio className="w-3.5 h-3.5 text-emerald-500 animate-ping" />
                                Live Test Flow Monitor (Phone: {testPhone})
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                                Assigned BD Rep: <strong className="text-text-primary">{testMonitorData?.lead?.assignee?.full_name || (campaigns.find(c => c.campaign.toLowerCase() === testCampaign.toLowerCase())?.assigned_advisor_name) || 'Harsh Patil'}</strong>
                            </span>
                        </div>

                        {/* Interactive Steps */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Step 1: Message 1 Status */}
                            <div className="p-3.5 rounded-lg border border-border bg-slate-50/70 dark:bg-surface-elevated/40 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-text-secondary flex items-center gap-1">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                        1. Message 1 Dispatched
                                    </span>
                                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200">
                                        Delivered
                                    </span>
                                </div>
                                <p className="text-xs text-text-primary leading-snug">
                                    Header photo + buttons: <strong>[Call me now | Later today | Tomorrow]</strong>
                                </p>
                            </div>

                            {/* Step 2: Client Response */}
                            <div className="p-3.5 rounded-lg border border-border bg-slate-50/70 dark:bg-surface-elevated/40 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-text-secondary flex items-center gap-1">
                                        <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                                        2. Client Tap Response
                                    </span>
                                    {testMonitorData?.lead?.preferred_slot ? (
                                        <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-300">
                                            Tapped
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-amber-700 font-bold bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded border border-amber-300 animate-pulse">
                                            Awaiting Tap
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-text-primary leading-snug">
                                    {testMonitorData?.lead?.preferred_slot ? (
                                        <strong className="text-emerald-600 dark:text-emerald-400">
                                            Selected: &quot;{testMonitorData.lead.preferred_slot}&quot;
                                        </strong>
                                    ) : (
                                        <span className="text-text-tertiary italic">
                                            Tap any button on WhatsApp ({testPhone}) to simulate response
                                        </span>
                                    )}
                                </p>
                            </div>

                            {/* Step 3: BD Alert & SLA Status */}
                            <div className="p-3.5 rounded-lg border border-border bg-slate-50/70 dark:bg-surface-elevated/40 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-text-secondary flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5 text-rose-600" />
                                        3. 10-Min SLA Countdown
                                    </span>
                                    {testMonitorData?.lead?.preferred_slot === 'call_now' ? (
                                        <span className="text-[10px] text-rose-700 font-bold bg-rose-100 dark:bg-rose-950 px-1.5 py-0.5 rounded border border-rose-300">
                                            Armed (10m)
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-text-tertiary">
                                            {testMonitorData?.lead?.preferred_slot ? 'Call Scheduled' : 'Standby'}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-text-primary leading-snug">
                                    {testMonitorData?.lead?.preferred_slot === 'call_now' ? (
                                        <span className="text-rose-600 font-semibold">
                                            Harshini alerted! Escalates to Saniel if uncalled in 10 mins.
                                        </span>
                                    ) : testMonitorData?.lead?.preferred_slot ? (
                                        <span className="text-text-secondary">
                                            Advisor contact card dispatched to client. Call task added.
                                        </span>
                                    ) : (
                                        <span className="text-text-tertiary italic">
                                            Will arm when client taps &quot;Call me now&quot;
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>

                        {/* Exact Rep Notification Preview Box */}
                        {testMonitorData?.lead?.preferred_slot && (
                            <div className="p-3.5 rounded-xl bg-slate-900 text-slate-100 space-y-2 font-mono text-xs shadow-inner">
                                <div className="flex items-center justify-between text-[11px] text-emerald-400 font-sans font-bold">
                                    <span>📲 High-Priority WhatsApp Notification Dispatched to BD Rep ({testMonitorData?.lead?.assignee?.full_name || (campaigns.find(c => c.campaign.toLowerCase() === testCampaign.toLowerCase())?.assigned_advisor_name) || 'Harsh Patil'})</span>
                                    <span className="text-slate-400 font-normal">Simulated Delivery</span>
                                </div>
                                <div className="p-3 bg-black/40 rounded-lg text-slate-200 whitespace-pre-line leading-relaxed border border-white/10">
                                    {testMonitorData.lead.preferred_slot === 'call_now' ? (
                                        `⚡ *URGENT: Lead requested immediate call!*
Client: ${testMonitorData.lead.name || 'Test Client'} (${testMonitorData.lead.phone})
City: ${testMonitorData.lead.city || 'Bangalore'}
Enquiry: 10-minute discovery call requested via ad form

⏰ CALL SLA: 10 MINUTES
If uncontacted within 10 minutes, this enquiry will automatically escalate to leadership (Saniel).`
                                    ) : (
                                        `📅 *Lead Scheduled Follow-up Call*
Client: ${testMonitorData.lead.name || 'Test Client'} (${testMonitorData.lead.phone})
Preferred Time: ${testMonitorData.lead.preferred_slot}
City: ${testMonitorData.lead.city || 'Bangalore'}

Task has been added to your CRM call schedule.`
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Follow-Up Nudge Timing & Automation Card */}
            <div className="bg-surface rounded-2xl border border-border p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center flex-shrink-0">
                            <Clock className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-bold text-text-primary">
                                    Follow-Up Nudge Automation
                                </h3>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                    Template: autopilot_lead_nudge_v1
                                </span>
                                {isSavingNudge && (
                                    <span className="text-[11px] text-primary flex items-center gap-1 font-semibold animate-pulse">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-text-secondary mt-0.5">
                                Automatically sends a gentle follow-up on WhatsApp if a lead hasn't tapped any quick-reply button.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-text-secondary">
                            {nudgeSettings.nudge_enabled ? 'Nudges Active' : 'Nudges Paused'}
                        </span>
                        <button
                            type="button"
                            onClick={() => handleSaveNudge({ nudge_enabled: !nudgeSettings.nudge_enabled })}
                            className="text-text-primary focus:outline-none"
                            title="Toggle Nudge"
                        >
                            {nudgeSettings.nudge_enabled ? (
                                <ToggleRight className="w-9 h-9 text-emerald-600 cursor-pointer" />
                            ) : (
                                <ToggleLeft className="w-9 h-9 text-slate-400 cursor-pointer" />
                            )}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                    <div className="md:col-span-8 space-y-2">
                        <label className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                            <span>Allot Timing to Send Follow-Up Nudge</span>
                            <span className="text-[11px] font-normal text-text-tertiary">(After initial Message 1 dispatch)</span>
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            {[1, 2, 4, 6, 8, 12, 24].map((hours) => (
                                <button
                                    key={hours}
                                    type="button"
                                    onClick={() => handleSaveNudge({ nudge_delay_hours: hours })}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                        Number(nudgeSettings.nudge_delay_hours) === hours
                                            ? 'bg-primary text-white border-primary shadow-xs'
                                            : 'bg-surface border-border text-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {hours === 24 ? '24 Hours (Next Day)' : `${hours} Hour${hours > 1 ? 's' : ''}`}
                                    {hours === 4 && <span className="ml-1 text-[10px] opacity-80">(Standard)</span>}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="md:col-span-4 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-border text-xs space-y-1">
                        <div className="flex items-center justify-between text-text-secondary font-semibold">
                            <span>Active Window:</span>
                            <span className="text-primary font-bold">
                                {nudgeSettings.nudge_delay_hours} Hour{nudgeSettings.nudge_delay_hours > 1 ? 's' : ''} Delay
                            </span>
                        </div>
                        <p className="text-[11px] text-text-tertiary leading-relaxed">
                            🛡️ <strong>Quiet Hours Guard:</strong> Nudges are only sent between 9:00 AM – 7:00 PM IST so leads are never disturbed at night.
                        </p>
                    </div>
                </div>
            </div>

            {/* Filter and Stats Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 dark:bg-surface-elevated p-4 rounded-xl border border-border">
                <div className="flex items-center gap-3 flex-1 max-w-md">
                    <div className="relative w-full">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            type="text"
                            placeholder="Search campaigns, cities, or property names..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-border bg-surface p-1 text-xs font-medium">
                        <button
                            onClick={() => setStatusFilter('all')}
                            className={`px-3 py-1.5 rounded-md transition-colors ${
                                statusFilter === 'all'
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            All ({campaigns.length})
                        </button>
                        <button
                            onClick={() => setStatusFilter('active')}
                            className={`px-3 py-1.5 rounded-md transition-colors ${
                                statusFilter === 'active'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            Active ({activeCount})
                        </button>
                        <button
                            onClick={() => setStatusFilter('paused')}
                            className={`px-3 py-1.5 rounded-md transition-colors ${
                                statusFilter === 'paused'
                                    ? 'bg-slate-700 text-white shadow-sm'
                                    : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            Paused ({campaigns.length - activeCount})
                        </button>
                    </div>
                </div>
            </div>

            {/* Campaign Cards List */}
            {loading ? (
                <div className="py-16 text-center text-text-tertiary">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                    <p className="text-sm">Loading campaign outreach configurations...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-text-tertiary bg-slate-50 dark:bg-surface-elevated rounded-xl border border-dashed border-border">
                    <Building2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">No campaigns match your filter.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5">
                    {filtered.map((camp) => {
                        const isSavingThis = savingCamp === camp.campaign;
                        const isBangalore = camp.is_pilot || camp.campaign.includes('bangalore') || camp.campaign.includes('bengaluru');

                        return (
                            <div
                                key={camp.campaign}
                                className={`rounded-xl border transition-all ${
                                    camp.outreach_enabled
                                        ? 'bg-surface border-emerald-300 dark:border-emerald-800 shadow-sm'
                                        : 'bg-slate-50/70 dark:bg-surface-elevated/40 border-border opacity-90'
                                } p-5 space-y-4`}
                            >
                                {/* Top Row: Campaign Name, City, Switch Toggle */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`p-2.5 rounded-xl flex-shrink-0 ${
                                                camp.outreach_enabled
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                            }`}
                                        >
                                            <PhoneCall className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-base font-bold text-text-primary capitalize">
                                                    {camp.campaign}
                                                </h3>
                                                {isBangalore && (
                                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border border-amber-300">
                                                        Bangalore Pilot (Live)
                                                    </span>
                                                )}
                                                <span
                                                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                        camp.outreach_enabled
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : 'bg-slate-200 text-slate-600 border border-slate-300'
                                                    }`}
                                                >
                                                    {camp.outreach_enabled ? 'Outreach Active' : 'Outreach Paused'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {camp.city || 'Metro'}
                                                </span>
                                                <span>•</span>
                                                <span>
                                                    Assigned Advisor:{' '}
                                                    <strong className="text-text-primary">
                                                        {camp.assigned_advisor_name || 'Round-robin'}
                                                    </strong>
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ON / OFF Switch */}
                                    <div className="flex items-center gap-3 self-end sm:self-center">
                                        <span className="text-xs font-semibold text-text-secondary">
                                            {camp.outreach_enabled ? 'ON' : 'OFF'}
                                        </span>
                                        <button
                                            onClick={() => handleToggle(camp)}
                                            disabled={isSavingThis}
                                            className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                                camp.outreach_enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                                            }`}
                                            title={`Toggle automated outreach for ${camp.campaign}`}
                                        >
                                            <span
                                                aria-hidden="true"
                                                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                    camp.outreach_enabled ? 'translate-x-7' : 'translate-x-0'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                </div>

                                {/* Form Body: Property Details & Photo */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
                                    {/* Left: Property Showcase Photo Thumbnail Preview & Direct Upload */}
                                    <div className="lg:col-span-4 flex flex-col space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                                                <ImageIcon className="w-3.5 h-3.5 text-primary" />
                                                WhatsApp Header Image
                                            </label>
                                            {uploadingPhotoCamp === camp.campaign && (
                                                <span className="text-[11px] text-primary flex items-center gap-1 font-semibold animate-pulse">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> Saving to DB...
                                                </span>
                                            )}
                                        </div>

                                        <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden border border-border bg-slate-900 group shadow-inner">
                                            {camp.property_photo_url ? (
                                                <img
                                                    src={camp.property_photo_url}
                                                    alt={camp.property_name || 'Centre preview'}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    onError={(e) => {
                                                        (e.target as any).src =
                                                            'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80';
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                                                    <ImageIcon className="w-8 h-8 mb-1 opacity-50" />
                                                    No photo configured
                                                </div>
                                            )}

                                            {/* Hover overlay with Change Photo button */}
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/95 hover:bg-white text-slate-900 text-xs font-bold shadow-lg transition-transform hover:scale-105">
                                                    <UploadCloud className="w-4 h-4 text-primary" />
                                                    Change Photo
                                                    <input
                                                        type="file"
                                                        accept="image/jpeg,image/png,image/webp"
                                                        className="hidden"
                                                        disabled={uploadingPhotoCamp === camp.campaign}
                                                        onChange={(e) => {
                                                            const f = e.target.files?.[0];
                                                            if (f) handlePhotoUpload(camp.campaign, f);
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                </label>
                                            </div>

                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5 pointer-events-none">
                                                <p className="text-white text-xs font-bold truncate">
                                                    {camp.property_name || 'Autopilot Offices Showcase'}
                                                </p>
                                                <p className="text-[10px] text-slate-300 truncate">
                                                    Sent as header in Message 1
                                                </p>
                                            </div>
                                        </div>

                                        {/* Direct Upload Button */}
                                        <div className="space-y-2 pt-0.5">
                                            <label className={`w-full cursor-pointer flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold transition-all shadow-xs ${
                                                uploadingPhotoCamp === camp.campaign
                                                    ? 'bg-primary/20 border-primary text-primary opacity-70 cursor-not-allowed'
                                                    : 'bg-primary/10 hover:bg-primary/15 border-primary/30 text-primary'
                                            }`}>
                                                {uploadingPhotoCamp === camp.campaign ? (
                                                    <>
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        Uploading & Saving to DB...
                                                    </>
                                                ) : (
                                                    <>
                                                        <UploadCloud className="w-3.5 h-3.5" />
                                                        Upload New Property Photo
                                                    </>
                                                )}
                                                <input
                                                    type="file"
                                                    accept="image/jpeg,image/png,image/webp"
                                                    className="hidden"
                                                    disabled={uploadingPhotoCamp === camp.campaign}
                                                    onChange={(e) => {
                                                        const f = e.target.files?.[0];
                                                        if (f) handlePhotoUpload(camp.campaign, f);
                                                        e.target.value = '';
                                                    }}
                                                />
                                            </label>

                                            {/* Quick select presets */}
                                            <div className="space-y-1">
                                                <p className="text-[11px] text-text-tertiary">Or pick standard preset:</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {PRESET_CENTRE_PHOTOS.map((preset) => (
                                                        <button
                                                            key={preset.label}
                                                            type="button"
                                                            onClick={() => updateLocalField(camp.campaign, 'property_photo_url', preset.url)}
                                                            className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                                                                camp.property_photo_url === preset.url
                                                                    ? 'bg-primary/10 border-primary text-primary font-bold'
                                                                    : 'bg-surface border-border text-text-secondary hover:bg-slate-100'
                                                            }`}
                                                        >
                                                            {preset.label.split(' ')[0]}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Property Details & Assignee Inputs */}
                                    <div className="lg:col-span-8 space-y-3.5">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                            {/* Property Name */}
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold text-text-secondary">
                                                    Property / Centre Name
                                                </label>
                                                <input
                                                    type="text"
                                                    value={camp.property_name || ''}
                                                    onChange={(e) => updateLocalField(camp.campaign, 'property_name', e.target.value)}
                                                    placeholder="e.g. Purva Gainz · Bangalore"
                                                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                />
                                            </div>

                                            {/* Assigned BD Advisor */}
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold text-text-secondary flex items-center justify-between">
                                                    <span>Assigned BD Advisor</span>
                                                    {isBangalore && (
                                                        <span className="text-[10px] text-emerald-600 font-bold">Harshini (Pilot)</span>
                                                    )}
                                                </label>
                                                <select
                                                    value={camp.assigned_user_id || ''}
                                                    onChange={(e) => updateLocalField(camp.campaign, 'assigned_user_id', e.target.value)}
                                                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                >
                                                    <option value="">Round-robin distribution</option>
                                                    {members.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name} {m.phone ? `(${m.phone})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Property Photo URL Input */}
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-text-secondary flex items-center justify-between">
                                                <span>Property Showcase Photo URL</span>
                                                {camp.property_photo_url && (
                                                    <a
                                                        href={camp.property_photo_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-[11px] text-primary hover:underline flex items-center gap-1"
                                                    >
                                                        Open Full Image <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                )}
                                            </label>
                                            <input
                                                type="url"
                                                value={camp.property_photo_url || ''}
                                                onChange={(e) => updateLocalField(camp.campaign, 'property_photo_url', e.target.value)}
                                                placeholder="https://images.unsplash.com/photo-..."
                                                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-xs"
                                            />
                                        </div>

                                        {/* Save Action Button */}
                                        <div className="flex items-center justify-end pt-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSaveDetails(camp)}
                                                disabled={isSavingThis}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-colors disabled:opacity-50 shadow-sm"
                                            >
                                                {isSavingThis ? (
                                                    <>
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        Saving...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Save className="w-3.5 h-3.5" />
                                                        Save Campaign Details
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
