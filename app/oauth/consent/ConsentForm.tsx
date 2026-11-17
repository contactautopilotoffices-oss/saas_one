'use client';

import { useRef, useState } from 'react';

/**
 * Allow / Deny buttons for the FMS consent screen. A normal form post to /api/oauth/decision,
 * sent ONCE: Supabase accepts one decision per connection request, so a second click (a
 * double click, or click plus Enter) would reach it after the first has already approved and
 * the user would land on an error instead of back in their assistant.
 */
export default function ConsentForm({ authorizationId, allowed }: { authorizationId: string; allowed: boolean }) {
    const sent = useRef(false);
    const [choice, setChoice] = useState<'approve' | 'deny' | null>(null);

    return (
        <form
            action="/api/oauth/decision"
            method="POST"
            className="mt-6 flex gap-3"
            onSubmit={e => {
                if (sent.current) {
                    e.preventDefault();
                    return;
                }
                sent.current = true;
                const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                setChoice(submitter?.value === 'approve' ? 'approve' : 'deny');
            }}
        >
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <button
                type="submit"
                name="decision"
                value="deny"
                aria-disabled={choice !== null}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 aria-disabled:opacity-60"
            >
                {choice === 'deny' ? 'Denying...' : 'Deny'}
            </button>
            {allowed && (
                <button
                    type="submit"
                    name="decision"
                    value="approve"
                    aria-disabled={choice !== null}
                    className="flex-1 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 aria-disabled:opacity-60"
                >
                    {choice === 'approve' ? 'Connecting...' : 'Allow'}
                </button>
            )}
        </form>
    );
}
