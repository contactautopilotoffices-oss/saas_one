'use client';

import React from 'react';
import Link from 'next/link';
import {
    ShieldCheck,
    UserCheck,
    FileText,
    Lock,
    Trash2,
    Mail,
    ArrowLeft,
    Building2,
    Database,
    Smartphone,
    Globe,
    Scale,
    AlertCircle,
    CheckCircle2,
    RefreshCw,
    Server,
    Shield
} from 'lucide-react';

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
                        <ShieldCheck className="w-4 h-4" /> Comprehensive Privacy & Data Safety Policy
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight font-outfit mb-4">
                        Autopilot FMS Privacy Policy
                    </h1>
                    <p className="text-slate-400 text-sm sm:text-base max-w-2xl leading-relaxed">
                        This Privacy Policy governs the data collection, processing, storage, and privacy practices of <strong>Autopilot FMS</strong> (&quot;Autopilot&quot;, &quot;we&quot;, &quot;our&quot;, or &quot;us&quot;). It is designed to fully comply with Google Play Developer Policies, Google Play Data Safety declaration requirements, and international privacy standards.
                    </p>
                    <div className="flex flex-wrap gap-4 mt-6 text-xs text-slate-400">
                        <span><strong>Effective Date:</strong> August 1, 2026</span>
                        <span>•</span>
                        <span><strong>Last Updated:</strong> August 1, 2026</span>
                        <span>•</span>
                        <span><strong>Target Scope:</strong> Android App, iOS App & Web Platform</span>
                    </div>
                </div>

                {/* Policy Content Sections */}
                <div className="space-y-12">

                    {/* 1. Data Controller Information */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                                <Building2 className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">1. Data Controller Information</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            Autopilot FMS operates as an Enterprise Facility Management Software system. For personal and operational data processed within the platform:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-300 bg-slate-950/60 border border-slate-800/60 rounded-2xl p-6">
                            <div>
                                <span className="text-slate-500 block uppercase tracking-wider mb-1 font-semibold">Legal Entity Name</span>
                                <span className="font-semibold text-white">Autopilot Offices / Autopilot FMS</span>
                            </div>
                            <div>
                                <span className="text-slate-500 block uppercase tracking-wider mb-1 font-semibold">Primary Contact / Support Email</span>
                                <a href="mailto:contact.autopilotoffices@gmail.com" className="text-teal-400 font-semibold hover:underline">
                                    contact.autopilotoffices@gmail.com
                                </a>
                            </div>
                            <div>
                                <span className="text-slate-500 block uppercase tracking-wider mb-1 font-semibold">Data Protection Inquiry</span>
                                <span className="text-white">Privacy & Compliance Desk</span>
                            </div>
                            <div>
                                <span className="text-slate-500 block uppercase tracking-wider mb-1 font-semibold">Service Type</span>
                                <span className="text-white">B2B Enterprise Facility Management SaaS</span>
                            </div>
                        </div>
                    </section>

                    {/* Operational Evidence Disclosure Banner */}
                    <section className="bg-teal-500/10 border border-teal-500/30 rounded-3xl p-6 backdrop-blur-sm">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-teal-500/20 border border-teal-500/40 rounded-2xl text-teal-400 shrink-0">
                                <Shield className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2">Enterprise Operational Media Disclosure</h3>
                                <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                                    Photos, videos, and attachments uploaded through Autopilot FMS are captured and processed <strong>solely as operational evidence</strong> for maintenance work orders, inspection verification, proof of completion, visitor gate logging, asset audits, and facility compliance. Such media is strictly scoped to your enterprise organization and is accessible only to authorized users within your tenant account.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 2. Complete List of Data Collected (Data Safety Table) */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                <Database className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">2. Complete List of Data Collected & Google Play Data Safety Alignment</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            The table below details every data category collected by Autopilot FMS, matching exact Google Play Data Safety declaration standards:
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-teal-400 font-semibold bg-slate-950/80">
                                        <th className="py-3 px-4">Data Category</th>
                                        <th className="py-3 px-4">Data Types Collected</th>
                                        <th className="py-3 px-4">Operational Purpose</th>
                                        <th className="py-3 px-4">Collection Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">Personal Info</td>
                                        <td className="py-3 px-4">Name, Email Address, Phone Number, Profile Photo</td>
                                        <td className="py-3 px-4">User account creation, role authentication, notification dispatch, facility staff directory</td>
                                        <td className="py-3 px-4 text-emerald-400 font-semibold">Required</td>
                                    </tr>
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">Photos & Videos</td>
                                        <td className="py-3 px-4">Maintenance Photos, Equipment Inspection Clips, Gate Visitor Photos</td>
                                        <td className="py-3 px-4">Ticket attachments, proof of repair, asset inspection documentation, visitor pass verification</td>
                                        <td className="py-3 px-4 text-emerald-400 font-semibold">User Initiated</td>
                                    </tr>
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">Location Data</td>
                                        <td className="py-3 px-4">Precise / Coarse Location (when checked in)</td>
                                        <td className="py-3 px-4">Property check-in verification, geotagged maintenance ticket logging, guard patrol verification</td>
                                        <td className="py-3 px-4 text-teal-400 font-semibold">Optional / In-App</td>
                                    </tr>
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">Device & Identifiers</td>
                                        <td className="py-3 px-4">Device Model, OS Version, Push Notification Token (FCM Token)</td>
                                        <td className="py-3 px-4">Real-time push alerts for high-priority tickets, device diagnostics, session security</td>
                                        <td className="py-3 px-4 text-emerald-400 font-semibold">Required</td>
                                    </tr>
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">App Diagnostics</td>
                                        <td className="py-3 px-4">Crash Logs, Stack Traces, Performance Metrics</td>
                                        <td className="py-3 px-4">Identifying application bugs, preventing downtime, improving app stability</td>
                                        <td className="py-3 px-4 text-slate-400 font-semibold">Automated</td>
                                    </tr>
                                    <tr className="hover:bg-slate-950/40">
                                        <td className="py-3 px-4 font-semibold text-white">Usage Analytics</td>
                                        <td className="py-3 px-4">Feature usage frequency, page navigation paths, action timestamps</td>
                                        <td className="py-3 px-4">Optimizing facility management user experience and interface workflow efficiency</td>
                                        <td className="py-3 px-4 text-slate-400 font-semibold">Automated</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* 3. Android Permissions Explanation */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                                <Smartphone className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">3. Mobile Device Permissions Used</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            Autopilot FMS requests specific runtime permissions on Android and iOS devices to execute facility operations. Each permission is strictly tied to a core feature:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Camera (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">CAMERA</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Used to capture live photos/videos for ticket work order proof, scanning equipment QR/barcodes, and photographing visitor badges.
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Photo Library (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">READ_MEDIA_IMAGES</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Allows selecting pre-existing images from your gallery to upload as work order attachments or profile pictures.
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Push Notifications (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">POST_NOTIFICATIONS</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Delivers urgent push notifications for ticket assignments, visitor arrivals, emergency alerts, and status changes.
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Location Services (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">ACCESS_FINE_LOCATION</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Used optionally during attendance check-ins or property inspections to verify technician location on site.
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Network State (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">INTERNET / ACCESS_NETWORK_STATE</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    Required to transmit cloud synchronized ticket updates, sync data with Supabase backend, and verify network connectivity.
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-teal-400 text-sm mb-1">Storage Access (<code className="text-xs text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">READ_EXTERNAL_STORAGE</code>)</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    For legacy Android versions to download export logs, inspection receipts, and work order PDF summaries.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 4. Third-Party Services & Privacy Policy Links */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <Globe className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">4. Third-Party Service Providers</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            Autopilot integrates with trusted enterprise cloud infrastructure providers. We encourage users to review their respective privacy policies:
                        </p>
                        <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60 gap-2">
                                <div>
                                    <h4 className="text-sm font-bold text-white">Supabase (Cloud Database & Authentication)</h4>
                                    <p className="text-slate-400 text-xs">Handles secure backend database storage, user authentication JWTs, and media bucket storage.</p>
                                </div>
                                <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline shrink-0 font-semibold">
                                    Supabase Privacy Policy ↗
                                </a>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60 gap-2">
                                <div>
                                    <h4 className="text-sm font-bold text-white">Google Cloud & Firebase Cloud Messaging (FCM)</h4>
                                    <p className="text-slate-400 text-xs">Used for delivering real-time mobile push notifications to Android and iOS devices.</p>
                                </div>
                                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline shrink-0 font-semibold">
                                    Google Privacy Policy ↗
                                </a>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-slate-950/60 border border-slate-800/60 gap-2">
                                <div>
                                    <h4 className="text-sm font-bold text-white">Vercel (Web Platform Hosting)</h4>
                                    <p className="text-slate-400 text-xs">Hosts the web interface, API routes, and administrative dashboard for Autopilot FMS.</p>
                                </div>
                                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline shrink-0 font-semibold">
                                    Vercel Privacy Policy ↗
                                </a>
                            </div>
                        </div>
                    </section>

                    {/* 5. Data Retention Policy */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                                <Server className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">5. Data Retention Schedule</h2>
                        </div>
                        <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
                            <p>
                                We retain personal and operational data only for as long as necessary to fulfill contractual facility management duties:
                            </p>
                            <ul className="space-y-2 text-xs text-slate-400 list-disc pl-5">
                                <li><strong>Account & Profile Information:</strong> Retained for the duration of the active subscription or until deleted by your organization super-admin.</li>
                                <li><strong>Maintenance Tickets & Asset Logs:</strong> Retained per your enterprise organization&apos;s data retention agreement (typically 1 to 5 years for compliance and audit history).</li>
                                <li><strong>Device & Diagnostic Logs:</strong> Automatically purged after 90 days.</li>
                                <li><strong>Temporary Upload Buffers:</strong> Purged immediately upon successful cloud database synchronization.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 6. Children's Privacy Statement */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                                <AlertCircle className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">6. Children&apos;s Privacy</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed">
                            Autopilot FMS is designed strictly for enterprise, commercial, and organizational workplace use. The application is not intended for, directed at, or formatted for children under 13 years of age (or under 16 in certain European jurisdictions). We do not knowingly collect personal data from children. If we become aware that a child has provided us with personal information, we immediately delete such records.
                        </p>
                    </section>

                    {/* 7. User Rights */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <UserCheck className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">7. User Rights & Controls</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-4">
                            Regardless of your geographic location, Autopilot affords all users comprehensive data protection rights:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
                                <strong className="text-white block mb-1">Right to Access</strong> Request a complete copy of all personal records held under your profile.
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
                                <strong className="text-white block mb-1">Right to Rectification</strong> Correct inaccurate profile information or update profile details directly within app settings.
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
                                <strong className="text-white block mb-1">Right to Erasure (Deletion)</strong> Request full deletion of your account and personal data.
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60">
                                <strong className="text-white block mb-1">Right to Withdraw Consent</strong> Revoke mobile permissions (Camera, Location, Push Alerts) at any time via Android OS settings.
                            </div>
                        </div>
                    </section>

                    {/* 8. International Data Transfers */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                                <Globe className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">8. International Data Transfers</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed">
                            Data collected by Autopilot FMS may be processed and stored on secure cloud servers operating in multiple global regions depending on your enterprise tenant deployment (including AWS, Supabase, and Vercel data centers). We ensure all international transfers adhere to standard contractual clauses and rigorous security guarantees.
                        </p>
                    </section>

                    {/* 9. Cookies & Local Storage */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-yellow-400">
                                <FileText className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">9. Web Storage, Cookies & Tokens</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed">
                            For web application access and mobile session persistence, Autopilot utilizes local storage, session storage, and HTTPS-only authentication tokens (JWT). These mechanisms are strictly essential for keeping you securely logged in and remembering user UI preferences (such as dark mode and selected tenant property). We do not use third-party tracking cookies.
                        </p>
                    </section>

                    {/* 10. Technical Security Measures */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                <Lock className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">10. Security Implementation Details</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-300">
                            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-white mb-1">TLS 1.2+ Network Encryption</h4>
                                <p className="text-slate-400">All data in transit between mobile app, web interface, and server APIs is encrypted using TLS 1.2/1.3 standards.</p>
                            </div>
                            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-white mb-1">JWT Authentication & RBAC</h4>
                                <p className="text-slate-400">Cryptographically signed JSON Web Tokens with strict Role-Based Access Controls (Super Admin, Property Admin, Staff, Security Guard).</p>
                            </div>
                            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-white mb-1">Database Backups & Isolation</h4>
                                <p className="text-slate-400">Automated encrypted database backups and multi-tenant row-level security (RLS) policies ensuring cross-tenant isolation.</p>
                            </div>
                            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60">
                                <h4 className="font-bold text-white mb-1">Audit Logging & Least Privilege</h4>
                                <p className="text-slate-400">Comprehensive internal system audit logging for ticket modifications and principle of least privilege access for system administrators.</p>
                            </div>
                        </div>
                    </section>

                    {/* 11. Legal Basis for Processing */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <Scale className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">11. Legal Basis for Data Processing</h2>
                        </div>
                        <div className="space-y-3 text-xs text-slate-300">
                            <p className="text-sm">We process personal and operational data under the following legal bases:</p>
                            <ul className="space-y-2 list-disc pl-5 text-slate-400">
                                <li><strong>Contract Performance:</strong> To fulfill contracted SaaS facility management operations for your employer or property management provider.</li>
                                <li><strong>Legitimate Interests:</strong> To maintain system performance, diagnose application crashes, ensure security, and optimize user workflows.</li>
                                <li><strong>User Consent:</strong> For runtime permissions requested by mobile devices (Camera, Location, Push Notifications).</li>
                                <li><strong>Legal Compliance:</strong> To satisfy accounting, building safety, and regulatory compliance record-keeping.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 12. Account & Data Deletion Portal */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                                <Trash2 className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">12. Data Deletion Instructions</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed mb-4">
                            In compliance with Google Play Data Deletion requirements, users can request complete removal of their personal account and associated data through either of the following methods:
                        </p>
                        <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/60 space-y-3 text-xs text-slate-300">
                            <div className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div>
                                    <strong className="text-white">In-App Deletion Request:</strong> Navigate to Settings &gt; Account Security &gt; Request Account Deletion.
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div>
                                    <strong className="text-white">Direct Email Request:</strong> Send an email to <a href="mailto:contact.autopilotoffices@gmail.com" className="text-teal-400 font-semibold hover:underline">contact.autopilotoffices@gmail.com</a> with the subject line <em>&quot;Account Deletion Request&quot;</em>. Requests are processed within 7 business days.
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div>
                                    <strong className="text-white">Online Portal:</strong> Visit our dedicated <Link href="/data-deletion" className="text-teal-400 font-semibold hover:underline">Data Deletion Request Page</Link>.
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* 13. Policy Updates */}
                    <section className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-sm shadow-xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                <RefreshCw className="w-5 h-5" />
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">13. Policy Updates & Changes</h2>
                        </div>
                        <p className="text-slate-300 text-sm leading-relaxed">
                            We may update this Privacy Policy from time to time to reflect changes in app functionality, regulatory mandates, or Google Play policy updates. Material updates will be communicated by updating the &quot;Last Updated&quot; date at the top of this policy and publishing a notification within the app interface.
                        </p>
                    </section>

                    {/* 14. Contact Information */}
                    <section className="bg-gradient-to-r from-teal-900/30 to-blue-900/30 border border-teal-500/20 rounded-3xl p-8 backdrop-blur-sm text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-6">
                        <div>
                            <div className="flex items-center justify-center sm:justify-start gap-2 text-teal-400 font-semibold text-xs uppercase tracking-wider mb-2">
                                <Mail className="w-4 h-4" /> Section 14: Data Protection Contact
                            </div>
                            <h3 className="text-2xl font-bold text-white tracking-tight mb-1">Contact Support & Compliance</h3>
                            <p className="text-slate-400 text-xs">For questions, feedback, or data subject rights requests, contact our privacy desk.</p>
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
                    <p>© {new Date().getFullYear()} Autopilot FMS. All rights reserved.</p>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy-policy" className="hover:text-slate-400 transition-colors">Privacy Policy</Link>
                        <Link href="/terms" className="hover:text-slate-400 transition-colors">Terms of Service</Link>
                        <Link href="/data-deletion" className="hover:text-slate-400 transition-colors">Data Deletion</Link>
                        <Link href="/" className="hover:text-slate-400 transition-colors">Home</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

