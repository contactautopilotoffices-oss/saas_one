'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';

const MIN_LENGTH = 8;

/**
 * Settings → Profile → "Change password" (owner 2026-11-03: every role). Its own form (the profile form above it is a
 * separate <form>), posting to /api/users/change-password, which checks the current password on the server.
 * An account that signs in only with Google or a magic link has no password yet: it sets one without the current one.
 */
export default function ChangePasswordSection() {
    const { user } = useAuth();
    const hasPassword = (user?.identities ?? []).some(identity => identity.provider === 'email');

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        if (hasPassword && !current) { setMessage({ type: 'error', text: 'Enter your current password.' }); return; }
        if (next.length < MIN_LENGTH) { setMessage({ type: 'error', text: `The new password must be at least ${MIN_LENGTH} characters.` }); return; }
        if (next !== confirm) { setMessage({ type: 'error', text: 'The new passwords do not match.' }); return; }
        if (hasPassword && next === current) { setMessage({ type: 'error', text: 'The new password must be different from the current one.' }); return; }

        setSaving(true);
        try {
            const res = await fetch('/api/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage({ type: 'error', text: data.error || 'Couldn’t change the password. Please try again.' });
                return;
            }
            setCurrent(''); setNext(''); setConfirm('');
            setMessage({
                type: 'success',
                text: hasPassword
                    ? 'Password changed. Other devices have been signed out.'
                    : 'Password set. You can now also sign in with your email and this password.',
            });
        } catch {
            setMessage({ type: 'error', text: 'Could not reach the server. Please check the connection and try again.' });
        } finally {
            setSaving(false);
        }
    };

    const input = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-11 text-base text-slate-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 sm:text-sm';
    const label = 'mb-1.5 block text-sm font-medium text-slate-700';
    const toggle = (
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide passwords' : 'Show passwords'}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
    );

    return (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 md:p-8 shadow-sm" aria-labelledby="change-password-title">
            <h2 id="change-password-title" className="text-xl font-display font-semibold text-slate-900 mb-1 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                {hasPassword ? 'Change password' : 'Set a password'}
            </h2>
            <p className="text-sm text-slate-500 mb-6">
                {hasPassword
                    ? `Use at least ${MIN_LENGTH} characters. Other devices are signed out after the change.`
                    : `Your account signs in without a password. Set one (at least ${MIN_LENGTH} characters) to also sign in with your email.`}
            </p>

            <form onSubmit={submit} className="grid max-w-xl gap-4" noValidate>
                {/* Lets password managers attach the new password to the right account. */}
                <input type="email" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
                {hasPassword && (
                    <div>
                        <label htmlFor="current-password" className={label}>Current password</label>
                        <div className="relative">
                            <input id="current-password" type={show ? 'text' : 'password'} autoComplete="current-password" value={current}
                                onChange={e => setCurrent(e.target.value)} disabled={saving} className={input} />
                            {toggle}
                        </div>
                    </div>
                )}
                <div>
                    <label htmlFor="new-password" className={label}>New password</label>
                    <div className="relative">
                        <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={next} minLength={MIN_LENGTH}
                            onChange={e => setNext(e.target.value)} disabled={saving} className={input} />
                        {!hasPassword && toggle}
                    </div>
                </div>
                <div>
                    <label htmlFor="confirm-password" className={label}>Confirm new password</label>
                    <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm}
                        onChange={e => setConfirm(e.target.value)} disabled={saving} className={input} />
                </div>

                {message && (
                    <p role={message.type === 'error' ? 'alert' : 'status'}
                        className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${message.type === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
                        {message.type === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                        {message.text}
                    </p>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {hasPassword ? (
                        <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">Forgot your current password?</Link>
                    ) : <span />}
                    <button type="submit" disabled={saving}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-opacity hover:opacity-90 disabled:opacity-70 sm:w-auto">
                        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
                        {hasPassword ? 'Change password' : 'Set password'}
                    </button>
                </div>
            </form>
        </section>
    );
}
