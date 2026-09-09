'use client';

/**
 * WHO IS THIS PERSON, BEFORE WHAT DO THEY DO.
 * -----------------------------------------------------------------------------
 * Creating an agent went straight to "describe the job in plain English". No
 * name, no address, no department — the composer invented an identity from the
 * sentence and the operator met their new colleague for the first time in a
 * generated proposal. Hiring nobody in particular and reading afterwards who
 * turned up is the wrong way round, and it shows in the output: a job
 * description written with no idea who holds it drifts, because there is no
 * subject for it to be about.
 *
 * So this step comes first, and it is deliberately small. ONE field is required
 * — the name. Everything else can be filled now, later, or never; a half-known
 * colleague is still a colleague, and an onboarding form that blocks on a phone
 * number nobody has yet is a form people learn to fight.
 *
 * WHAT IT IS FOR is the part worth being clear about: this is not decoration
 * that gets thrown away at the next screen. Every field is handed to the
 * composer as STATED FACT, so the prompt it writes is about a named person in a
 * named department with a real address, rather than about "an agent". That is
 * the whole reason the step exists.
 */

import { useMemo, useState } from 'react';
import { ArrowRight, AtSign, Building2, Phone, User, X } from 'lucide-react';

export interface AgentIdentity {
    display_name: string;
    email: string;
    phone: string;
    department: string;
    reports_to: string;
}

export const EMPTY_IDENTITY: AgentIdentity = {
    display_name: '', email: '', phone: '', department: '', reports_to: '',
};

/**
 * The address we would give this person, from the domain the org already uses.
 *
 * Taken from a colleague's address rather than guessed or hardcoded: an org on
 * @worksquare.in must not be offered @example.com, and nobody should have to
 * type a domain the system already knows. Returns '' when there is no colleague
 * to learn from — an invented domain is worse than an empty box.
 */
export function suggestEmail(name: string, existing: ReadonlyArray<string>): string {
    const local = name.trim().toLowerCase()
        .replace(/[^a-z0-9\s.]/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join('.');
    if (!local) return '';
    const domain = existing
        .map((e) => e.split('@')[1])
        .filter(Boolean)[0];
    return domain ? `${local}@${domain}` : '';
}

export default function AgentIdentityStep({
    takenEmails,
    departments,
    colleagues,
    initial,
    onContinue,
    onCancel,
}: {
    /** Addresses already in use, so a clash is caught here and not at send time. */
    takenEmails: ReadonlyArray<string>;
    /** Departments this org already has — offered, never enforced. */
    departments: ReadonlyArray<string>;
    /** Existing agents, so "reports to" is a real name and not free text. */
    colleagues: ReadonlyArray<{ key: string; name: string }>;
    initial?: Partial<AgentIdentity>;
    onContinue: (identity: AgentIdentity) => void;
    onCancel: () => void;
}) {
    const [v, setV] = useState<AgentIdentity>({ ...EMPTY_IDENTITY, ...initial });
    const [touchedEmail, setTouchedEmail] = useState(Boolean(initial?.email));

    /**
     * The suggestion follows the name until the operator writes their own — and
     * it is DERIVED, not stored. Writing it into state from an effect makes the
     * component render, set state, and render again on every keystroke, and
     * React rightly complains: the value is a pure function of what has been
     * typed, so it belongs in the render pass.
     */
    const email = touchedEmail ? v.email : suggestEmail(v.display_name, takenEmails);

    const emailClash = useMemo(() => {
        const e = email.trim().toLowerCase();
        return Boolean(e) && takenEmails.some((t) => t.toLowerCase() === e);
    }, [email, takenEmails]);

    const ready = v.display_name.trim().length >= 2 && !emailClash;

    const field = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] focus:border-primary/40 focus:outline-none';
    const label = 'mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary';

    return (
        <div className="rounded-[16px] border border-border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-[15px] font-semibold text-foreground">Who are you hiring?</h3>
                    <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-text-secondary">
                        Give them a name and, if you know it, a desk. Only the name is needed to carry on —
                        everything else can be filled in later. What you put here is handed to the next step,
                        so the job gets written for a real person instead of for &ldquo;an agent&rdquo;.
                    </p>
                </div>
                <button type="button" onClick={onCancel} className="rounded-md p-1 text-text-tertiary hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                    <label className={label}><User className="h-3 w-3" /> Name <span className="text-rose-500">*</span></label>
                    <input
                        autoFocus
                        className={field}
                        value={v.display_name}
                        placeholder="Ira Mehta"
                        onChange={(e) => setV((p) => ({ ...p, display_name: e.target.value }))}
                    />
                    <p className="mt-1 text-[11px] text-text-tertiary">What colleagues will call them in email.</p>
                </div>

                <div>
                    <label className={label}><AtSign className="h-3 w-3" /> Email address</label>
                    <input
                        className={`${field} ${emailClash ? 'border-rose-400' : ''}`}
                        value={email}
                        placeholder="ira.mehta@yourcompany.com"
                        onChange={(e) => { setTouchedEmail(true); setV((p) => ({ ...p, email: e.target.value })); }}
                    />
                    <p className={`mt-1 text-[11px] ${emailClash ? 'text-rose-600' : 'text-text-tertiary'}`}>
                        {emailClash
                            ? 'Another agent already uses this address. Two agents on one inbox read each other’s mail.'
                            : 'Suggested from the name. Change it if you like — it can be set later.'}
                    </p>
                </div>

                <div>
                    <label className={label}><Building2 className="h-3 w-3" /> Department</label>
                    <input
                        className={field}
                        list="agent-departments"
                        value={v.department}
                        placeholder="Procurement"
                        onChange={(e) => setV((p) => ({ ...p, department: e.target.value }))}
                    />
                    <datalist id="agent-departments">
                        {departments.map((d) => <option key={d} value={d} />)}
                    </datalist>
                    <p className="mt-1 text-[11px] text-text-tertiary">Who they work for. Decides whose data they see.</p>
                </div>

                <div>
                    <label className={label}><Phone className="h-3 w-3" /> Phone <span className="font-normal normal-case tracking-normal text-text-tertiary">— optional</span></label>
                    <input
                        className={field}
                        value={v.phone}
                        placeholder="+91 …"
                        onChange={(e) => setV((p) => ({ ...p, phone: e.target.value }))}
                    />
                    <p className="mt-1 text-[11px] text-text-tertiary">Only needed if they will ever send WhatsApp or call.</p>
                </div>

                {colleagues.length > 0 && (
                    <div className="sm:col-span-2">
                        <label className={label}>Reports to <span className="font-normal normal-case tracking-normal text-text-tertiary">— optional</span></label>
                        <select
                            className={field}
                            value={v.reports_to}
                            onChange={(e) => setV((p) => ({ ...p, reports_to: e.target.value }))}
                        >
                            <option value="">Nobody — works alone</option>
                            {colleagues.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                        </select>
                        <p className="mt-1 text-[11px] text-text-tertiary">
                            The colleague who reads their work before it goes out.
                        </p>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    disabled={!ready}
                    onClick={() => onContinue({ ...v, email })}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-medium ${
                        ready ? 'bg-foreground text-background' : 'cursor-not-allowed bg-muted text-text-tertiary'}`}
                >
                    Next — describe the job <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11.5px] text-text-tertiary">
                    {ready ? 'You can change any of this later.' : 'A name is all that is needed to carry on.'}
                </span>
            </div>
        </div>
    );
}
