"use client";

import React, { useEffect, useState } from 'react';
import { Lock, Unlock, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * Step 3 — Who is unlocked for the Task Manager.
 * A person can use it only when their department is switched ON *and* their kickoff is recorded.
 * "Mark kickoff as sent (manual)" only RECORDS it. It never sends a WhatsApp message.
 */

interface AccessMember {
    userId: string;
    name: string;
    taskRole: string;
    onboarded: boolean;
    source: string | null;
    kickoffSentAt: string | null;
}

interface AccessDepartment {
    departmentId: string;
    name: string;
    enabled: boolean;
    peerAssign: boolean;
    notificationsDelegated: boolean;
    taskImportEnabled: boolean;
    smartChatEnabled: boolean;
    superuserCollabEnabled: boolean;
    memberCount: number;
    onboardedCount: number;
    members: AccessMember[];
}

function formatWhen(iso: string | null): string {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
        return '';
    }
}

const SOURCE_LABEL: Record<string, string> = {
    whatsapp: 'kickoff sent via WhatsApp',
    manual: 'marked manually',
    backfill: 'already onboarded (existing team)',
};

export default function TaskAccessPanel({ orgId }: { orgId?: string }) {
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [provisioned, setProvisioned] = useState(true);
    const [nlGateway, setNlGateway] = useState(false);
    const [taskImportColumnMissing, setTaskImportColumnMissing] = useState(false);
    const [smartChatColumnMissing, setSmartChatColumnMissing] = useState(false);
    const [collabColumnMissing, setCollabColumnMissing] = useState(false);
    const [sharingColumnMissing, setSharingColumnMissing] = useState(false);
    const [notificationsColumnMissing, setNotificationsColumnMissing] = useState(false);
    const [departments, setDepartments] = useState<AccessDepartment[]>([]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const url = `/api/task-manager/access?orgId=${encodeURIComponent(orgId || '')}`;

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load access settings');
            setProvisioned(Boolean(data.provisioned));
            setNlGateway(Boolean(data.nlGatewayEnabled));
            setTaskImportColumnMissing(Boolean(data.taskImportColumnMissing));
            setSmartChatColumnMissing(Boolean(data.smartChatColumnMissing));
            setCollabColumnMissing(Boolean(data.superuserCollabColumnMissing));
            setSharingColumnMissing(Boolean(data.teamSharingColumnMissing));
            setNotificationsColumnMissing(Boolean(data.notificationsColumnMissing));
            if (data.readable === false) setError('Access settings could not be read. Everyone is treated as locked until this works again.');
            setDepartments(data.departments || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load access settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId]);

    const post = async (key: string, body: Record<string, unknown>) => {
        setBusyKey(key);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Action failed');
            setNotice(data.message || 'Saved.');
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Action failed');
        } finally {
            setBusyKey(null);
        }
    };

    const toggleDepartment = (d: AccessDepartment) => {
        const next = !d.enabled;
        const text = next
            ? `Switch the Task Manager ON for ${d.name}?\n\nOnly people whose kickoff is recorded will be unlocked (${d.onboardedCount} of ${d.memberCount} right now).`
            : `Switch the Task Manager OFF for ${d.name}?\n\nNobody in this department will be able to use it.`;
        if (!window.confirm(text)) return;
        post(`dept-${d.departmentId}`, { action: 'set_department', departmentId: d.departmentId, enabled: next });
    };

    const toggleTeamSharing = (d: AccessDepartment) => {
        const next = !d.peerAssign;
        const text = next
            ? `Switch team sharing ON for ${d.name}?\n\nMembers of ${d.name} will be able to see each other's tasks and assign tasks to each other (web Tasks tab and WhatsApp). Each person can still complete only their own tasks.`
            : `Switch team sharing OFF for ${d.name}?\n\nMembers will only see themselves and the people who report to them.`;
        if (!window.confirm(text)) return;
        post(`share-${d.departmentId}`, { action: 'set_team_sharing', departmentId: d.departmentId, enabled: next });
    };

    const toggleNotificationsDelegated = (d: AccessDepartment) => {
        const next = !d.notificationsDelegated;
        const text = next
            ? `Let ${d.name} manage its own notifications?\n\nAnyone in ${d.name} will be able to change when its Task Manager messages go out and what they say (only for their own team). You keep the kill switches, Pretend Mode and every other department.`
            : `Take notification settings back for ${d.name}?\n\nThe team will still see their schedule but cannot change it.`;
        if (!window.confirm(text)) return;
        post(`notif-${d.departmentId}`, { action: 'set_notifications_delegated', departmentId: d.departmentId, enabled: next });
    };

    const toggleSuperuser = (m: AccessMember) => {
        const next = m.taskRole !== 'superuser';
        const text = next
            ? `Make ${m.name} a SUPERUSER?\n\nThey will be able to see and assign tasks for every department, on the web and by WhatsApp. You can remove this later.`
            : `Remove ${m.name}'s superuser role?\n\nThey go back to a normal employee.`;
        if (!window.confirm(text)) return;
        post(`super-${m.userId}`, { action: 'set_superuser', userId: m.userId, enabled: next });
    };

    const markKickoff = (m: AccessMember, deptName: string) => {
        const ok = window.confirm(
            `Record that ${m.name}'s kickoff has been sent?\n\nThis only RECORDS it so ${m.name} is unlocked once ${deptName} is switched ON.\nIt does NOT send any WhatsApp message.`
        );
        if (!ok) return;
        post(`kick-${m.userId}`, { action: 'record_kickoff', userId: m.userId });
    };

    const undoKickoff = (m: AccessMember) => {
        if (!window.confirm(`Remove the kickoff record for ${m.name}? They will be locked again.`)) return;
        post(`kick-${m.userId}`, { action: 'remove_kickoff', userId: m.userId });
    };

    const toggleNlGateway = () => {
        const next = !nlGateway;
        const text = next
            ? 'Switch natural-language chat ON?\n\nEveryone who is unlocked for the Task Manager can then write normally ("show my tasks", "I finished the vendor call"). Any change asks "confirm?" first. While Pretend Mode is ON no reply is actually sent.'
            : 'Switch natural-language chat OFF? The bot goes back to the exact old behaviour.';
        if (!window.confirm(text)) return;
        post('nl-gateway', { action: 'set_nl_gateway', enabled: next });
    };

    const toggleTaskImport = (d: AccessDepartment) => {
        const next = !d.taskImportEnabled;
        const text = next
            ? `Let ${d.name} send task lists on WhatsApp?

Anyone in ${d.name} who is unlocked for the Task Manager can then send an Excel file (or an image / text that says "add tasks"). The bot shows a numbered preview and saves nothing until they reply YES. While Pretend Mode is ON no reply is actually sent (saving after YES still happens). While the sandbox is ON only the sandbox numbers can use it.`
            : `Switch task import OFF for ${d.name}?

Their files and images go back to being handled exactly as before.`;
        if (!window.confirm(text)) return;
        post(`import-${d.departmentId}`, { action: 'set_task_import', departmentId: d.departmentId, enabled: next });
    };

    const toggleSuperuserCollab = (d: AccessDepartment) => {
        const next = !d.superuserCollabEnabled;
        const text = next
            ? `Let ${d.name} give tasks to a superuser?\n\nThis is a PERMISSION change. People in ${d.name} will be able to give tasks to a superuser (for example Saniel), see the tasks they gave him, and send him "these are pending for you" reminders, now or scheduled, plus one shared regular reminder for the team. His replies ("working on it", "done") are passed back to whoever gave him each task, as a summary, not his exact words. Nothing else about who can assign to whom changes. While Pretend Mode is ON no WhatsApp message is actually sent.`
            : `Stop ${d.name} from giving tasks to a superuser?\n\nThe "superuser" tab disappears for them and scheduled reminders will no longer be sent. Tasks already given stay where they are.`;
        if (!window.confirm(text)) return;
        post(`collab-${d.departmentId}`, { action: 'set_superuser_collab', departmentId: d.departmentId, enabled: next });
    };

    const toggleSmartChat = (d: AccessDepartment) => {
        const next = !d.smartChatEnabled;
        const text = next
            ? `Let ${d.name} talk to the Task Manager in plain language?\n\nAnyone in ${d.name} who is unlocked can then write normally on WhatsApp ("what's pending?", "give Vidya a task to chase the quote", "finished the carpet one"). Every change is confirmed first, and anything unclear is asked about, never guessed. If the AI is unavailable, or a message is about rooms or tickets, the old bot answers as before. While Pretend Mode is ON no reply is actually sent (changes after YES still happen). While the sandbox is ON only the sandbox numbers can use it.`
            : `Switch smart chat OFF for ${d.name}?\n\nThe bot answers them exactly as before.`;
        if (!window.confirm(text)) return;
        post(`smart-${d.departmentId}`, { action: 'set_smart_chat', departmentId: d.departmentId, enabled: next });
    };

    const toggleExpanded = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    return (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <Lock className="w-5 h-5 text-emerald-600" />
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                                Task Manager Access (who is unlocked)
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Step 3
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            A person can use the Task Manager only when their department is switched ON <strong>and</strong> their kickoff has been sent.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    disabled={loading}
                    onClick={load}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50 self-start"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {!provisioned && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Access tables are not created yet</p>
                    <p>
                        Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000001_task_manager_access_control.sql</code> once in the Supabase SQL Editor.
                        Until then <strong>only the Tech team is unlocked</strong> and the switches below are disabled.
                    </p>
                </div>
            )}

            {provisioned && sharingColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Team sharing needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000002_task_manager_team_sharing.sql</code> once in the Supabase SQL Editor. Until then team sharing is OFF everywhere and its buttons are disabled.</p>
                </div>
            )}

            {provisioned && notificationsColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Team-managed notifications need one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000003_task_manager_notification_delegation.sql</code> once in the Supabase SQL Editor. Until then no team can manage its own notifications and the button is disabled.</p>
                </div>
            )}

            {provisioned && collabColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Working with a superuser needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000006_task_manager_superuser_pings.sql</code> once in the Supabase SQL Editor. Until then no team can give tasks to a superuser and its buttons are disabled.</p>
                </div>
            )}

            {provisioned && smartChatColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Smart chat needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000005_task_manager_smart_chat.sql</code> once in the Supabase SQL Editor. Until then smart chat is OFF for every team and its buttons are disabled.</p>
                </div>
            )}

            {provisioned && taskImportColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Task import needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261007000004_task_manager_task_import.sql</code> once in the Supabase SQL Editor. Until then task import is OFF for every team and its buttons are disabled.</p>
                </div>
            )}

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <p className="font-black text-slate-900">Natural-language chat <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Step 4</span></p>
                    <p className="text-slate-600">Unlocked people can write normally (&ldquo;show my tasks&rdquo;, &ldquo;I finished the vendor call&rdquo;). Any change asks &ldquo;confirm?&rdquo; first. Room and ticket messages go to the existing bot.</p>
                </div>
                <button
                    type="button"
                    disabled={busyKey === 'nl-gateway'}
                    onClick={toggleNlGateway}
                    className={`px-3.5 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 whitespace-nowrap ${nlGateway ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                >
                    {nlGateway ? 'ON' : 'OFF'}
                </button>
            </div>

            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 text-xs">
                While Pretend Mode is ON no kickoff is really sent. After you send a kickoff yourself, use
                <strong> &ldquo;Mark kickoff as sent (manual)&rdquo; </strong> to record it. That button only records it. It sends nothing.
            </div>

            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">⚠️ {error}</div>}
            {notice && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> {notice}
                </div>
            )}

            {loading && departments.length === 0 && <p className="text-xs text-slate-500">Loading…</p>}

            <div className="space-y-2">
                {departments.map(d => {
                    const isOpen = expanded.has(d.departmentId);
                    const busy = busyKey === `dept-${d.departmentId}`;
                    const noneUnlocked = d.enabled && d.onboardedCount === 0;
                    return (
                        <div key={d.departmentId} className="border border-slate-200 rounded-2xl overflow-hidden">
                            <div className="flex items-center justify-between gap-3 p-3 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => toggleExpanded(d.departmentId)}
                                    className="flex items-center gap-2 text-left cursor-pointer"
                                >
                                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                                    <span className="text-sm font-bold text-slate-900">{d.name}</span>
                                    <span className="text-[11px] text-slate-500">{d.onboardedCount} of {d.memberCount} kickoff sent</span>
                                    {noneUnlocked && (
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                                            ON, but nobody is unlocked yet
                                        </span>
                                    )}
                                </button>
                                <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={!provisioned || collabColumnMissing || busyKey === `collab-${d.departmentId}`}
                                    onClick={() => toggleSuperuserCollab(d)}
                                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.superuserCollabEnabled
                                            ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                            : 'bg-white border border-slate-300 hover:bg-slate-100 text-slate-600'
                                    }`}
                                    title="This team can give tasks to a superuser and send them reminders"
                                >
                                    Send tasks to a superuser: {d.superuserCollabEnabled ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    disabled={!provisioned || smartChatColumnMissing || busyKey === `smart-${d.departmentId}`}
                                    onClick={() => toggleSmartChat(d)}
                                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.smartChatEnabled
                                            ? 'bg-violet-600 hover:bg-violet-700 text-white'
                                            : 'bg-white border border-slate-300 hover:bg-slate-100 text-slate-600'
                                    }`}
                                    title="People in this team can talk to the Task Manager in plain language on WhatsApp"
                                >
                                    Smart chat: {d.smartChatEnabled ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    disabled={!provisioned || taskImportColumnMissing || busyKey === `import-${d.departmentId}`}
                                    onClick={() => toggleTaskImport(d)}
                                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.taskImportEnabled
                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            : 'bg-white border border-slate-300 hover:bg-slate-100 text-slate-600'
                                    }`}
                                    title="People in this team can send a task list (Excel / image / text) on WhatsApp and save it to their Tasks tab"
                                >
                                    Task import: {d.taskImportEnabled ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    disabled={!provisioned || notificationsColumnMissing || busyKey === `notif-${d.departmentId}`}
                                    onClick={() => toggleNotificationsDelegated(d)}
                                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.notificationsDelegated
                                            ? 'bg-sky-600 hover:bg-sky-700 text-white'
                                            : 'bg-white border border-slate-300 hover:bg-slate-100 text-slate-600'
                                    }`}
                                    title="Let this team set its own notification times and wording"
                                >
                                    Team manages notifications: {d.notificationsDelegated ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    disabled={!provisioned || sharingColumnMissing || busyKey === `share-${d.departmentId}`}
                                    onClick={() => toggleTeamSharing(d)}
                                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.peerAssign
                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                            : 'bg-white border border-slate-300 hover:bg-slate-100 text-slate-600'
                                    }`}
                                    title="Members can see and assign each other's tasks"
                                >
                                    Team sharing: {d.peerAssign ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    disabled={!provisioned || busy}
                                    onClick={() => toggleDepartment(d)}
                                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        d.enabled
                                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                            : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                                    }`}
                                    title={d.enabled ? 'Click to switch OFF' : 'Click to switch ON'}
                                >
                                    {d.enabled ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                    {d.enabled ? 'ON' : 'OFF'}
                                </button>
                                </div>
                            </div>

                            {isOpen && (
                                <div className="border-t border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
                                    {d.members.length === 0 && <p className="p-3 text-xs text-slate-500">No members with a user account.</p>}
                                    {d.members.map(m => {
                                        const mBusy = busyKey === `kick-${m.userId}`;
                                        return (
                                            <div key={m.userId} className="flex items-center justify-between gap-3 px-4 py-2 flex-wrap">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-xs font-bold text-slate-900">{m.name}</span>
                                                    {m.taskRole !== 'employee' && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">{m.taskRole}</span>
                                                    )}
                                                    {m.onboarded ? (
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                                                            ✅ Kickoff sent
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-200 text-slate-700 border border-slate-300">
                                                            Not invited
                                                        </span>
                                                    )}
                                                    {m.onboarded && m.source && (
                                                        <span className="text-[10px] text-slate-500">
                                                            {SOURCE_LABEL[m.source] || m.source}{m.kickoffSentAt ? ` · ${formatWhen(m.kickoffSentAt)}` : ''}
                                                        </span>
                                                    )}
                                                </div>
                                                {provisioned && (
                                                    <button
                                                        type="button"
                                                        disabled={busyKey === `super-${m.userId}`}
                                                        onClick={() => toggleSuperuser(m)}
                                                        className={`text-[11px] font-bold underline cursor-pointer disabled:opacity-50 mr-3 ${m.taskRole === 'superuser' ? 'text-rose-600 hover:text-rose-800' : 'text-indigo-600 hover:text-indigo-800'}`}
                                                    >
                                                        {m.taskRole === 'superuser' ? 'Remove superuser' : 'Make superuser'}
                                                    </button>
                                                )}
                                                {provisioned && (
                                                    m.onboarded ? (
                                                        <button
                                                            type="button"
                                                            disabled={mBusy}
                                                            onClick={() => undoKickoff(m)}
                                                            className="text-[11px] font-bold text-slate-500 hover:text-rose-700 underline cursor-pointer disabled:opacity-50"
                                                        >
                                                            Undo
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={mBusy}
                                                            onClick={() => markKickoff(m, d.name)}
                                                            className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50"
                                                        >
                                                            Mark kickoff as sent (manual)
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
