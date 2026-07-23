'use client';

import React, { useState } from 'react';
import ImportWizard from '@/frontend/components/crm/ImportWizard';

export default function ImportPage() {
    const [isWizardOpen, setIsWizardOpen] = useState(false);

    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-text-primary">Import Leads</h1>
                <p className="text-sm text-text-secondary mt-1">
                    Upload a CSV or Excel file to import leads into your CRM
                </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-12">
                <div className="max-w-2xl mx-auto text-center">
                    <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                    </div>

                    <h2 className="text-xl font-semibold text-text-primary mb-2">Import Your Leads</h2>
                    <p className="text-text-secondary mb-8">
                        Upload a CSV or Excel file (.xlsx) with your lead data. We'll automatically detect column mappings and check for duplicates.
                    </p>

                    <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="bg-slate-50 rounded-xl p-4">
                            <div className="text-2xl font-bold text-primary">1</div>
                            <p className="text-sm text-text-secondary mt-1">Upload File</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4">
                            <div className="text-2xl font-bold text-primary">2</div>
                            <p className="text-sm text-text-secondary mt-1">Map Columns</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4">
                            <div className="text-2xl font-bold text-primary">3</div>
                            <p className="text-sm text-text-secondary mt-1">Import Leads</p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            onClick={() => setIsWizardOpen(true)}
                            className="px-8 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            Upload & Import
                        </button>
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-200">
                        <h3 className="text-sm font-semibold text-text-primary mb-3">Supported Formats</h3>
                        <div className="flex items-center justify-center gap-6 text-sm text-text-secondary">
                            <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                CSV (.csv)
                            </div>
                            <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                Excel (.xlsx)
                            </div>
                            <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                Up to 5,000 rows
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <ImportWizard
                isOpen={isWizardOpen}
                onClose={() => setIsWizardOpen(false)}
                onComplete={(results) => {
                    console.log('Import completed:', results);
                }}
            />
        </div>
    );
}
