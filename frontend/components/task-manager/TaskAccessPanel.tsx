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
    /** Owner 2026-10-27: ticked for "Only selected people" (may send to other departments). */
    crossDeptAllowed?: boolean;
}

interface AccessDepartment {
    departmentId: string;
    name: string;
    enabled: boolean;
    peerAssign: boolean;
    /** Owner 2026-10-19: members may give tasks to anyone in the team (seeing still follows the reporting chain). */
    teamAssign?: boolean;
    /** Owner 2026-10-19: the "Pending on…" button, protection of given tasks, and the "Assigned by me" tab. */
    pendingOn?: boolean;
    protectGiven?: boolean;
    assignedTab?: boolean;
    /** Owner 2026-10-27: deadlines on tasks (countdown, "due soon" reminder, on-time / late). */
    dueDates?: boolean;
    /** Owner 2026-10-27: the Send tab's "Other departments" side (ON by default). */
    crossDeptCollab?: boolean;
    /** Owner 2026-10-27: who may SEND to other departments: everyone, or only the ticked people. */
    crossDeptScope?: 'everyone' | 'selected';
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

/**
 * Owner 2026-10-27: one on/off switch (replaces the coloured "Name: ON" pills). `role="switch"` so screen readers
 * announce it as on or off; the label stays next to it.
 */
function Toggle({ checked, disabled, busy, onClick, label, tone = 'indigo' }: {
    checked: boolean; disabled?: boolean; busy?: boolean; onClick: () => void; label: string; tone?: 'indigo' | 'emerald';
}) {
    const on = tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-600';
    return (
        <button
            type="button" role="switch" aria-checked={checked} aria-label={label} title={checked ? 'ON — click to switch off' : 'OFF — click to switch on'}
            disabled={disabled || busy} onClick={onClick}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? on : 'bg-slate-300'}`}
        >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'} ${busy ? 'animate-pulse' : ''}`} />
        </button>
    );
}

/** One department setting: name and a short line on the left, the switch on the right. */
function SettingRow({ label, hint, checked, disabled, busy, onToggle }: {
    label: string; hint: string; checked: boolean; disabled: boolean; busy: boolean; onToggle: () => void;
}) {
    return (
        <div className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">{label}</p>
                <p className="text-[11px] leading-snug text-slate-500">{hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className={`w-6 text-right text-[10px] font-black uppercase tracking-wider ${checked ? 'text-indigo-700' : 'text-slate-400'}`}>{checked ? 'On' : 'Off'}</span>
                <Toggle checked={checked} disabled={disabled} busy={busy} onClick={onToggle} label={label} />
            </div>
        </div>
    );
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
    type BotFeature = 'neverSilent' | 'conversationMemory' | 'frontDoor' | 'teamReports' | 'learningLoop' | 'promptVersions' | 'nightlyAutoTune' | 'voiceNotes';
    const [botFeatures, setBotFeatures] = useState<Record<BotFeature, boolean>>({ neverSilent: false, conversationMemory: false, frontDoor: false, teamReports: false, learningLoop: false, promptVersions: false, nightlyAutoTune: false, voiceNotes: false });
    const [taskImportColumnMissing, setTaskImportColumnMissing] = useState(false);
    const [smartChatColumnMissing, setSmartChatColumnMissing] = useState(false);
    const [collabColumnMissing, setCollabColumnMissing] = useState(false);
    const [sharingColumnMissing, setSharingColumnMissing] = useState(false);
    const [teamAssignColumnMissing, setTeamAssignColumnMissing] = useState(false);
    const [teamFeaturesColumnMissing, setTeamFeaturesColumnMissing] = useState(false);
    const [dueDatesColumnMissing, setDueDatesColumnMissing] = useState(false);
    const [crossDeptColumnMissing, setCrossDeptColumnMissing] = useState(false);
    const [crossDeptScopeColumnMissing, setCrossDeptScopeColumnMissing] = useState(false);
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
            setBotFeatures({ neverSilent: data.botFeatures?.neverSilent === true, conversationMemory: data.botFeatures?.conversationMemory === true, frontDoor: data.botFeatures?.frontDoor === true, teamReports: data.botFeatures?.teamReports === true, learningLoop: data.botFeatures?.learningLoop === true, promptVersions: data.botFeatures?.promptVersions === true, nightlyAutoTune: data.botFeatures?.nightlyAutoTune === true, voiceNotes: data.botFeatures?.voiceNotes === true });
            setTaskImportColumnMissing(Boolean(data.taskImportColumnMissing));
            setSmartChatColumnMissing(Boolean(data.smartChatColumnMissing));
            setCollabColumnMissing(Boolean(data.superuserCollabColumnMissing));
            setSharingColumnMissing(Boolean(data.teamSharingColumnMissing));
            setTeamAssignColumnMissing(Boolean(data.teamAssignColumnMissing));
            setTeamFeaturesColumnMissing(Boolean(data.teamFeaturesColumnMissing));
            setDueDatesColumnMissing(Boolean(data.dueDatesColumnMissing));
            setCrossDeptColumnMissing(Boolean(data.crossDeptColumnMissing));
            setCrossDeptScopeColumnMissing(Boolean(data.crossDeptScopeColumnMissing));
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

    const toggleTeamAssign = (d: AccessDepartment) => {
        const next = !d.teamAssign;
        const text = next
            ? `Switch "Assign to anyone in team" ON for ${d.name}?\n\nEveryone in ${d.name} will be able to give a task to anyone else in ${d.name}, including their own manager (web Tasks tab and WhatsApp).\n\nSeeing tasks does not change: each person still sees only their own tasks and those of the people below them.`
            : `Switch "Assign to anyone in team" OFF for ${d.name}?\n\nMembers will be able to give tasks only to the people below them.`;
        if (!window.confirm(text)) return;
        post(`assign-${d.departmentId}`, { action: 'set_team_assign', departmentId: d.departmentId, enabled: next });
    };

    // Owner 2026-10-19: one handler for the three new per-team switches.
    const TEAM_FEATURE_TEXT = {
        pending_on: {
            on: (n: string) => `Switch "Pending on" ON for ${n}?\n\nPeople in ${n} get a "Pending on…" button on their own open tasks, to tell a colleague the task is waiting on them. The colleague gets an app notification and a WhatsApp message. Nobody can see anyone else's board because of this.`,
            off: (n: string) => `Switch "Pending on" OFF for ${n}?\n\nThe button disappears for this team.`,
        },
        protect_given: {
            on: (n: string) => `Switch "Protect given tasks" ON for ${n}?\n\nA task someone else gave a person in ${n} can no longer be deleted or renamed by that person. Only the giver, the giver's manager (or anyone above), or a superuser can.`,
            off: (n: string) => `Switch "Protect given tasks" OFF for ${n}?\n\nPeople can delete any task on their own list again.`,
        },
        assigned_tab: {
            on: (n: string) => `Switch the "Assigned by me" tab ON for ${n}?\n\nPeople in ${n} see every task they gave, with status and times, and can edit or delete them. Managers also see (view only) the tasks given by the people below them.`,
            off: (n: string) => `Switch the "Assigned by me" tab OFF for ${n}?\n\nThe tab disappears for this team. No task is changed.`,
        },
        cross_dept_collab: {
            on: (n: string) => `Switch "Work with other departments" ON for ${n}?

People in ${n} can give tasks to, ask for support from, and work together with people in other departments (Send tab), and other departments can do the same with them.`,
            off: (n: string) => `Switch "Work with other departments" OFF for ${n}?

People in ${n} can no longer send anything to other departments, and other departments can no longer send anything to them. Support requests already waiting can still be answered. No task is changed or deleted.`,
        },
        due_dates: {
            on: (n: string) => `Switch "Due dates" ON for ${n}?\n\nPeople in ${n} can give a task a deadline (a date, and a time if they want). Cards count down ("Due in 3 h", "Overdue by 40 min"), a task that takes several days is not "carried forward" before its deadline, and finished tasks show "Done on time" or how late. People in ${n} get ONE reminder before a deadline (2 hours before a set time, or 5 pm the day before) in the app and on WhatsApp (template task_due_soon_v1; kill switches and Pretend Mode apply).`,
            off: (n: string) => `Switch "Due dates" OFF for ${n}?\n\nPeople in ${n} can no longer set deadlines and get no more "due soon" reminders. Deadlines already set still show on the cards. No task is changed.`,
        },
    } as const;
    type TeamFeatureKey = keyof typeof TEAM_FEATURE_TEXT;
    const featureValue = (d: AccessDepartment, f: TeamFeatureKey) => ({ pending_on: d.pendingOn, protect_given: d.protectGiven, assigned_tab: d.assignedTab, due_dates: d.dueDates, cross_dept_collab: d.crossDeptCollab !== false })[f] === true;
    const toggleTeamFeature = (d: AccessDepartment, feature: TeamFeatureKey) => {
        const next = !featureValue(d, feature);
        if (!window.confirm(next ? TEAM_FEATURE_TEXT[feature].on(d.name) : TEAM_FEATURE_TEXT[feature].off(d.name))) return;
        post(`${feature}-${d.departmentId}`, { action: 'set_team_feature', departmentId: d.departmentId, feature, enabled: next });
    };

    // Owner 2026-10-27: who in a department may SEND to other departments (receiving stays open for everyone).
    const setCrossDeptScope = (d: AccessDepartment, scope: 'everyone' | 'selected') => {
        if ((d.crossDeptScope ?? 'everyone') === scope) return;
        const text = scope === 'selected'
            ? `Only selected people in ${d.name} may send work to other departments?\n\nNobody is ticked yet: after this, open the people list ("Show people") and tick who may send. Everyone in ${d.name} can still RECEIVE tasks and support requests from other departments.`
            : `Let everyone in ${d.name} send work to other departments again?\n\nThe ticks are kept, in case you switch back.`;
        if (!window.confirm(text)) return;
        post(`scope-${d.departmentId}`, { action: 'set_cross_dept_scope', departmentId: d.departmentId, scope });
        if (scope === 'selected') setExpanded(prev => new Set(prev).add(d.departmentId));
    };
    const toggleCrossDeptPerson = (m: AccessMember) => {
        post(`xperson-${m.userId}`, { action: 'set_cross_dept_person', userId: m.userId, enabled: !m.crossDeptAllowed });
    };

    const toggleNotificationsDelegated = (d: AccessDepartment) => {
        const next = !d.notificationsDelegated;
        const text = next
            ? `Let ${d.name} manage its own notifications?\n\nAnyone in ${d.name} will be able to change when its Task Manager messages go out and what they say (only for their own team). You keep the kill switches, Pretend Mode and every other department.`
            : `Take notification settings back for ${d.name}?\n\nThe team will still see their schedule but cannot change it.`;
        if (!window.confirm(text)) return;
        post(`notif-${d.departmentId}`, { action: 'set_notifications_delegated', departmentId: d.departmentId, enabled: next });
    };

    // Reporting manager (moved here from the old "Manager Role Assignment & WhatsApp Kickoff" card, 2026-10-12).
    const toggleManager = (m: AccessMember) => {
        const next = m.taskRole !== 'reporting_manager';
        const text = next
            ? `Make ${m.name} a REPORTING MANAGER?\n\nThey can see and assign tasks across their department, and get their team's progress at midday (if anything is pending) and in the evening. No WhatsApp message is sent by this button. You can remove this later.`
            : `Remove ${m.name}'s manager role?\n\nThey go back to a normal employee.`;
        if (!window.confirm(text)) return;
        post(`manager-${m.userId}`, { action: 'set_manager', userId: m.userId, enabled: next });
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

    const toggleBotFeature = (feature: BotFeature) => {
        const next = !botFeatures[feature];
        const phase5 = feature === 'learningLoop' ? 'Capture likely mistakes for admin review? Requires Phase 5 SQL.' : feature === 'promptVersions' ? 'Use approved database prompt versions? Invalid or unavailable versions fall back to built-in instructions.' : feature === 'nightlyAutoTune' ? 'Draft and safety-test at most one candidate per night after 02:00 IST? Nothing activates automatically.' : null;
        const text = phase5 ? `Switch "${feature}" ${next ? 'ON' : 'OFF'}?\n\n${phase5}` : feature === 'voiceNotes'
            ? (next
                ? 'Switch "Voice notes" ON?\n\nEveryone who uses the Task Manager can send a WhatsApp voice note instead of typing. It is turned into text, they see "🎙️ I heard: …", and changes still need their YES. While the sandbox is ON, only sandbox numbers can use it.\n\nNo SQL file needed. Needs GROQ_VOICE_API_KEY on the server.'
                : 'Switch "Voice notes" OFF? Voice notes are ignored again; typing works as before.')
            : feature === 'teamReports'
            ? (next
                ? 'Switch "Team reports" ON?\n\nIn Smart chat, anyone who can give work to others can ask "how is my team doing today?" or "anything overdue in my team?". The answer only includes people they are already allowed to see. Read-only: nothing is changed.\n\nNo SQL file needed.'
                : 'Switch "Team reports" OFF? Team questions stop working; the AI goes back to exactly its previous instructions.')
            : feature === 'frontDoor'
            ? (next
                ? 'Switch "One front door" ON?\n\nFor departments with Smart chat ON:\n• "done 2", "done all" and "tasks" are answered at once (no AI, no YES).\n• "undo" reverses your own last change within 10 minutes (not hand-overs).\n• When the AI is down, people get a short help line instead of the 1 / 2 menu.\n\nNo SQL file needed.'
                : 'Switch "One front door" OFF? Smart chat goes back to asking YES for every completion, and "undo" stops working.')
            : feature === 'neverSilent'
            ? (next
                ? 'Switch "Never silent" ON?\n\nNeeds the SQL file supabase/migrations/20261011000001_whatsapp_inbound_ledger.sql run once first.\n\nEvery Task Manager WhatsApp message is noted (no message text). If the bot does not reply, the person gets one short apology at the next 15-minute check. While Pretend Mode is ON no apology is actually sent.'
                : 'Switch "Never silent" OFF? Messages are no longer noted and no apologies are sent.')
            : (next
                ? 'Switch "Conversation memory" ON?\n\nNeeds the SQL file supabase/migrations/20261011000002_whatsapp_conversation_memory.sql run once first.\n\nThe last 20 messages of each person\'s chat with the bot are kept for 24 hours so the AI can follow the conversation, then deleted. Nobody can see them in the app.'
                : 'Switch "Conversation memory" OFF?\n\nThe AI stops reading earlier messages and ALL stored chat memories are deleted now.');
        if (!window.confirm(text)) return;
        post(`bot-${feature}`, { action: 'set_bot_feature', feature, enabled: next });
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

            {provisioned && (teamAssignColumnMissing || teamFeaturesColumnMissing) && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> The new team switches need one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261019000001_task_manager_team_controls.sql</code> once in the Supabase SQL Editor. Until then &quot;Assign to anyone in team&quot;, &quot;Pending on&quot;, &quot;Protect given tasks&quot; and &quot;Assigned by me&quot; are OFF everywhere and their buttons are disabled.</p>
                </div>
            )}

            {provisioned && crossDeptColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> &quot;Work with other departments&quot; needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261027100002_task_manager_cross_department_switch.sql</code> once in the Supabase SQL Editor. Until then every department can work with other departments (as today) and the switch cannot be turned off.</p>
                </div>
            )}

            {provisioned && !crossDeptColumnMissing && crossDeptScopeColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Choosing who can send to other departments needs one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261027100003_task_manager_cross_department_people.sql</code> once in the Supabase SQL Editor. Until then everyone in a department with the switch ON can send.</p>
                </div>
            )}

            {provisioned && dueDatesColumnMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Due dates need one more SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261027100001_task_manager_due_dates.sql</code> once in the Supabase SQL Editor. Until then due dates are OFF everywhere and the switch is disabled.</p>
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
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    <span className={`text-[10px] font-black uppercase tracking-wider ${nlGateway ? 'text-emerald-700' : 'text-slate-400'}`}>{nlGateway ? 'On' : 'Off'}</span>
                    <Toggle checked={nlGateway} busy={busyKey === 'nl-gateway'} onClick={toggleNlGateway} label="Natural-language chat" tone="emerald" />
                </div>
            </div>

            {([
                { key: 'neverSilent', title: 'Never silent', body: 'If the bot does not reply to a Task Manager message, the person gets one short "Sorry, please try again" at the next 15-minute check. No message text is stored. Needs SQL file 20261011000001 run once.' },
                { key: 'frontDoor', title: 'One front door', body: 'For Smart-chat departments: "done 2" / "done all" / "tasks" answered instantly without AI, "undo" within 10 minutes, and a short help line instead of the 1 / 2 menu when the AI is down. No SQL file needed.' },
                { key: 'teamReports', title: 'Team reports', body: 'In Smart chat, managers (anyone who can give work to others) can ask "how is my team doing today?" — done / in progress / overdue for the people they may already see. Read-only. No SQL file needed.' },
                { key: 'conversationMemory', title: 'Conversation memory', body:'The AI remembers the last 20 messages of each chat for 24 hours, so "make it tomorrow" or "the second one" are understood. Nobody can see them in the app. Needs SQL file 20261011000002 run once.' },
                { key: 'learningLoop', title: 'Learning loop', body: 'Capture likely mistakes for admin review and permanent live test cases. Needs SQL file 20261011000003 run once.' },
                { key: 'promptVersions', title: 'Prompt versions', body: 'Use approved tunable instruction versions without redeploying. Locked safety rules remain in code.' },
                { key: 'voiceNotes', title: 'Voice notes', body: 'Everyone using the Task Manager can send a WhatsApp voice note instead of typing: it is turned into text and handled like a typed message (changes still need YES). Sandbox ON → only sandbox numbers. No SQL needed.' },
                { key: 'nightlyAutoTune', title: 'Nightly auto-tune', body: 'After 02:00 IST, draft and safety-test one candidate only when new labelled cases exist. Never auto-activates.' },
            ] as const).map(f => (
                <div key={f.key} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <p className="font-black text-slate-900">{f.title} <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700">WhatsApp bot</span></p>
                        <p className="text-slate-600">{f.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                        <span className={`text-[10px] font-black uppercase tracking-wider ${botFeatures[f.key] ? 'text-emerald-700' : 'text-slate-400'}`}>{botFeatures[f.key] ? 'On' : 'Off'}</span>
                        <Toggle checked={botFeatures[f.key]} busy={busyKey === `bot-${f.key}`} onClick={() => toggleBotFeature(f.key)} label={f.title} tone="emerald" />
                    </div>
                </div>
            ))}

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
                        <div key={d.departmentId} className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                            {/* Owner 2026-10-27: the department, its master switch, then its settings in three tidy groups */}
                            <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap bg-slate-50/70 border-b border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => toggleExpanded(d.departmentId)}
                                    aria-expanded={isOpen}
                                    className="flex items-center gap-2 text-left cursor-pointer min-w-0"
                                    title={isOpen ? 'Hide people' : 'Show people'}
                                >
                                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                                    <span className="text-sm font-bold text-slate-900">{d.name}</span>
                                    <span className="text-[11px] text-slate-500">{d.onboardedCount} of {d.memberCount} kickoff sent</span>
                                    {noneUnlocked && (
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                                            ON, but nobody is unlocked yet
                                        </span>
                                    )}
                                </button>
                                <div className="flex items-center gap-2.5">
                                    <span className={`flex items-center gap-1 text-[11px] font-black uppercase tracking-wider ${d.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                                        {d.enabled ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                        Task Manager {d.enabled ? 'on' : 'off'}
                                    </span>
                                    <Toggle checked={d.enabled} disabled={!provisioned} busy={busy} onClick={() => toggleDepartment(d)} label={`Task Manager for ${d.name}`} tone="emerald" />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-x-6 px-4 py-2 md:grid-cols-2 xl:grid-cols-3">
                                {([
                                    {
                                        title: 'WhatsApp',
                                        rows: [
                                            { key: 'smart', label: 'Smart chat', hint: 'Talk to the Task Manager in plain language', on: d.smartChatEnabled, disabled: !provisioned || smartChatColumnMissing, onToggle: () => toggleSmartChat(d) },
                                            { key: 'import', label: 'Task import', hint: 'Send a task list (Excel, image, text) to save it', on: d.taskImportEnabled, disabled: !provisioned || taskImportColumnMissing, onToggle: () => toggleTaskImport(d) },
                                        ],
                                    },
                                    {
                                        title: 'Team & sharing',
                                        rows: [
                                            { key: 'share', label: 'Team sharing', hint: "Members see and assign each other's tasks", on: d.peerAssign, disabled: !provisioned || sharingColumnMissing, onToggle: () => toggleTeamSharing(d) },
                                            { key: 'assign', label: 'Assign to anyone in team', hint: 'Give tasks to anyone in the team, manager included', on: d.teamAssign === true, disabled: !provisioned || teamAssignColumnMissing, onToggle: () => toggleTeamAssign(d) },
                                            { key: 'cross_dept_collab', label: 'Work with other departments', hint: 'Give tasks, ask for support and work together across teams', on: featureValue(d, 'cross_dept_collab'), disabled: !provisioned || crossDeptColumnMissing, onToggle: () => toggleTeamFeature(d, 'cross_dept_collab') },
                                            { key: 'collab', label: 'Send tasks to a superuser', hint: 'Give tasks and reminders to a superuser above them', on: d.superuserCollabEnabled, disabled: !provisioned || collabColumnMissing, onToggle: () => toggleSuperuserCollab(d) },
                                            { key: 'notif', label: 'Team manages notifications', hint: 'Set its own message times and wording', on: d.notificationsDelegated, disabled: !provisioned || notificationsColumnMissing, onToggle: () => toggleNotificationsDelegated(d) },
                                        ],
                                    },
                                    {
                                        title: 'Task features',
                                        rows: [
                                            { key: 'pending_on', label: 'Pending on', hint: 'Tell a colleague a task is waiting on them', on: featureValue(d, 'pending_on'), disabled: !provisioned || teamFeaturesColumnMissing, onToggle: () => toggleTeamFeature(d, 'pending_on') },
                                            { key: 'protect_given', label: 'Protect given tasks', hint: 'The holder cannot delete or rename a given task', on: featureValue(d, 'protect_given'), disabled: !provisioned || teamFeaturesColumnMissing, onToggle: () => toggleTeamFeature(d, 'protect_given') },
                                            { key: 'assigned_tab', label: 'Assigned by me', hint: 'A tab with every task they gave, and its status', on: featureValue(d, 'assigned_tab'), disabled: !provisioned || teamFeaturesColumnMissing, onToggle: () => toggleTeamFeature(d, 'assigned_tab') },
                                            { key: 'due_dates', label: 'Due dates', hint: 'Deadlines, countdown, a reminder and on-time tracking', on: featureValue(d, 'due_dates'), disabled: !provisioned || dueDatesColumnMissing, onToggle: () => toggleTeamFeature(d, 'due_dates') },
                                        ],
                                    },
                                ]).map(group => (
                                    <section key={group.title} className="py-1" aria-label={`${d.name}: ${group.title}`}>
                                        <p className="pt-2 pb-0.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{group.title}</p>
                                        <div className="divide-y divide-slate-100">
                                            {group.rows.map(r => (
                                                <React.Fragment key={r.key}>
                                                    <SettingRow label={r.label} hint={r.hint} checked={r.on} disabled={r.disabled} busy={busyKey === `${r.key}-${d.departmentId}`} onToggle={r.onToggle} />
                                                    {/* Owner 2026-10-27: who may send, under the department switch (only while it is ON) */}
                                                    {r.key === 'cross_dept_collab' && r.on && (
                                                        <div className="pb-2 pl-3">
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Who can send</p>
                                                            <div className="mt-1 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={`${d.name}: who can send to other departments`}>
                                                                {([['everyone', 'Everyone'], ['selected', 'Only selected people']] as const).map(([value, text]) => {
                                                                    const on = (d.crossDeptScope ?? 'everyone') === value;
                                                                    return (
                                                                        <button
                                                                            key={value} type="button" role="radio" aria-checked={on}
                                                                            disabled={!provisioned || crossDeptScopeColumnMissing || busyKey === `scope-${d.departmentId}`}
                                                                            onClick={() => setCrossDeptScope(d, value)}
                                                                            className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                                                                        >
                                                                            {text}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                            {d.crossDeptScope === 'selected' && (
                                                                <p className="mt-1 text-[11px] text-slate-500">
                                                                    {d.members.filter(x => x.crossDeptAllowed).length} of {d.members.length} ticked · tick people in the list below. Everyone can still receive.
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </section>
                                ))}
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
                                                {/* Owner 2026-10-27: "Only selected people" — this person may send to other departments */}
                                                {provisioned && d.crossDeptCollab !== false && d.crossDeptScope === 'selected' && (
                                                    <label className="mr-3 flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-slate-700">
                                                        <input
                                                            type="checkbox" checked={m.crossDeptAllowed === true}
                                                            disabled={busyKey === `xperson-${m.userId}`}
                                                            onChange={() => toggleCrossDeptPerson(m)}
                                                            className="h-3.5 w-3.5 cursor-pointer accent-indigo-600 disabled:opacity-50"
                                                        />
                                                        Can send to other departments
                                                    </label>
                                                )}
                                                {provisioned && m.taskRole !== 'superuser' && (
                                                    <button
                                                        type="button"
                                                        disabled={busyKey === `manager-${m.userId}`}
                                                        onClick={() => toggleManager(m)}
                                                        className={`text-[11px] font-bold underline cursor-pointer disabled:opacity-50 mr-3 ${m.taskRole === 'reporting_manager' ? 'text-rose-600 hover:text-rose-800' : 'text-emerald-700 hover:text-emerald-900'}`}
                                                    >
                                                        {m.taskRole === 'reporting_manager' ? 'Remove manager' : 'Make manager'}
                                                    </button>
                                                )}
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
