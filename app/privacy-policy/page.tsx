'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, UserCheck, FileText, Lock, Trash2, Mail, ArrowLeft, Building2 } from 'lucide-react';

export default function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-teal-500 selection:text-white relative overflow-hidden">
            {/* Background Glow Accents */}
            <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-teal-500/10 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />

            {/* Header Navigation */}
            <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20 group-hover:scale-105 transition-transform">
                            <Building2 className="w-5 h-5 text-slate-950 font-bold" />
                        </div>
                        <span className="text-xl font-black tracking-tight text-white font-outfit">
                            Autopilot <span className="text-teal-400 font-normal">FMS</span>
                        </span>
                    </Link>
                    <Link
                        href="/"
                        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Home
                    </Link>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-4xl mx-auto px-6 py-16">
                {/* Title Hero */}
                <div className="mb-14 text-center sm:text-left border-b border-slate-800/80 pb-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold uppercase tracking-wider mb-4">
                        <ShieldCheck className="w-4 h-4" /> Legal & Data Protection
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight font-outfit mb-4">
                        Autopilot Privacy Policy
                    </h1>
                    <p className="text-slate-400 text-sm sm:text-base max-w-2xl leading-relaxed">
                        Your privacy and data security are our top priorities. This policy outlines how Autopilot handles, secures, and protects your information across our facility management platform.
                    </p>
                    <p className="text-slate-500 text-xs mt-4">
                        Effective Date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                </div>

                {/* Policy Content Sections */}
                <div className="space-y-12">
                    {/* 1. Information We Collect */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                                <UserCheck className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">1. Information We Collect</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            To deliver robust facility management, ticket tracking, and security operations, Autopilot collects the following types of information:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-5">
                                <h3 className="text-sm font-bold text-teal-400 mb-2">Account Details</h3>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Name, email address, role, property membership, profile avatar.
                                </p>
                            </div>
                            <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-5">
                                <h3 className="text-sm font-bold text-teal-400 mb-2">Media & Attachments</h3>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Photos and videos captured or uploaded for work orders, ticket before/after proof, visitor logs, and equipment maintenance.
                                </p>
                            </div>
                            <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-5">
                                <h3 className="text-sm font-bold text-teal-400 mb-2">Device & Technical Information</h3>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Operating system version, device model, performance metrics, and crash logs.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 2. How We Use Data */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                <FileText className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">2. How We Use Data</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-4">
                            We process collected data exclusively to power and enhance facility workflows:
                        </p>
                        <ul className="space-y-3 text-slate-300 text-sm mb-6 pl-2">
                            <li className="flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-2 shrink-0" />
                                <span>Processing facility management tickets, work orders, and inventory logs.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-2 shrink-0" />
                                <span>Managing security visitor logs and gate pass approvals.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-2 shrink-0" />
                                <span>Dispatching real-time notifications for ticket status updates.</span>
                            </li>
                        </ul>
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
                            <p className="text-emerald-300 font-semibold text-sm leading-relaxed text-center sm:text-left">
                                🛡️ <span className="font-bold">Explicit Guarantee:</span> We do not sell, rent, or monetize your personal data to third parties.
                            </p>
                        </div>
                    </section>

                    {/* 3. Data Security & Storage */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <Lock className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">3. Data Security & Storage</h2>
                        </div>
                        <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
                            <p>
                                Autopilot employs multi-layered enterprise grade security protocols to safeguard all organizational records and user data:
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                    <h4 className="font-bold text-white mb-1">Encrypted Data Storage</h4>
                                    <p className="text-slate-400 text-xs">
                                        Encrypted data storage on Supabase enterprise database infrastructure.
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                    <h4 className="font-bold text-white mb-1">Transit & Access Control</h4>
                                    <p className="text-slate-400 text-xs">
                                        HTTPS/TLS encrypted network transmission and token-based authentication (JWT).
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 4. Account & Data Deletion Rights */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                                <Trash2 className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">4. Account & Data Deletion Rights</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-4">
                            Users can request account deletion or data removal by contacting support or their property administrator.
                        </p>
                        <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/60 space-y-2 text-xs text-slate-400">
                            <p>• Contact your property administrator or organization super admin to deactivate account access.</p>
                            <p>• Contact support at <span className="text-teal-400 font-semibold">contact.autopilotoffices@gmail.com</span> for direct account deletion or data removal requests.</p>
                        </div>
                    </section>

                    {/* 5. Support Contact Email */}
                    <section className="bg-gradient-to-r from-teal-900/30 to-blue-900/30 border border-teal-500/20 rounded-3xl p-8 backdrop-blur-sm text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center justify-center sm:justify-start gap-2 text-teal-400 font-semibold text-xs uppercase tracking-wider mb-2">
                                <Mail className="w-4 h-4" /> Support Contact Email
                            </div>
                            <h3 className="text-2xl font-bold text-white tracking-tight mb-1">Have Privacy Questions?</h3>
                            <p className="text-slate-400 text-xs">Reach out to our support team for any data protection or account requests.</p>
                        </div>
                        <a
                            href="mailto:contact.autopilotoffices@gmail.com"
                            className="px-6 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-2xl text-sm transition-all shadow-lg shadow-teal-500/20 shrink-0"
                        >
                            contact.autopilotoffices@gmail.com
                        </a>
                    </section>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-slate-900 py-10 text-center text-xs text-slate-600">
                <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p>© {new Date().getFullYear()} Autopilot. All rights reserved.</p>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy-policy" className="hover:text-slate-400 transition-colors">Privacy Policy</Link>
                        <Link href="/" className="hover:text-slate-400 transition-colors">Home</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
