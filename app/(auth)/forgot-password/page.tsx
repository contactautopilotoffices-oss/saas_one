'use client';

import React, { useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { ArrowRight, Mail, CheckCircle2, ArrowLeft, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Loader from '@/frontend/components/ui/Loader';
import { createClient } from '@/frontend/utils/supabase/client';

function ForgotPasswordContent() {
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPopup, setShowPopup] = useState(false);
    const [emailSent, setEmailSent] = useState('');

    const supabase = React.useMemo(() => createClient(), []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/api/auth/callback?next=/reset-password`,
            });

            if (resetError) {
                console.error('Password reset error:', resetError);
                // We still show success popup to prevent email enumeration, unless it's a rate limit
                if (resetError.status === 429) {
                    throw new Error('Too many requests. Please try again later.');
                }
            }

            setEmailSent(email);
            setShowPopup(true);
        } catch (err: any) {
            console.error('Forgot password error:', err);
            setError(err.message || 'Failed to send reset email');
        } finally {
            setLoading(false);
        }
    };

    if (showPopup) {
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
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h2>
                    <p className="text-gray-600 mb-4">
                        We sent a password reset link to <span className="font-medium text-gray-900">{emailSent}</span>
                    </p>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                        <p className="text-sm text-amber-800">
                            <strong>Note:</strong> If using the custom reset (with SMTP), the link expires in <span className="font-bold">7 days</span>.
                        </p>
                    </div>
                    <p className="text-sm text-gray-500 mb-6">
                        Click the link in the email to reset your password.
                    </p>
                    <button
                        onClick={() => router.push('/login')}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity"
                    >
                        Back to Login
                    </button>
                    <button
                        onClick={() => { setShowPopup(false); setEmail(''); }}
                        className="w-full mt-3 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
                    >
                        Try a different email
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                {/* Logo */}
                <div className="flex justify-center mb-8">
                    <Image src="/logo.png" alt="PropEase" width={80} height={80} className="rounded-2xl" />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-3xl shadow-2xl p-10 border border-gray-100"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-5 h-5 text-amber-500" />
                        <h1 className="text-xl font-bold text-gray-900">Supabase email is slow?</h1>
                    </div>
                    <p className="text-gray-600 mb-6 text-sm">
                        If you don't receive the email within 10 minutes, try again or configure SMTP for faster delivery.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email"
                                required
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
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
                                    Sending...
                                </>
                            ) : (
                                <>
                                    Send Reset Link
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <p className="text-xs text-gray-500 text-center">
                            Default links expire in 1 hour.<br />
                            Configure SMTP for 7-day expiry links.
                        </p>
                    </div>

                    <button
                        onClick={() => router.push('/login')}
                        className="w-full mt-4 flex items-center justify-center gap-2 text-gray-500 text-sm font-medium hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Login
                    </button>
                </motion.div>
            </div>
        </div>
    );
}

export default function ForgotPasswordPage() {
    return <ForgotPasswordContent />;
}
