'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { ArrowRight, Eye, EyeOff, Lock, CheckCircle2, KeyRound, AlertCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import Loader from '@/frontend/components/ui/Loader';

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = React.useMemo(() => createClient(), []);

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sessionReady, setSessionReady] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [usingCustomToken, setUsingCustomToken] = useState(false);
    const [tokenValid, setTokenValid] = useState(false);
    const [tokenEmail, setTokenEmail] = useState('');

    // Check if we're using custom token or Supabase session
    useEffect(() => {
        const checkAuthMethod = async () => {
            const token = searchParams.get('token');

            if (token) {
                // Using custom token
                setUsingCustomToken(true);
                try {
                    const res = await fetch(`/api/users/reset-password?token=${token}`);
                    const data = await res.json();

                    if (data.valid) {
                        setTokenValid(true);
                        setTokenEmail(data.email || '');
                    } else {
                        setError(data.error || 'Invalid or expired token');
                    }
                } catch (err) {
                    console.error('Token check error:', err);
                    setError('Failed to verify token');
                } finally {
                    setCheckingSession(false);
                }
            } else {
                // Using Supabase session
                // The implicit flow sends tokens in the URL hash (#access_token=...)
                // getSession() might fire before the hash is parsed, so we also listen to onAuthStateChange

                // First check if it's already parsed
                supabase.auth.getSession().then(({ data: { session } }) => {
                    if (session) {
                        console.log('Recovery session found');
                        setSessionReady(true);
                        setCheckingSession(false);
                    }
                }).catch(err => {
                    console.error('Session check error:', err);
                });

                // Listen for the recovery event or signed_in event parsed from the URL
                const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                    if (event === 'PASSWORD_RECOVERY' || session) {
                        console.log('Auth state changed to recovery/signed_in');
                        setSessionReady(true);
                        setCheckingSession(false);
                        setError('');
                    }
                });
                
                // Fallback timeout in case the hash is invalid or missing
                const timer = setTimeout(() => {
                    setCheckingSession((prev) => {
                        if (prev) {
                            setError('No active reset session found. Please request a new password reset link.');
                        }
                        return false;
                    });
                }, 2000);

                return () => {
                    subscription.unsubscribe();
                    clearTimeout(timer);
                };
            }
        };

        checkAuthMethod();
    }, [searchParams, supabase]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            if (usingCustomToken && tokenValid) {
                // Use custom token API
                const token = searchParams.get('token');
                const res = await fetch('/api/users/update-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, newPassword: password }),
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Failed to update password');
                }

                setSuccess(true);
            } else {
                // Use Supabase session
                const { error } = await supabase.auth.updateUser({ password });

                if (error) throw error;
                setSuccess(true);
            }
        } catch (err: any) {
            console.error('Password update error:', err);
            setError(err.message || 'Failed to update password');
        } finally {
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <Loader />
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-3xl shadow-2xl p-10 max-w-md w-full text-center border border-gray-100"
                >
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 15, stiffness: 300, delay: 0.1 }}
                        className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"
                    >
                        <CheckCircle2 className="w-10 h-10 text-green-600" />
                    </motion.div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Password Updated!</h2>
                    <p className="text-gray-600 mb-8">
                        Your password has been successfully reset.
                    </p>
                    <button
                        onClick={() => router.push('/login')}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity"
                    >
                        Sign In
                    </button>
                </motion.div>
            </div>
        );
    }

    if (error && !usingCustomToken) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl shadow-2xl p-10 max-w-md w-full text-center border border-gray-100"
                >
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <button
                        onClick={() => router.push('/forgot-password')}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity"
                    >
                        Request New Link
                    </button>
                </motion.div>
            </div>
        );
    }

    if (usingCustomToken && !tokenValid) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl shadow-2xl p-10 max-w-md w-full text-center border border-gray-100"
                >
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <KeyRound className="w-8 h-8 text-amber-600" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid or Expired Link</h2>
                    <p className="text-gray-600 mb-2">{error || 'This password reset link is invalid or has expired.'}</p>
                    {tokenEmail && <p className="text-sm text-gray-500 mb-6">For: {tokenEmail}</p>}
                    <button
                        onClick={() => router.push('/forgot-password')}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity"
                    >
                        Request New Link
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                <div className="flex justify-center mb-8">
                    <Image src="/logo.png" alt="PropEase" width={80} height={80} className="rounded-2xl" />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl shadow-2xl p-10 border border-gray-100"
                >
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock className="w-8 h-8 text-indigo-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set New Password</h1>
                        {usingCustomToken && tokenEmail && (
                            <p className="text-sm text-gray-500">Resetting password for: {tokenEmail}</p>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="New Password"
                                required
                                minLength={8}
                                className="w-full pl-12 pr-12 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>

                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm Password"
                                required
                                minLength={8}
                                className="w-full pl-12 pr-12 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                            </button>
                        </div>

                        {error && (
                            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader className="w-5 h-5 animate-spin" />
                                    Updating...
                                </>
                            ) : (
                                <>
                                    Update Password
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>
                </motion.div>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center"><Loader /></div>}>
            <ResetPasswordContent />
        </Suspense>
    );
}
