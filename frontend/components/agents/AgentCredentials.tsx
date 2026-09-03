'use client';

/**
 * AGENT CREDENTIALS + RUNTIME — the sandbox.
 * =============================================================================
 * "Agents can be configured in real time by anybody. You do not need to be a
 *  specialist."
 *
 * Everything that decides whether an agent can run, when it runs, and how much
 * damage it is allowed to do, edited from a screen instead of from a deploy.
 *
 * PANEL 1 — CREDENTIALS. Four slots: llm, voice, whatsapp, telephony. For each
 * one the operator sees provider, whether it is configured, where the value
 * comes from, and the last four characters. Never the secret. There is no
 * reveal control on this screen because there is no reveal path in the API:
 * /api/agents/credentials selects an explicit column allowlist that does not
 * contain the ciphertext, so a secret cannot arrive in this component even by
 * accident.
 *
 * Two ways to supply a key are offered, and the env-var path is recommended in
 * plain words rather than by a badge nobody reads: storing the NAME of a server
 * variable keeps the secret out of the database, out of backups and out of
 * replicas, and turns rotation into a server setting instead of a re-entry.
 * When the server refuses a pasted key because AGENT_SECRET_KEY is unset, the
 * API's message is surfaced EXACTLY as written — it explains the fix, and
 * paraphrasing it would lose that.
 *
 * PANEL 2 — RUNTIME. oem_agents.runtime, edited as controls rather than as a
 * JSON blob: a cron field with a plain-English preview underneath it, timezone,
 * quiet hours, heartbeat interval, a daily run cap, a daily rupee cap, a
 * timeout, and autonomy.
 *
 * AUTONOMY IS NOT A CHECKBOX. It is the difference between an agent that writes
 * a suggestion and an agent that picks up the phone, and it is drawn as two
 * large mutually exclusive cards with a sentence of consequence on each. Every
 * other control on this screen changes how often something happens; this one
 * changes whether it happens to the real business.
 *
 * DRY RUN is a PREFLIGHT, not a simulated execution. It runs a fixed list of
 * checks that this screen can actually answer — is the agent in the registry,
 * is there a language-model key and is the env var it names actually set, does
 * the department map to a canonical module slug, does the cron parse, are the
 * runtime edits on screen saved — and records the result as ONE COMPLETED run.
 *
 * It is recorded with trigger 'shadow' and a TERMINAL status ('succeeded' when
 * every check passed, 'skipped' when one did not). It never posts status
 * 'running'. That is deliberate and it is load-bearing:
 *
 *   - a run left open counts as in-flight forever, which drags the agent's
 *     reliability score down permanently for a button that ran no agent;
 *   - the activity feed polls while anything is running, so an unclosed run is
 *     an unstoppable poll;
 *   - the module pulse strip shows the newest run as "last activity", so an
 *     unclosed dry run becomes the agent's permanent last known act.
 *
 * The run writes nothing to any business table, calls no model, and sends
 * nothing. `module` is written as a CANONICAL SLUG via normalizeModule() —
 * oem_agents.department is human prose ('Procurement', 'Front Desk') and would
 * never match a pulse filter on 'procurement'. Unmappable prose is written as
 * null (unassigned), never guessed.
 *
 * Degrades calmly: every read tolerates { provisioned: false } and says which
 * migration is missing instead of rendering an error.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, Check, ChevronDown, Clock, Eye, FlaskConical, Hand,
    KeyRound, Loader2, Lock, Moon, RefreshCw, Save, Server, ShieldCheck, Timer,
    Trash2, Wand2, X, Zap,
} from 'lucide-react';
import {
    AGENT_CREDENTIAL_PURPOSES,
    AGENT_RUNTIME_MIGRATION,
    normalizeModule,
    type AgentAutonomy,
    type AgentCredentialPurpose,
    type AgentRuntimeConfig,
} from '@/frontend/types/agentRuntime';
import AgentRunTrace from './AgentRunTrace';

/* ========================================================================== */
/* Shapes returned by the API (masked — no secret ever appears here)          */
/* ========================================================================== */

interface MaskedCredential {
    id: string;
    agent_key: string;
    purpose: AgentCredentialPurpose;
    provider: string | null;
    configured: boolean;
    /** 'env' when the value is an environment variable NAME, 'stored' when encrypted. */
    source: 'env' | 'stored' | null;
    secret_ref: string | null;
    /**
     * Whether that env var is actually set on this server. null means NOT
     * ANSWERED — the name is outside the closed set the API will report on —
     * and must never be rendered as "present".
     */
    env_present: boolean | null;
    /**
     * Whether secret_ref names a variable this feature actually reads. A legacy
     * row can say `configured: true` while pointing at a name the runtime will
     * refuse, which is a green chip over a dead credential.
     */
    env_ref_accepted?: boolean | null;
    /**
     * Why `configured` is false on a row that plainly has something in it — a
     * legacy pasted key, a name outside the allowlist, an unset variable. The
     * API populates this ONLY when `configured` is false, and it is the whole
     * difference between "nobody has set this up" and "somebody set it up and
     * it cannot be read". Rendering a bare "Not configured" over the second
     * case sends an operator hunting through server logs for an answer the
     * response already carried.
     */
    unreadable_reason?: string | null;
    last4: string | null;
    meta: Record<string, unknown>;
    updated_at: string;
    updated_by: string | null;
}

interface CredentialsResponse {
    provisioned: boolean;
    credentials?: MaskedCredential[];
    can_write?: boolean;
    error?: string;
}

interface RegistryAgent {
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    runtime: AgentRuntimeConfig | null;
    [k: string]: unknown;
}

interface RegistryResponse {
    provisioned: boolean;
    runtime_provisioned?: boolean;
    agents?: RegistryAgent[];
    error?: string;
}

export interface AgentCredentialsProps {
    orgId: string | null | undefined;
    agentKey: string;
    className?: string;
}

/* ========================================================================== */
/* Credential slot metadata — what each key actually buys, in plain words      */
/* ========================================================================== */

interface MetaField {
    key: string;
    label: string;
    placeholder: string;
    hint?: string;
}

const PURPOSE_META: Record<
    AgentCredentialPurpose,
    {
        label: string;
        blurb: string;
        consequence: string;
        providers: string[];
        envExample: string;
        metaFields: MetaField[];
        Icon: React.ElementType;
    }
> = {
    llm: {
        label: 'Language model',
        blurb: 'The reasoning engine. This is the key the agent thinks with.',
        consequence: 'Without it every run stops immediately and the heartbeat reports llm_key_missing.',
        providers: ['anthropic', 'openai', 'openrouter', 'groq', 'together'],
        envExample: 'ANTHROPIC_API_KEY',
        metaFields: [
            { key: 'base_url', label: 'Base URL', placeholder: 'https://api.anthropic.com', hint: 'Only needed for a proxy or a self-hosted gateway.' },
            { key: 'model', label: 'Default model', placeholder: 'claude-sonnet-4-5' },
        ],
        Icon: Wand2,
    },
    voice: {
        label: 'Voice',
        blurb: 'Speech synthesis for outbound calls and voice notes.',
        consequence: 'Without it the agent can still call, but it will have nothing to say.',
        providers: ['elevenlabs', 'bolna', 'deepgram', 'cartesia'],
        envExample: 'ELEVENLABS_API_KEY',
        metaFields: [
            { key: 'voice_id', label: 'Voice ID', placeholder: 'e.g. 21m00Tcm4TlvDq8ikWAM' },
        ],
        Icon: Zap,
    },
    whatsapp: {
        label: 'WhatsApp',
        blurb: 'Sending and receiving WhatsApp messages on the organisation number.',
        consequence: 'Without it vendor and staff follow-ups queue but never leave.',
        providers: ['meta', 'gupshup', 'twilio', 'wati'],
        envExample: 'WHATSAPP_TOKEN',
        metaFields: [
            { key: 'from_number', label: 'From number', placeholder: '+91…' },
            { key: 'phone_number_id', label: 'Phone number ID', placeholder: 'Provider-issued id' },
        ],
        Icon: Server,
    },
    telephony: {
        label: 'Telephony',
        blurb: 'Placing and receiving calls.',
        consequence: 'This key dials from your own number — treat a leak here as a billing and reputation incident, not just a technical one.',
        providers: ['bolna', 'plivo', 'twilio', 'exotel'],
        envExample: 'BOLNA_API_KEY',
        metaFields: [
            { key: 'from_number', label: 'From number', placeholder: '+91…' },
            { key: 'agent_id', label: 'Provider agent ID', placeholder: 'Bolna / Plivo agent id' },
        ],
        Icon: KeyRound,
    },
};

/* ========================================================================== */
/* Cron → plain English                                                        */
/* ========================================================================== */

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TZ_CHOICES: { value: string; label: string }[] = [
    { value: 'Asia/Kolkata', label: 'India — IST (Asia/Kolkata)' },
    { value: 'Asia/Dubai', label: 'Gulf — GST (Asia/Dubai)' },
    { value: 'Asia/Singapore', label: 'Singapore — SGT' },
    { value: 'Europe/London', label: 'United Kingdom' },
    { value: 'America/New_York', label: 'US Eastern' },
    { value: 'UTC', label: 'UTC' },
];

const TZ_SHORT: Record<string, string> = {
    'Asia/Kolkata': 'IST',
    'Asia/Dubai': 'GST',
    'Asia/Singapore': 'SGT',
    'Europe/London': 'UK time',
    'America/New_York': 'US Eastern',
    UTC: 'UTC',
};

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function listOf(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Describes the common shapes an operator actually types. Deliberately returns
 * null rather than guessing on anything exotic: a WRONG plain-English preview
 * is far worse than no preview, because it is the only thing standing between
 * "every day at 09:30" and "every minute of the ninth hour".
 */
function describeCron(expr: string, tz: string): string | null {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const [min, hour, dom, mon, dow] = fields;

    const isInt = (s: string) => /^\d{1,2}$/.test(s);
    const stepOf = (s: string) => {
        const m = /^\*\/(\d{1,2})$/.exec(s);
        return m ? Number(m[1]) : null;
    };
    const suffix = TZ_SHORT[tz] ? ` ${TZ_SHORT[tz]}` : tz ? ` (${tz})` : '';

    // ---- Which days
    let dayPart: string | null = null;
    if (mon !== '*') return null;
    if (dom === '*' && dow === '*') dayPart = 'every day';
    else if (dom === '*' && dow === '1-5') dayPart = 'every weekday';
    else if (dom === '*' && (dow === '0,6' || dow === '6,0')) dayPart = 'every Saturday and Sunday';
    else if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
        dayPart = `every ${listOf(dow.split(',').map((d) => DOW_NAMES[Number(d)]))}`;
    } else if (isInt(dom) && dow === '*') {
        dayPart = `on day ${Number(dom)} of every month`;
    } else {
        return null;
    }

    const everyDay = dayPart === 'every day';

    // ---- Which minutes and hours
    if (isInt(min) && isInt(hour)) {
        const h = Number(hour);
        const m = Number(min);
        if (h > 23 || m > 59) return null;
        return `${dayPart} at ${pad2(h)}:${pad2(m)}${suffix}`;
    }

    const minStep = stepOf(min);
    if (minStep && minStep > 0 && hour === '*') {
        return everyDay ? `every ${minStep} minutes` : `every ${minStep} minutes, ${dayPart}`;
    }

    const hourStep = stepOf(hour);
    if (isInt(min) && hourStep && hourStep > 0) {
        const at = `every ${hourStep} hours at :${pad2(Number(min))}`;
        return everyDay ? `${at}${suffix}` : `${at}, ${dayPart}${suffix}`;
    }

    if (isInt(min) && hour === '*') {
        const at = `every hour at :${pad2(Number(min))}`;
        return everyDay ? at : `${at}, ${dayPart}`;
    }

    if (min === '*' && hour === '*') return everyDay ? 'every minute' : `every minute, ${dayPart}`;

    return null;
}

const CRON_PRESETS: { cron: string; label: string }[] = [
    { cron: '*/30 * * * *', label: 'Every 30 minutes' },
    { cron: '0 * * * *', label: 'Hourly' },
    { cron: '30 9 * * 1-5', label: 'Weekdays 09:30' },
    { cron: '0 6 * * *', label: 'Daily 06:00' },
    { cron: '0 18 * * *', label: 'Daily 18:00' },
];

const HEARTBEAT_CHOICES = [
    { value: 60, label: 'Every minute' },
    { value: 300, label: 'Every 5 minutes' },
    { value: 900, label: 'Every 15 minutes' },
    { value: 3600, label: 'Every hour' },
];

/* ========================================================================== */
/* Small shared bits                                                           */
/* ========================================================================== */

function Field({
    label,
    hint,
    children,
    error,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
    error?: string | null;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                {label}
            </span>
            {children}
            {error ? (
                <span className="mt-1 block text-[11px] font-medium text-red-600">{error}</span>
            ) : hint ? (
                <span className="mt-1 block text-[11px] text-text-tertiary">{hint}</span>
            ) : null}
        </label>
    );
}

const INPUT_CLASS =
    'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-text-tertiary focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-text-tertiary';

function NotProvisioned({ what }: { what: string }) {
    return (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-card-tint px-4 py-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
            <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Not provisioned yet</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                    {what} becomes editable once migration{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-text-secondary">
                        {AGENT_RUNTIME_MIGRATION}
                    </code>{' '}
                    has been applied. Nothing is broken — the tables simply are not there yet.
                </p>
            </div>
        </div>
    );
}

/* ========================================================================== */
/* Component                                                                   */
/* ========================================================================== */

export default function AgentCredentials({ orgId, agentKey, className = '' }: AgentCredentialsProps) {
    const [loading, setLoading] = useState(true);
    const [creds, setCreds] = useState<CredentialsResponse | null>(null);
    const [registry, setRegistry] = useState<RegistryResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!orgId) return;
        setLoadError(null);
        try {
            const qp = `orgId=${encodeURIComponent(orgId)}`;
            const [cRes, rRes] = await Promise.all([
                fetch(`/api/agents/credentials?${qp}&agentKey=${encodeURIComponent(agentKey)}`),
                fetch(`/api/agents/registry?${qp}`),
            ]);
            const [cJson, rJson] = await Promise.all([
                cRes.json().catch(() => null),
                rRes.json().catch(() => null),
            ]);
            if (cJson) setCreds(cJson as CredentialsResponse);
            if (rJson) setRegistry(rJson as RegistryResponse);
            if (!cJson && !rJson) setLoadError('Could not reach the agent APIs.');
        } catch (e) {
            setLoadError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [orgId, agentKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const agent = useMemo(
        () => (registry?.agents ?? []).find((a) => a.agent_key === agentKey) ?? null,
        [registry, agentKey],
    );

    const credsProvisioned = creds?.provisioned !== false;
    const runtimeProvisioned =
        registry?.provisioned !== false && registry?.runtime_provisioned !== false;
    const canWrite = creds?.can_write !== false;

    if (!orgId) {
        return (
            <div className={className}>
                <NotProvisioned what="The agent sandbox" />
            </div>
        );
    }

    if (loading) {
        return (
            <div className={`flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-6 text-sm text-text-secondary ${className}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading the sandbox…
            </div>
        );
    }

    return (
        <div className={`space-y-5 ${className}`}>
            {loadError && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{loadError}</span>
                </div>
            )}

            <CredentialsPanel
                orgId={orgId}
                agentKey={agentKey}
                provisioned={credsProvisioned}
                canWrite={canWrite}
                credentials={creds?.credentials ?? []}
                onChanged={load}
            />

            <RuntimePanel
                orgId={orgId}
                agentKey={agentKey}
                provisioned={runtimeProvisioned}
                agent={agent}
                // The dry-run preflight checks the credential slots. It reads the
                // same masked rows this screen already has — it does not re-fetch,
                // and there is no secret in them to read.
                credentials={creds?.credentials ?? []}
                credentialsProvisioned={credsProvisioned}
                onChanged={load}
            />
        </div>
    );
}

/* ========================================================================== */
/* PANEL 1 — Credentials                                                       */
/* ========================================================================== */

function CredentialsPanel({
    orgId,
    agentKey,
    provisioned,
    canWrite,
    credentials,
    onChanged,
}: {
    orgId: string;
    agentKey: string;
    provisioned: boolean;
    canWrite: boolean;
    credentials: MaskedCredential[];
    onChanged: () => void | Promise<void>;
}) {
    const [editing, setEditing] = useState<AgentCredentialPurpose | null>(null);

    const byPurpose = useMemo(() => {
        const m = new Map<AgentCredentialPurpose, MaskedCredential>();
        for (const c of credentials) m.set(c.purpose, c);
        return m;
    }, [credentials]);

    return (
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <KeyRound className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-foreground">Credentials</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        What this agent is allowed to spend and speak through. Secrets are never
                        shown here — only where the value comes from and its last four characters.
                    </p>
                </div>
                {!canWrite && (
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-text-tertiary">
                        View only
                    </span>
                )}
            </header>

            {!provisioned ? (
                <div className="p-5">
                    <NotProvisioned what="Agent credentials" />
                </div>
            ) : (
                <ul className="divide-y divide-border">
                    {AGENT_CREDENTIAL_PURPOSES.map((purpose) => (
                        <CredentialRow
                            key={purpose}
                            orgId={orgId}
                            agentKey={agentKey}
                            purpose={purpose}
                            credential={byPurpose.get(purpose) ?? null}
                            canWrite={canWrite}
                            open={editing === purpose}
                            onToggle={() => setEditing(editing === purpose ? null : purpose)}
                            onSaved={async () => {
                                setEditing(null);
                                await onChanged();
                            }}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

function SourceChip({ credential }: { credential: MaskedCredential | null }) {
    // No row at all: nothing has been set up. That is an ANSWER, and a calm one.
    if (!credential) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-text-tertiary">
                Not configured
            </span>
        );
    }

    // A row EXISTS and still resolves to nothing. The API says why in
    // `unreadable_reason`; dropping it here would flatten "never set up" and
    // "set up and broken" into one grey chip and hide the only actionable half.
    if (!credential.configured) {
        const why = credential.unreadable_reason ?? null;
        return (
            <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    why ? 'bg-amber-500/12 text-amber-700' : 'bg-muted text-text-tertiary'
                }`}
                title={why ?? undefined}
            >
                {why ? <AlertTriangle className="h-3 w-3" /> : null}
                {why ? 'Set, but unusable' : 'Not configured'}
            </span>
        );
    }

    if (credential.source === 'env') {
        // Three states, not two. `env_present: null` means the API declined to
        // answer for this name — showing that as green would be inventing a
        // pass, and showing it as red would be inventing a failure.
        const rejected = credential.env_ref_accepted === false;
        const missing = credential.env_present === false;
        const unknown = !rejected && credential.env_present === null;
        const bad = rejected || missing;

        const suffix = rejected
            ? ' — not a variable this feature reads'
            : missing
                ? ' — not set on server'
                : unknown
                    ? ' — presence not checked'
                    : '';

        return (
            <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    bad
                        ? 'bg-amber-500/12 text-amber-700'
                        : unknown
                            ? 'bg-muted text-text-secondary'
                            : 'bg-emerald-500/12 text-emerald-700'
                }`}
                title={
                    rejected
                        ? 'This row points at an environment variable outside the set agent credentials may reference, so the runtime will refuse it. Re-save the slot with one of the accepted names.'
                        : missing
                            ? 'The agent references this variable, but the server does not have it set.'
                            : unknown
                                ? 'This name is outside the set whose presence is reported, so whether it is set was not checked.'
                                : 'Read from a server environment variable. The secret is not in the database.'
                }
            >
                {bad || unknown ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                from env: {credential.secret_ref}
                {suffix}
            </span>
        );
    }

    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
            title="Encrypted and stored in the database."
        >
            <Lock className="h-3 w-3" />
            stored · ••••{credential.last4 ?? '????'}
        </span>
    );
}

function CredentialRow({
    orgId,
    agentKey,
    purpose,
    credential,
    canWrite,
    open,
    onToggle,
    onSaved,
}: {
    orgId: string;
    agentKey: string;
    purpose: AgentCredentialPurpose;
    credential: MaskedCredential | null;
    canWrite: boolean;
    open: boolean;
    onToggle: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const meta = PURPOSE_META[purpose];
    const { Icon } = meta;

    const [mode, setMode] = useState<'env' | 'paste'>('env');
    const [provider, setProvider] = useState('');
    const [secretRef, setSecretRef] = useState('');
    const [secret, setSecret] = useState('');
    const [metaValues, setMetaValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);

    // Seed the form from the masked row whenever the editor opens. The secret
    // box is ALWAYS empty: there is nothing on the server that could fill it.
    useEffect(() => {
        if (!open) return;
        setMode(credential?.source === 'stored' ? 'paste' : 'env');
        setProvider(credential?.provider ?? '');
        setSecretRef(credential?.secret_ref ?? '');
        setSecret('');
        const seeded: Record<string, string> = {};
        for (const f of meta.metaFields) {
            const v = credential?.meta?.[f.key];
            seeded[f.key] = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
        }
        setMetaValues(seeded);
        setError(null);
        setNotice(null);
        setConfirmClear(false);
    }, [open, credential, meta.metaFields]);

    const save = async () => {
        setError(null);
        setNotice(null);

        if (mode === 'env' && !secretRef.trim() && !credential?.configured) {
            setError('Enter the name of the environment variable that holds the key.');
            return;
        }
        if (mode === 'paste' && !secret.trim() && !credential?.configured) {
            setError('Paste the key, or switch to the environment-variable option.');
            return;
        }

        setSaving(true);
        try {
            const body: Record<string, unknown> = { agentKey, purpose };
            if (provider.trim()) body.provider = provider.trim().toLowerCase();

            const metaPatch: Record<string, unknown> = {};
            for (const f of meta.metaFields) {
                const v = metaValues[f.key]?.trim();
                if (v) metaPatch[f.key] = v;
            }
            if (Object.keys(metaPatch).length) body.meta = metaPatch;

            if (mode === 'env' && secretRef.trim()) body.secret_ref = secretRef.trim();
            if (mode === 'paste' && secret.trim()) body.secret = secret.trim();

            const res = await fetch(`/api/agents/credentials?orgId=${encodeURIComponent(orgId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

            if (!res.ok || !json) {
                // Surfaced verbatim. When AGENT_SECRET_KEY is unset the server's
                // message names the fix; rewording it would throw that away.
                setError((json?.error as string) || `Save failed (HTTP ${res.status}).`);
                return;
            }
            if (json.provisioned === false) {
                setError((json.reason as string) || 'Agent credentials are not provisioned yet.');
                return;
            }

            // The plaintext leaves this component the moment the request is
            // accepted. From here on only the mask exists.
            setSecret('');
            if (json.warning) setNotice(String(json.warning));
            await onSaved();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const clear = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/agents/credentials?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}&purpose=${purpose}`,
                { method: 'DELETE' },
            );
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (!res.ok) {
                setError((json?.error as string) || `Could not clear (HTTP ${res.status}).`);
                return;
            }
            setSecret('');
            await onSaved();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
            setConfirmClear(false);
        }
    };

    return (
        <li>
            <div className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-3.5 w-3.5 text-text-secondary" />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                        {credential?.provider && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                                {credential.provider}
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-secondary">{meta.blurb}</p>
                    {/*
                      * The chip alone can only carry this on hover, and the person who
                      * needs it most is reading, not hovering. `unreadable_reason` is set
                      * ONLY when a row exists and still resolves to nothing, so this line
                      * appears exactly in the case a bare "Not configured" would mislead.
                      */}
                    {credential && !credential.configured && credential.unreadable_reason && (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{credential.unreadable_reason}</span>
                        </p>
                    )}
                </div>

                <SourceChip credential={credential} />

                <button
                    type="button"
                    onClick={onToggle}
                    disabled={!canWrite}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    title={canWrite ? undefined : 'Changing a credential requires an organisation admin role.'}
                >
                    <span className="flex items-center gap-1">
                        {credential?.configured ? 'Change' : 'Set up'}
                        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                </button>
            </div>

            {open && (
                <div className="border-t border-border bg-card-tint px-5 py-4">
                    <p className="mb-3 flex items-start gap-2 text-xs text-text-secondary">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span>{meta.consequence}</span>
                    </p>

                    {/* ---- The two paths, with the recommendation spelled out. */}
                    <div className="grid gap-2.5 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setMode('env')}
                            className={`rounded-2xl border p-3 text-left transition-colors ${
                                mode === 'env'
                                    ? 'border-primary bg-primary/6 ring-2 ring-primary/15'
                                    : 'border-border bg-card hover:border-primary/30'
                            }`}
                        >
                            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                Point at a server variable
                                <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                    Safer
                                </span>
                            </span>
                            <span className="mt-1.5 block text-xs leading-relaxed text-text-secondary">
                                You save only the <em>name</em> of the variable. The key itself never
                                enters the database, so it cannot leak through a backup or a copy of
                                the data, and changing it later is a server setting rather than a
                                re-entry here.
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setMode('paste')}
                            className={`rounded-2xl border p-3 text-left transition-colors ${
                                mode === 'paste'
                                    ? 'border-primary bg-primary/6 ring-2 ring-primary/15'
                                    : 'border-border bg-card hover:border-primary/30'
                            }`}
                        >
                            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Lock className="h-4 w-4 text-text-secondary" />
                                Paste the key here
                            </span>
                            <span className="mt-1.5 block text-xs leading-relaxed text-text-secondary">
                                We encrypt it before saving, but from then on it does live in the
                                database. Use this when you cannot get a server variable set — it
                                works, it is simply the weaker of the two.
                            </span>
                        </button>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="Provider" hint={`Common: ${meta.providers.join(', ')}`}>
                            <input
                                className={INPUT_CLASS}
                                value={provider}
                                onChange={(e) => setProvider(e.target.value)}
                                placeholder={meta.providers[0]}
                                list={`providers-${purpose}`}
                                autoComplete="off"
                            />
                            <datalist id={`providers-${purpose}`}>
                                {meta.providers.map((p) => (
                                    <option key={p} value={p} />
                                ))}
                            </datalist>
                        </Field>

                        {mode === 'env' ? (
                            <Field
                                label="Environment variable name"
                                hint={`The NAME, not the key. For example ${meta.envExample}.`}
                            >
                                <input
                                    className={`${INPUT_CLASS} font-mono`}
                                    value={secretRef}
                                    onChange={(e) => setSecretRef(e.target.value.toUpperCase())}
                                    placeholder={meta.envExample}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </Field>
                        ) : (
                            <Field
                                label="Secret"
                                hint="Shown as dots as you type, sent once, and never returned to this screen."
                            >
                                <input
                                    className={`${INPUT_CLASS} font-mono`}
                                    type="password"
                                    value={secret}
                                    onChange={(e) => setSecret(e.target.value)}
                                    placeholder={credential?.configured ? 'Leave blank to keep the current key' : 'Paste the key'}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </Field>
                        )}

                        {meta.metaFields.map((f) => (
                            <Field key={f.key} label={f.label} hint={f.hint}>
                                <input
                                    className={INPUT_CLASS}
                                    value={metaValues[f.key] ?? ''}
                                    onChange={(e) =>
                                        setMetaValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                                    }
                                    placeholder={f.placeholder}
                                    autoComplete="off"
                                />
                            </Field>
                        ))}
                    </div>

                    {error && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/6 px-3 py-2 text-xs leading-relaxed text-red-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {notice && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{notice}</span>
                        </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save credential
                        </button>
                        <button
                            type="button"
                            onClick={onToggle}
                            className="rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-foreground"
                        >
                            Cancel
                        </button>

                        {credential?.configured && (
                            <div className="ml-auto flex items-center gap-2">
                                {confirmClear ? (
                                    <>
                                        <span className="text-xs text-text-secondary">
                                            Clear it? The agent stops on its next run.
                                        </span>
                                        <button
                                            type="button"
                                            onClick={clear}
                                            disabled={saving}
                                            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                                        >
                                            <Check className="h-3 w-3" /> Yes, clear
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConfirmClear(false)}
                                            className="rounded-lg border border-border px-2 py-1.5 text-xs text-text-secondary"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmClear(true)}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-red-500/40 hover:text-red-600"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" /> Clear
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </li>
    );
}

/* ========================================================================== */
/* PANEL 2 — Runtime                                                           */
/* ========================================================================== */

interface RuntimeDraft {
    schedule_cron: string;
    timezone: string;
    quiet_from: string;
    quiet_to: string;
    heartbeat_interval_sec: string;
    max_runs_per_day: string;
    max_cost_inr_per_day: string;
    timeout_sec: string;
    autonomy: AgentAutonomy;
}

function draftFrom(runtime: AgentRuntimeConfig | null | undefined): RuntimeDraft {
    const r = runtime ?? {};
    return {
        schedule_cron: r.schedule_cron ?? '',
        timezone: r.timezone ?? 'Asia/Kolkata',
        quiet_from: r.quiet_hours?.from ?? '',
        quiet_to: r.quiet_hours?.to ?? '',
        heartbeat_interval_sec: r.heartbeat_interval_sec != null ? String(r.heartbeat_interval_sec) : '300',
        max_runs_per_day: r.max_runs_per_day != null ? String(r.max_runs_per_day) : '',
        max_cost_inr_per_day: r.max_cost_inr_per_day != null ? String(r.max_cost_inr_per_day) : '',
        timeout_sec: r.timeout_sec != null ? String(r.timeout_sec) : '120',
        autonomy: r.autonomy === 'act' ? 'act' : 'suggest',
    };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/* --------------------------------------------------------------------------
 * DRY-RUN PREFLIGHT
 *
 * One check = one thing this screen can answer from data it already holds. No
 * check may be inferred, defaulted, or invented: a preflight that reports a
 * pass it did not perform is worse than no preflight, because it is believed.
 * ------------------------------------------------------------------------ */
interface DryCheck {
    label: string;
    /** false is a genuine blocker; the run is recorded as 'skipped'. */
    ok: boolean;
    detail: string;
}

/** What the operator is told, and what lands in the trace. Same words in both. */
interface DryRunResult {
    id: string | null;
    at: string;
    status: 'succeeded' | 'skipped';
    checks: DryCheck[];
    passed: number;
    /** The run landed but the steps table is not provisioned — there is no trace to open. */
    traceMissing: boolean;
}

function RuntimePanel({
    orgId,
    agentKey,
    provisioned,
    agent,
    credentials,
    credentialsProvisioned,
    onChanged,
}: {
    orgId: string;
    agentKey: string;
    provisioned: boolean;
    agent: RegistryAgent | null;
    credentials: MaskedCredential[];
    credentialsProvisioned: boolean;
    onChanged: () => void | Promise<void>;
}) {
    const [draft, setDraft] = useState<RuntimeDraft>(() => draftFrom(agent?.runtime));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
    const [dryRunning, setDryRunning] = useState(false);
    const [dryError, setDryError] = useState<string | null>(null);
    const [traceRunId, setTraceRunId] = useState<string | null>(null);

    const baseline = useMemo(() => draftFrom(agent?.runtime), [agent?.runtime]);

    useEffect(() => {
        setDraft(baseline);
    }, [baseline]);

    const dirty = useMemo(
        () => (Object.keys(baseline) as (keyof RuntimeDraft)[]).some((k) => baseline[k] !== draft[k]),
        [baseline, draft],
    );

    const set = <K extends keyof RuntimeDraft>(k: K, v: RuntimeDraft[K]) =>
        setDraft((d) => ({ ...d, [k]: v }));

    const cronPreview = draft.schedule_cron.trim()
        ? describeCron(draft.schedule_cron, draft.timezone)
        : null;

    const validate = (): string | null => {
        if (draft.schedule_cron.length > 120) return 'The cron expression is too long (120 characters max).';
        if (draft.quiet_from && !TIME_RE.test(draft.quiet_from)) return 'Quiet hours "from" must look like 22:00.';
        if (draft.quiet_to && !TIME_RE.test(draft.quiet_to)) return 'Quiet hours "to" must look like 07:00.';
        if (!!draft.quiet_from !== !!draft.quiet_to) return 'Set both ends of quiet hours, or neither.';

        const hb = Number(draft.heartbeat_interval_sec);
        if (draft.heartbeat_interval_sec && (!Number.isInteger(hb) || hb < 30 || hb > 86_400)) {
            return 'Heartbeat interval must be between 30 seconds and 24 hours.';
        }
        const to = Number(draft.timeout_sec);
        if (draft.timeout_sec && (!Number.isInteger(to) || to < 5 || to > 3_600)) {
            return 'Timeout must be between 5 seconds and 1 hour.';
        }
        const runs = Number(draft.max_runs_per_day);
        if (draft.max_runs_per_day && (!Number.isInteger(runs) || runs < 0 || runs > 10_000)) {
            return 'Runs per day must be a whole number between 0 and 10,000.';
        }
        const cost = Number(draft.max_cost_inr_per_day);
        if (draft.max_cost_inr_per_day && (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000)) {
            return 'The daily cost cap must be between ₹0 and ₹1,00,00,000.';
        }
        return null;
    };

    const save = async () => {
        setError(null);
        setSaved(null);
        const problem = validate();
        if (problem) {
            setError(problem);
            return;
        }
        if (!agent?.display_name) {
            setError('This agent is not in the registry yet, so its runtime cannot be saved.');
            return;
        }

        // Only fields the operator actually set are written, so an empty box
        // means "no limit" rather than a stored zero.
        const runtime: AgentRuntimeConfig = { autonomy: draft.autonomy };
        if (draft.schedule_cron.trim()) runtime.schedule_cron = draft.schedule_cron.trim();
        if (draft.timezone) runtime.timezone = draft.timezone;
        if (draft.quiet_from && draft.quiet_to) {
            runtime.quiet_hours = { from: draft.quiet_from, to: draft.quiet_to };
        }
        if (draft.heartbeat_interval_sec) runtime.heartbeat_interval_sec = Number(draft.heartbeat_interval_sec);
        if (draft.max_runs_per_day) runtime.max_runs_per_day = Number(draft.max_runs_per_day);
        if (draft.max_cost_inr_per_day) runtime.max_cost_inr_per_day = Number(draft.max_cost_inr_per_day);
        if (draft.timeout_sec) runtime.timeout_sec = Number(draft.timeout_sec);

        setSaving(true);
        try {
            const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'upsert',
                    agent_key: agentKey,
                    display_name: agent.display_name,
                    runtime,
                }),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (!res.ok || !json) {
                setError((json?.error as string) || `Save failed (HTTP ${res.status}).`);
                return;
            }
            if (json.provisioned === false) {
                setError(`Runtime settings need migration ${AGENT_RUNTIME_MIGRATION}.`);
                return;
            }
            setSaved(
                draft.autonomy === 'act'
                    ? 'Saved. This agent now acts on its own decisions from its next run.'
                    : 'Saved. This agent will propose and wait for a person.',
            );
            await onChanged();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    /**
     * The checks, computed from what this screen already holds. Kept separate
     * from the POST so the words the operator reads and the words in the trace
     * are literally the same strings.
     */
    const collectDryChecks = (): DryCheck[] => {
        const checks: DryCheck[] = [];

        // 1. Registry. Without a row here nothing else has anything to hang off.
        checks.push(
            agent?.display_name
                ? { label: 'Registry entry', ok: true, detail: `"${agent.display_name}" is registered as ${agentKey}.` }
                : { label: 'Registry entry', ok: false, detail: `${agentKey} is not in the agent registry, so it has no runtime to execute.` },
        );

        // 2. The language-model key. `configured` is the API's masked marker; for
        //    the env path it is only half the answer, because the variable it
        //    names can be absent from this server — env_present is that check.
        const llm = credentials.find((c) => c.purpose === 'llm') ?? null;
        if (!credentialsProvisioned) {
            checks.push({
                label: 'Language-model key',
                ok: false,
                detail: `Credential storage is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql. The key could not be checked.`,
            });
        } else if (!llm?.configured) {
            checks.push({
                label: 'Language-model key',
                ok: false,
                detail: 'No language-model credential is set, so every real run would stop at llm_key_missing.',
            });
        } else if (llm.source === 'env' && llm.env_ref_accepted === false) {
            checks.push({
                label: 'Language-model key',
                ok: false,
                detail: `Set to read from ${llm.secret_ref}, which is not one of the variables agent credentials may reference — the runtime will refuse it.`,
            });
        } else if (llm.source === 'env' && llm.env_present === false) {
            checks.push({
                label: 'Language-model key',
                ok: false,
                detail: `Set to read from ${llm.secret_ref}, but that variable is not set on this server.`,
            });
        } else if (llm.source === 'env' && llm.env_present === null) {
            checks.push({
                label: 'Language-model key',
                ok: false,
                detail: `Set to read from ${llm.secret_ref}, but whether that variable is set on this server was not checked — this preflight cannot confirm the key.`,
            });
        } else {
            checks.push({
                label: 'Language-model key',
                ok: true,
                detail: llm.source === 'env'
                    ? `Reads from the environment variable ${llm.secret_ref}, which is set on this server.`
                    : `An encrypted key is stored (ending ${llm.last4 ?? '????'}).`,
            });
        }

        // 3. Module binding. oem_agents.department is human prose an LLM wrote;
        //    the runs table and the pulse strip filter on canonical slugs.
        const declared =
            (agent?.config as Record<string, unknown> | undefined)?.module ?? agent?.department ?? null;
        const declaredText = typeof declared === 'string' ? declared : null;
        const moduleSlug = normalizeModule(declaredText);
        checks.push(
            moduleSlug
                ? {
                    label: 'Module binding',
                    ok: true,
                    detail: `"${declaredText}" resolves to the module ${moduleSlug}, so this run appears on that module's strip.`,
                }
                : {
                    label: 'Module binding',
                    ok: false,
                    detail: declaredText
                        ? `"${declaredText}" does not name a module we know, so this agent's activity shows as Unassigned. It is recorded as unassigned rather than guessed.`
                        : 'This agent declares no module or department, so its activity shows as Unassigned.',
                },
        );

        // 4. Schedule. No cron is a legitimate configuration (triggered agents);
        //    a cron this screen cannot read is not.
        const cron = draft.schedule_cron.trim();
        if (!cron) {
            checks.push({
                label: 'Schedule',
                ok: true,
                detail: 'No cron set — this agent runs only when something triggers it.',
            });
        } else {
            const preview = describeCron(cron, draft.timezone);
            checks.push(
                preview
                    ? { label: 'Schedule', ok: true, detail: `${cron} — ${preview}` }
                    : { label: 'Schedule', ok: false, detail: `"${cron}" is not a five-field cron expression this console can read.` },
            );
        }

        // 5. What was actually checked. Unsaved edits on screen are not what the
        //    agent would run, and saying so is the whole point of a preflight.
        checks.push(
            dirty
                ? {
                    label: 'Saved runtime',
                    ok: false,
                    detail: 'There are unsaved runtime edits on this screen. The checks above ran against the SAVED settings, not the ones you are looking at — save, then dry run again.',
                }
                : {
                    label: 'Saved runtime',
                    ok: true,
                    detail: `Autonomy is "${draft.autonomy}" and there are no unsaved edits, so this is what the agent would run with.`,
                },
        );

        return checks;
    };

    /**
     * Record ONE COMPLETED shadow run: the checks above, posted with their steps
     * and a terminal status in a single call.
     *
     * There is no PATCH on /api/agents/runs, so a run posted as 'running' from a
     * browser can never be closed by anything — see the header comment for what
     * that costs. The route accepts `steps` alongside the run and sets ended_at
     * itself for any terminal status, so the whole preflight lands atomically.
     */
    const startDryRun = async () => {
        setDryError(null);
        setDryRun(null);
        setDryRunning(true);

        const startedAt = new Date().toISOString();
        const checks = collectDryChecks();
        const passed = checks.filter((c) => c.ok).length;
        const failed = checks.length - passed;
        const status: 'succeeded' | 'skipped' = failed === 0 ? 'succeeded' : 'skipped';

        const declared =
            (agent?.config as Record<string, unknown> | undefined)?.module ?? agent?.department ?? null;
        // Canonical slug or null. Never the raw department string: 'Procurement'
        // would never match a pulse filter on 'procurement', and a wrong slug
        // would put this agent's activity on another module's card.
        const moduleSlug = normalizeModule(typeof declared === 'string' ? declared : null);

        const outcome = failed === 0
            ? `Dry run — configuration validated, ${passed} checks passed. No action taken, nothing sent.`
            : `Dry run — configuration incomplete: ${failed} of ${checks.length} checks failed. No action taken, nothing sent.`;

        try {
            const res = await fetch(`/api/agents/runs?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent_key: agentKey,
                    trigger: 'shadow',
                    // TERMINAL. Never 'running' — nothing can close it afterwards.
                    status,
                    started_at: startedAt,
                    ended_at: new Date().toISOString(),
                    module: moduleSlug,
                    // Idempotency: a double submit of the same click is one run.
                    run_key: `sandbox-dryrun:${startedAt}`,
                    outcome_summary: outcome,
                    // No model was called, so there is nothing to report but zero.
                    tokens_in: 0,
                    tokens_out: 0,
                    cost_inr: 0,
                    cost_usd: 0,
                    steps: [
                        {
                            step_type: 'plan',
                            label: 'Preflight only — no model call, no write, no send',
                            status: 'ok',
                            detail: {
                                source: 'AgentCredentials sandbox',
                                autonomy_at_request: draft.autonomy,
                                declared_module: typeof declared === 'string' ? declared : null,
                                canonical_module: moduleSlug,
                            },
                        },
                        ...checks.map((c) => ({
                            step_type: 'decide',
                            label: `${c.label}: ${c.detail}`,
                            status: c.ok ? 'ok' : 'failed',
                            detail: { check: c.label, passed: c.ok },
                        })),
                        {
                            step_type: 'decide',
                            label: outcome,
                            status: failed === 0 ? 'ok' : 'skipped',
                            detail: { checks_total: checks.length, checks_passed: passed, checks_failed: failed },
                        },
                    ],
                }),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (!res.ok || !json) {
                setDryError((json?.error as string) || `Dry run failed (HTTP ${res.status}).`);
                return;
            }
            if (json.provisioned === false) {
                setDryError(
                    `The checks ran, but the result cannot be recorded: the run log needs migration ${AGENT_RUNTIME_MIGRATION}.`,
                );
                return;
            }
            const run = json.run as { id?: string; started_at?: string } | null;
            setDryRun({
                id: run?.id ?? null,
                at: run?.started_at ?? startedAt,
                status,
                checks,
                passed,
                // The run landed but oem_agent_run_steps did not: there is a row,
                // but no trace to open. Say so rather than offer a dead link.
                traceMissing: json.steps_provisioned === false,
            });
        } catch (e) {
            setDryError((e as Error).message);
        } finally {
            setDryRunning(false);
        }
    };

    return (
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Timer className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-foreground">Runtime</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        When this agent wakes up, how often it checks in, and how far it is allowed
                        to go on its own.
                    </p>
                </div>
                {dirty && (
                    <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        Unsaved changes
                    </span>
                )}
            </header>

            {!provisioned ? (
                <div className="p-5">
                    <NotProvisioned what="Agent runtime settings" />
                </div>
            ) : !agent ? (
                <div className="p-5">
                    <div className="rounded-2xl border border-dashed border-border bg-card-tint px-4 py-4 text-sm text-text-secondary">
                        No agent called{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{agentKey}</code>{' '}
                        is registered for this organisation yet. Register it first, then its runtime
                        becomes editable here.
                    </div>
                </div>
            ) : (
                <div className="space-y-5 p-5">
                    {/* ---------------- AUTONOMY. Deliberately first and large. */}
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <Hand className="h-3.5 w-3.5 text-text-secondary" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                                Autonomy
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                                — the one setting on this screen that changes what happens to the business
                            </span>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => set('autonomy', 'suggest')}
                                className={`rounded-2xl border-2 p-4 text-left transition-all ${
                                    draft.autonomy === 'suggest'
                                        ? 'border-primary bg-primary/6 shadow-sm'
                                        : 'border-border bg-card hover:border-primary/30'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Eye className="h-4 w-4 text-primary" />
                                    <span className="text-base font-bold text-foreground">Suggest only</span>
                                    {draft.autonomy === 'suggest' && (
                                        <Check className="ml-auto h-4 w-4 text-primary" />
                                    )}
                                </span>
                                <span className="mt-2 block text-xs leading-relaxed text-text-secondary">
                                    The agent does the work and writes down what it would do. Nothing
                                    reaches a vendor, a ticket or a ledger until a person approves it.
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => set('autonomy', 'act')}
                                className={`rounded-2xl border-2 p-4 text-left transition-all ${
                                    draft.autonomy === 'act'
                                        ? 'border-amber-500 bg-amber-500/8 shadow-sm'
                                        : 'border-border bg-card hover:border-amber-500/40'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-amber-600" />
                                    <span className="text-base font-bold text-foreground">Act</span>
                                    {draft.autonomy === 'act' && (
                                        <Check className="ml-auto h-4 w-4 text-amber-600" />
                                    )}
                                </span>
                                <span className="mt-2 block text-xs leading-relaxed text-text-secondary">
                                    The agent carries out its own decisions — it writes records, sends
                                    messages and places calls without waiting for anyone.
                                </span>
                            </button>
                        </div>

                        {draft.autonomy === 'act' && (
                            <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-700">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    On <strong>Act</strong>, the daily run cap, the rupee cap and quiet
                                    hours below stop being tidiness and become the safety envelope. Set
                                    them before you save.
                                </span>
                            </p>
                        )}
                    </div>

                    {/* ---------------- SCHEDULE */}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <Field
                                label="Schedule (cron)"
                                hint="Five fields: minute, hour, day of month, month, day of week."
                            >
                                <input
                                    className={`${INPUT_CLASS} font-mono`}
                                    value={draft.schedule_cron}
                                    onChange={(e) => set('schedule_cron', e.target.value)}
                                    placeholder="30 9 * * 1-5"
                                    spellCheck={false}
                                />
                            </Field>

                            {/* The preview is the whole point of the field. */}
                            <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                                <Clock className="mt-0.5 h-3 w-3 shrink-0 text-text-tertiary" />
                                {!draft.schedule_cron.trim() ? (
                                    <span className="text-text-tertiary">
                                        No schedule — this agent only runs when something triggers it.
                                    </span>
                                ) : cronPreview ? (
                                    <span className="font-semibold text-primary">Runs {cronPreview}</span>
                                ) : (
                                    <span className="text-amber-700">
                                        We cannot describe this expression in plain English. Double-check
                                        it before saving.
                                    </span>
                                )}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {CRON_PRESETS.map((p) => (
                                    <button
                                        key={p.cron}
                                        type="button"
                                        onClick={() => set('schedule_cron', p.cron)}
                                        className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                                            draft.schedule_cron === p.cron
                                                ? 'border-primary bg-primary/8 text-primary'
                                                : 'border-border text-text-secondary hover:border-primary/30 hover:text-primary'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Field label="Timezone" hint="The clock the schedule and quiet hours are read in.">
                                <select
                                    className={INPUT_CLASS}
                                    value={draft.timezone}
                                    onChange={(e) => set('timezone', e.target.value)}
                                >
                                    {TZ_CHOICES.map((t) => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>
                            </Field>

                            <div>
                                <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                                    <Moon className="h-3 w-3" /> Quiet hours
                                </span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="time"
                                        className={INPUT_CLASS}
                                        value={draft.quiet_from}
                                        onChange={(e) => set('quiet_from', e.target.value)}
                                    />
                                    <span className="shrink-0 text-xs text-text-tertiary">to</span>
                                    <input
                                        type="time"
                                        className={INPUT_CLASS}
                                        value={draft.quiet_to}
                                        onChange={(e) => set('quiet_to', e.target.value)}
                                    />
                                </div>
                                <span className="mt-1 block text-[11px] text-text-tertiary">
                                    {draft.quiet_from && draft.quiet_to
                                        ? `No calls, messages or writes between ${draft.quiet_from} and ${draft.quiet_to}.`
                                        : 'Leave blank to let this agent work at any hour.'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ---------------- ENVELOPE */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Heartbeat" hint="How often it reports that it is alive.">
                            <select
                                className={INPUT_CLASS}
                                value={draft.heartbeat_interval_sec}
                                onChange={(e) => set('heartbeat_interval_sec', e.target.value)}
                            >
                                {HEARTBEAT_CHOICES.map((h) => (
                                    <option key={h.value} value={String(h.value)}>
                                        {h.label}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Max runs / day" hint="Blank means no cap.">
                            <input
                                className={INPUT_CLASS}
                                type="number"
                                min={0}
                                max={10_000}
                                value={draft.max_runs_per_day}
                                onChange={(e) => set('max_runs_per_day', e.target.value)}
                                placeholder="e.g. 48"
                            />
                        </Field>

                        <Field label="Max cost / day (₹)" hint="It stops itself when it hits this.">
                            <input
                                className={INPUT_CLASS}
                                type="number"
                                min={0}
                                step="1"
                                value={draft.max_cost_inr_per_day}
                                onChange={(e) => set('max_cost_inr_per_day', e.target.value)}
                                placeholder="e.g. 500"
                            />
                        </Field>

                        <Field label="Timeout (seconds)" hint="A single run may not exceed this.">
                            <input
                                className={INPUT_CLASS}
                                type="number"
                                min={5}
                                max={3_600}
                                value={draft.timeout_sec}
                                onChange={(e) => set('timeout_sec', e.target.value)}
                                placeholder="120"
                            />
                        </Field>
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/6 px-3 py-2 text-xs leading-relaxed text-red-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {saved && (
                        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-700">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{saved}</span>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving || !dirty}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save runtime
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setDraft(baseline);
                                setError(null);
                                setSaved(null);
                            }}
                            disabled={!dirty}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-foreground disabled:opacity-40"
                        >
                            <RefreshCw className="h-3.5 w-3.5" /> Discard
                        </button>

                        <div className="ml-auto flex items-center gap-2">
                            <button
                                type="button"
                                onClick={startDryRun}
                                disabled={dryRunning}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-secondary/40 bg-secondary/8 px-3.5 py-2 text-xs font-bold text-secondary transition-colors hover:bg-secondary/12 disabled:opacity-50"
                                title="Checks the key, the module binding and the schedule, and records the result as one completed shadow run. No model is called and nothing is sent."
                            >
                                {dryRunning ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <FlaskConical className="h-3.5 w-3.5" />
                                )}
                                Dry run
                            </button>
                        </div>
                    </div>

                    {dryError && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/6 px-3 py-2 text-xs leading-relaxed text-red-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{dryError}</span>
                        </div>
                    )}

                    {dryRun && (
                        <div
                            className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                                dryRun.status === 'succeeded'
                                    ? 'border-emerald-500/30 bg-emerald-500/6'
                                    : 'border-amber-500/30 bg-amber-500/6'
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                {dryRun.status === 'succeeded' ? (
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                ) : (
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                )}
                                <p
                                    className={`font-bold ${
                                        dryRun.status === 'succeeded' ? 'text-emerald-700' : 'text-amber-700'
                                    }`}
                                >
                                    {dryRun.status === 'succeeded'
                                        ? `Dry run complete — ${dryRun.passed} checks passed, nothing sent.`
                                        : `Dry run complete — ${dryRun.passed} of ${dryRun.checks.length} checks passed, nothing sent.`}
                                </p>
                            </div>

                            <ul className="mt-2 space-y-1.5 pl-5">
                                {dryRun.checks.map((c) => (
                                    <li key={c.label} className="flex items-start gap-2">
                                        {c.ok ? (
                                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                                        ) : (
                                            <X className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                                        )}
                                        <span className="text-text-secondary">
                                            <span className="font-semibold text-foreground">{c.label}</span>
                                            {' — '}
                                            {c.detail}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-5 text-text-tertiary">
                                <span>
                                    Recorded at {new Date(dryRun.at).toLocaleTimeString()} as a shadow run.
                                    No model was called and nothing was written to the business.
                                </span>
                                {dryRun.id && !dryRun.traceMissing && (
                                    <button
                                        type="button"
                                        onClick={() => setTraceRunId(dryRun.id)}
                                        className="inline-flex items-center gap-1.5 font-bold text-primary underline underline-offset-2 hover:opacity-80"
                                    >
                                        <Eye className="h-3 w-3" />
                                        View the trace
                                        <code className="font-mono font-normal">{dryRun.id.slice(0, 8)}</code>
                                    </button>
                                )}
                                {dryRun.id && dryRun.traceMissing && (
                                    <span>
                                        The step trace could not be stored — apply {AGENT_RUNTIME_MIGRATION}.sql
                                        to see the individual checks in the run log.
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    <AgentRunTrace
                        orgId={orgId}
                        agentKey={agentKey}
                        runId={traceRunId}
                        onClose={() => setTraceRunId(null)}
                    />
                </div>
            )}
        </section>
    );
}
