'use client';

import React from 'react';
import { HelpCircle, MessageSquare, BookOpen, Phone, Mail, ExternalLink } from 'lucide-react';

export default function HelpPage() {
    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">Help & Support</h1>
                <p className="text-sm text-text-secondary mt-1">Get help with your CRM, learn best practices, and reach out to support</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface rounded-2xl border border-border p-6 hover:border-primary/30 transition-colors">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-4">
                        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="text-sm font-black text-text-primary mb-1">Getting Started Guide</h2>
                    <p className="text-xs text-text-secondary leading-relaxed">
                        Learn the basics of managing leads, follow-ups, and closing deals with the CRM.
                    </p>
                </div>

                <div className="bg-surface rounded-2xl border border-border p-6 hover:border-primary/30 transition-colors">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center mb-4">
                        <MessageSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <h2 className="text-sm font-black text-text-primary mb-1">Best Practices</h2>
                    <p className="text-xs text-text-secondary leading-relaxed">
                        Tips on lead qualification, follow-up cadence, and pipeline management.
                    </p>
                </div>

                <div className="bg-surface rounded-2xl border border-border p-6 hover:border-primary/30 transition-colors">
                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center mb-4">
                        <Phone className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h2 className="text-sm font-black text-text-primary mb-1">Contact Support</h2>
                    <p className="text-xs text-text-secondary leading-relaxed">
                        Reach out to your admin or the support team for technical help.
                    </p>
                </div>

                <div className="bg-surface rounded-2xl border border-border p-6 hover:border-primary/30 transition-colors">
                    <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center mb-4">
                        <HelpCircle className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <h2 className="text-sm font-black text-text-primary mb-1">FAQ</h2>
                    <p className="text-xs text-text-secondary leading-relaxed">
                        Answers to common questions about lead statuses, assignments, and reporting.
                    </p>
                </div>
            </div>
        </div>
    );
}
