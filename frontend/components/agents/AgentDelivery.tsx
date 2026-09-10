'use client';

/**
 * DELIVERY — who this agent mails, and where replies come back.
 *
 * Everything here lives in oem_agents.runtime, so it is per-agent and per-org
 * and changes without a deploy. It replaces IRA_FROM_EMAIL / IRA_REPLY_TO /
 * IRA_SPOC_EMAIL in env, and the literal 'saniel@worksquare.in' still sitting in
 * dailyDigest.ts.
 *
 * The one rule this screen enforces visibly: REPLY-TO MUST BE A MAILBOX THE
 * POLLER READS. An agent that sends from an address nobody polls looks healthy
 * and silently loses every answer — which is exactly what was happening.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Inbox, Loader2, MapPin, Users } from 'lucide-react';
import SiteOwnersBuilder from './SiteOwnersBuilder';
import MailAccounts from './MailAccounts';

type Role = 'ceo' | 'procurement' | 'technical';

interface Runtime {
    inbox?: { from?: string; reply_to?: string; poll_address?: string; poll_addresses?: string[]; lookback_hours?: number };
    recipients?: { roles?: Partial<Record<Role, string[]>>; sites?: Record<string, string[]> };
    respond?: { enabled?: boolean; on?: Array<'need_info' | 'blocked'> };
}

const ROLES: Array<{ key: Role; label: string; hint: string }> = [
    { key: 'ceo', label: 'People who decide', hint: 'Gets the things that need a decision. Never a to-do list.' },
    { key: 'procurement', label: 'People who fix it', hint: 'Does the work and marks it done. Usually Vidya, Sahil, purchase@' },
    { key: 'technical', label: 'IT / technical', hint: 'Only hears about it when the problem is with the system or the data.' },
];

const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const join = (a?: string[]) => (a ?? []).join(', ');

export default function AgentDelivery({
    orgId, agentKey, runtime, onSaved,
}: {
    orgId: string; agentKey: string; runtime: Runtime; onSaved?: () => void;
}) {
    const [draft, setDraft] = useState<Runtime>(runtime);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    /**
     * Re-seed from the server ONLY when the value genuinely changed.
     *
     * The parent passes `runtime={selected.runtime ?? {}}`, which is a NEW object
     * on every render. Depending on its identity meant the effect fired
     * constantly and reset `draft` mid-typing — every field emptied the moment
     * you moved to the next one. Compare by value instead.
     */
    const lastSeen = useRef<string>(JSON.stringify(runtime ?? {}));
    useEffect(() => {
        const incoming = JSON.stringify(runtime ?? {});
        if (incoming === lastSeen.current) return;
        lastSeen.current = incoming;
        setDraft(runtime);
    }, [runtime]);

    const inbox = draft.inbox ?? {};
    const roles = draft.recipients?.roles ?? {};
    const sites = draft.recipients?.sites ?? {};

    /** The failure that silently loses replies. Surfaced, not buried. */
    // Every mailbox the poller reads. Older configs have one `poll_address`;
    // both shapes are honoured and shown as one list.
    const pollList = useMemo(() => {
        const list = [...(inbox.poll_addresses ?? []), ...(inbox.poll_address ? [inbox.poll_address] : [])]
            .map((x) => x.trim().toLowerCase()).filter(Boolean);
        return Array.from(new Set(list));
    }, [inbox.poll_addresses, inbox.poll_address]);

    const replyMismatch = useMemo(() => {
        const r = (inbox.reply_to ?? '').trim().toLowerCase();
        return Boolean(r && pollList.length && !pollList.includes(r));
    }, [inbox.reply_to, pollList]);

    const setInbox = (k: keyof NonNullable<Runtime['inbox']>, v: string) =>
        setDraft((d) => ({ ...d, inbox: { ...(d.inbox ?? {}), [k]: v || undefined } }));

    const setRole = (r: Role, v: string) =>
        setDraft((d) => ({
            ...d,
            recipients: { ...(d.recipients ?? {}), roles: { ...(d.recipients?.roles ?? {}), [r]: split(v) } },
        }));

    const save = async () => {
        setSaving(true); setError(null); setSaved(false);
        try {
            const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'upsert', agent_key: agentKey, runtime: draft }),
            });
            const json = await res.json();
            if (json.error) { setError(json.error); return; }
            setSaved(true);
            onSaved?.();
        } catch (e) { setError((e as Error).message); }
        finally { setSaving(false); }
    };

    const field = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] focus:border-primary/40 focus:outline-none';
    const label = 'block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5';

    return (
        <div className="flex flex-col gap-4">
            <MailAccounts orgId={orgId} />

            {/* ---- mailboxes ------------------------------------------------ */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <h4 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Inbox className="h-3.5 w-3.5" /> Email addresses
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                    <div>
                        <label className={label}>Ira sends her email from</label>
                        <input className={field} value={inbox.from ?? ''} placeholder="ira.mehta@worksquare.in"
                            onChange={(e) => setInbox('from', e.target.value)} />
                    </div>
                    <div>
                        <label className={label}>When someone hits Reply, it goes to</label>
                        <input className={field} value={inbox.reply_to ?? ''} placeholder="purchase@worksquare.in"
                            onChange={(e) => setInbox('reply_to', e.target.value)} />
                    </div>
                    <div>
                        <label className={label}>Inboxes Ira checks for replies</label>
                        <textarea rows={2} className={`${field} font-mono text-[12px]`}
                            value={join(pollList)}
                            placeholder={'purchase@worksquare.in, support@worksquare.in'}
                            onChange={(e) => setDraft((d) => ({
                                ...d,
                                inbox: { ...(d.inbox ?? {}), poll_addresses: split(e.target.value), poll_address: undefined },
                            }))} />
                        <p className="mt-1 text-[10.5px] text-text-tertiary">
                            Separate them with commas. Ira needs access to each one. A reply sent to any of
                            these will reach her.
                        </p>
                    </div>
                    <div>
                        <label className={label}>How far back she looks for replies (hours)</label>
                        <input className={field} type="number" min={1} max={168} value={inbox.lookback_hours ?? 24}
                            onChange={(e) => setDraft((d) => ({ ...d, inbox: { ...(d.inbox ?? {}), lookback_hours: Number(e.target.value) || 24 } }))} />
                    </div>
                </div>

                {replyMismatch && (
                    <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <p className="text-[11.5px] leading-relaxed text-amber-800">
                            These two are different. Ira asks people to reply to the first address,
                            but she only reads the mailboxes listed — so every answer lands somewhere nobody
                            opens and is lost silently. Make them the same address.
                        </p>
                    </div>
                )}
            </section>

            {/* ---- recipients ----------------------------------------------- */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Users className="h-3.5 w-3.5" /> Who gets the email
                </h4>
                <p className="mb-3 text-[11.5px] text-text-secondary">
                    Everyone gets only the part that is theirs to act on. If there is nothing for someone,
                    they get no email at all.
                </p>
                <div className="space-y-3">
                    {ROLES.map((r) => (
                        <div key={r.key}>
                            <label className={label}>{r.label}</label>
                            <input className={field} value={join(roles[r.key])} placeholder="name@worksquare.in, other@worksquare.in"
                                onChange={(e) => setRole(r.key, e.target.value)} />
                            <p className="mt-1 text-[11px] text-text-tertiary">{r.hint}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ---- site overrides ------------------------------------------- */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <MapPin className="h-3.5 w-3.5" /> Send a separate email per city <span className="font-normal normal-case tracking-normal text-text-tertiary">— optional</span>
                </h4>
                <p className="mb-3 text-[11.5px] leading-relaxed text-text-secondary">
                    Instead of one long email covering everywhere, Ira sends a shorter one per city, with the
                    city and the owner&rsquo;s name at the top. They can all go to the same shared inbox — it is
                    the name at the top, not the address, that tells someone the email is theirs.
                    <br />
                    Sites in <b>green</b> already belong to a city. Sites in <b>amber</b> do not, so they all
                    arrive together in one &ldquo;Unassigned&rdquo; email until you add them to a city below.
                </p>
                <SiteOwnersBuilder
                    orgId={orgId}
                    value={sites}
                    defaultEmail={(roles.procurement ?? [])[0] ?? inbox.reply_to ?? ''}
                    onChange={(map) => setDraft((d) => ({ ...d, recipients: { ...(d.recipients ?? {}), sites: map } }))}
                />
            </section>

            {/* ---- respond --------------------------------------------------- */}
            <section className="rounded-[14px] border border-border bg-card p-4">
                <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={draft.respond?.enabled ?? false}
                        onChange={(e) => setDraft((d) => ({ ...d, respond: { ...(d.respond ?? {}), enabled: e.target.checked } }))} />
                    <span>
                        <span className="block text-[12.5px] font-semibold">Let Ira reply when someone asks her a question</span>
                        <span className="block text-[11.5px] leading-relaxed text-text-secondary">
                            If someone replies asking &ldquo;which PO is this?&rdquo; or &ldquo;what is it waiting
                            on?&rdquo;, Ira sends the details back once and then leaves it to a person. Switched off,
                            their question gets no reply at all.
                        </span>
                    </span>
                </label>
            </section>

            <div className="flex items-center gap-3">
                <button type="button" onClick={() => void save()} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[12px] font-semibold text-background disabled:opacity-40">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
                    {saving ? 'Saving…' : saved ? 'Saved' : 'Save delivery'}
                </button>
                {error && <span className="text-[11.5px] text-rose-600">{error}</span>}
            </div>
        </div>
    );
}
