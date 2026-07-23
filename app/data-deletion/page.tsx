'use client';

import Link from 'next/link';

export default function DataDeletion() {
    return (
        <div className="min-h-screen bg-slate-950 text-white">
            <div className="max-w-3xl mx-auto px-6 py-16">
                <Link href="/" className="text-xs text-white/40 hover:text-white/60 uppercase tracking-widest font-bold mb-8 inline-block">
                    &larr; Back to Home
                </Link>

                <h1 className="text-4xl font-bold mb-2 font-outfit">Data Deletion Instructions</h1>
                <p className="text-white/40 text-sm mb-10">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

                <div className="space-y-8 text-white/70 text-sm leading-relaxed">
                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">1. How to Request Data Deletion</h2>
                        <p>
                            If you wish to have your data deleted from Autopilot, you can submit a request by
                            emailing us at <a href="mailto:contact.autopilotoffices@gmail.com" className="text-white underline">contact.autopilotoffices@gmail.com</a> with
                            the subject line &ldquo;Data Deletion Request&rdquo;.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">2. What Data We Delete</h2>
                        <p>Upon receiving your request, we will delete:</p>
                        <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                            <li>Your user account and profile information</li>
                            <li>Any leads or contacts you submitted via Facebook Lead Ads</li>
                            <li>Associated activity logs and communication records</li>
                            <li>Any other personal data linked to your account</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">3. Processing Time</h2>
                        <p>
                            We will process your deletion request within 30 days of receiving it.
                            You will receive a confirmation email once your data has been permanently removed
                            from our systems.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">4. Data Retained for Legal Obligations</h2>
                        <p>
                            Certain data may be retained if required by law or for legitimate business purposes
                            such as fraud prevention, audit compliance, or resolving disputes. Any retained data
                            will be securely stored and deleted once the retention period expires.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-white mb-3">5. Contact</h2>
                        <p>
                            For any questions regarding data deletion, please contact us
                            at <a href="mailto:contact.autopilotoffices@gmail.com" className="text-white underline">contact.autopilotoffices@gmail.com</a>.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
