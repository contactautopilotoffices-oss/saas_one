'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { X, Save, Eye, Code, RotateCcw, Info } from 'lucide-react';

// Dynamically import the heavy editor to avoid SSR issues
const EmailEditor = dynamic(() => import('react-email-editor'), { ssr: false, loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 font-medium text-sm">Loading email editor...</p>
        </div>
    </div>
)});

// Default template bodies per module type
export const DEFAULT_TEMPLATES: Record<string, object> = {
    meeting_rooms: {
        counters: { u_row: 5, u_column: 8, u_content: 10 },
        body: {
            id: 'default-meeting-room',
            rows: [
                {
                    id: 'header-row',
                    cells: [1],
                    columns: [{
                        id: 'header-col',
                        contents: [{
                            id: 'heading',
                            type: 'heading',
                            values: {
                                text: 'Meeting Room {{action}} Notification',
                                headingType: 'h2',
                                fontSize: '24px',
                                fontWeight: 800,
                                color: '#0f172a',
                                textAlign: 'left',
                                lineHeight: '140%',
                                padding: { top: 30, right: 30, bottom: 10, left: 30 }
                            }
                        }, {
                            id: 'intro',
                            type: 'text',
                            values: {
                                text: '<p>A meeting room has been <strong>{{action_lower}}</strong> at <strong>{{propertyName}}</strong>.</p>',
                                color: '#475569',
                                fontSize: '15px',
                                lineHeight: '180%',
                                padding: { top: 5, right: 30, bottom: 10, left: 30 }
                            }
                        }],
                        values: { backgroundColor: '#ffffff', padding: '0px' }
                    }],
                    values: { backgroundColor: '#ffffff', padding: '0px' }
                },
                {
                    id: 'booking-details-row',
                    cells: [1],
                    columns: [{
                        id: 'booking-col',
                        contents: [{
                            id: 'booking-heading',
                            type: 'text',
                            values: {
                                text: '<p style="font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:#64748b;margin-bottom:12px">BOOKING DETAILS</p>',
                                padding: { top: 20, right: 30, bottom: 4, left: 30 }
                            }
                        }, {
                            id: 'booking-body',
                            type: 'text',
                            values: {
                                text: '<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;color:#64748b;font-weight:600;width:130px">Room Name:</td><td style="padding:8px 0;color:#0f172a;font-weight:500">{{roomName}}</td></tr><tr><td style="padding:8px 0;color:#64748b;font-weight:600">Date:</td><td style="padding:8px 0;color:#0f172a;font-weight:500">{{date}}</td></tr><tr><td style="padding:8px 0;color:#64748b;font-weight:600">Time:</td><td style="padding:8px 0;color:#0f172a;font-weight:500">{{startTime}} – {{endTime}}</td></tr></table>',
                                padding: { top: 5, right: 30, bottom: 20, left: 30 }
                            }
                        }],
                        values: { backgroundColor: '#f8fafc', padding: '0px', border: { borderRadius: '16px' } }
                    }],
                    values: { backgroundColor: '#ffffff', padding: '0 30px' }
                },
                {
                    id: 'requester-details-row',
                    cells: [1],
                    columns: [{
                        id: 'req-col',
                        contents: [{
                            id: 'req-heading',
                            type: 'text',
                            values: {
                                text: '<p style="font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:11px;color:#64748b;margin-bottom:12px">REQUESTER DETAILS</p>',
                                padding: { top: 20, right: 30, bottom: 4, left: 30 }
                            }
                        }, {
                            id: 'req-body',
                            type: 'text',
                            values: {
                                text: '<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;color:#64748b;font-weight:600;width:130px">Name:</td><td style="padding:8px 0;color:#0f172a;font-weight:500">{{requesterName}}</td></tr><tr><td style="padding:8px 0;color:#64748b;font-weight:600">Email:</td><td style="padding:8px 0;color:#0f172a;font-weight:500">{{requesterEmail}}</td></tr></table>',
                                padding: { top: 5, right: 30, bottom: 20, left: 30 }
                            }
                        }],
                        values: { backgroundColor: '#f8fafc', padding: '0px', border: { borderRadius: '16px' } }
                    }],
                    values: { backgroundColor: '#ffffff', padding: '0 30px' }
                },
                {
                    id: 'footer-row',
                    cells: [1],
                    columns: [{
                        id: 'footer-col',
                        contents: [{
                            id: 'footer-text',
                            type: 'text',
                            values: {
                                text: '<p>Please log in to the FMS Dashboard to view full details.</p>',
                                fontSize: '13px',
                                color: '#94a3b8',
                                fontStyle: 'italic',
                                lineHeight: '150%',
                                padding: { top: 20, right: 30, bottom: 30, left: 30 }
                            }
                        }],
                        values: { backgroundColor: '#ffffff', padding: '0px' }
                    }],
                    values: { backgroundColor: '#ffffff', padding: '0px' }
                }
            ],
            values: {
                backgroundColor: '#f1f5f9',
                contentWidth: '600px',
                fontFamily: { label: 'Segoe UI', value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }
            }
        }
    }
};

interface EmailTemplateEditorProps {
    orgId: string;
    orgName: string;
    moduleId: string;
    moduleName: string;
    /** JSON design from DB (already parsed object) */
    initialDesign?: object | null;
    onSave: (moduleId: string, design: object, html: string) => Promise<void>;
    onClose: () => void;
}

// Available variables panel
const VARIABLES: Record<string, { label: string; vars: string[] }> = {
    meeting_rooms: {
        label: 'Meeting Room Variables',
        vars: ['{{action}}', '{{action_lower}}', '{{roomName}}', '{{date}}', '{{startTime}}', '{{endTime}}', '{{propertyName}}', '{{requesterName}}', '{{requesterEmail}}']
    },
    procurement: {
        label: 'Procurement Variables',
        vars: ['{{requestId}}', '{{propertyName}}', '{{requesterName}}', '{{requesterEmail}}', '{{status}}', '{{items}}']
    }
};

export default function EmailTemplateEditor({
    orgId, orgName, moduleId, moduleName, initialDesign, onSave, onClose
}: EmailTemplateEditorProps) {
    const editorRef = useRef<any>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [savedOk, setSavedOk] = useState(false);
    const [showVars, setShowVars] = useState(true);

    const moduleVars = VARIABLES[moduleId];
    const defaultDesign = DEFAULT_TEMPLATES[moduleId];

    const onEditorReady = useCallback(() => {
        // Add small delay as safety net for the editor iframe to fully initialize
        setTimeout(() => {
            if (editorRef.current?.editor) {
                const design = initialDesign || defaultDesign;
                if (design) {
                    editorRef.current.editor.loadDesign(design);
                }
            }
        }, 200);
    }, [initialDesign, defaultDesign]);

    const handleSave = useCallback(async () => {
        if (!editorRef.current?.editor) return;
        setIsSaving(true);
        try {
            editorRef.current.editor.exportHtml(async ({ design, html }: { design: object; html: string }) => {
                await onSave(moduleId, design, html);
                setSavedOk(true);
                setTimeout(() => setSavedOk(false), 3000);
                setIsSaving(false);
            });
        } catch {
            setIsSaving(false);
        }
    }, [moduleId, onSave]);

    const handleReset = useCallback(() => {
        if (editorRef.current?.editor && defaultDesign) {
            editorRef.current.editor.loadDesign(defaultDesign);
        }
    }, [defaultDesign]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-700 flex-shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all">
                        <X className="w-5 h-5" />
                    </button>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{orgName}</p>
                        <h2 className="text-white font-black text-lg leading-tight">{moduleName} Email Template</h2>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowVars(v => !v)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-bold transition-all"
                    >
                        <Info className="w-4 h-4" />
                        {showVars ? 'Hide' : 'Show'} Variables
                    </button>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-bold transition-all"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Reset to Default
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl font-black text-sm uppercase tracking-widest transition-all disabled:opacity-50 ${
                            savedOk ? 'bg-blue-500 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                        }`}
                    >
                        <Save className="w-4 h-4" />
                        {isSaving ? 'Saving...' : savedOk ? 'Saved!' : 'Save Template'}
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Variables Sidebar */}
                {showVars && moduleVars && (
                    <div className="w-72 bg-slate-800 border-r border-slate-700 p-5 overflow-y-auto flex-shrink-0">
                        <h3 className="text-slate-300 font-black text-xs uppercase tracking-widest mb-4">{moduleVars.label}</h3>
                        <p className="text-slate-500 text-xs mb-4 leading-relaxed">
                            Use these variables in your template. They will be automatically replaced with real data when an email is sent.
                        </p>
                        <div className="space-y-2">
                            {moduleVars.vars.map(v => (
                                <div key={v} className="bg-slate-900 rounded-xl px-3 py-2 flex items-center justify-between group">
                                    <code className="text-emerald-400 text-xs font-mono font-bold">{v}</code>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(v)}
                                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white transition-all"
                                        title="Copy"
                                    >
                                        <Code className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 p-3 bg-slate-900 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-500 leading-relaxed">
                                <span className="text-amber-400 font-bold">Tip:</span> Drag a Text block from the editor, then type the variable exactly as shown above (e.g., <code className="text-emerald-400">{'{{roomName}}'}</code>).
                            </p>
                        </div>
                    </div>
                )}

                {/* Editor Area */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <EmailEditor
                        ref={editorRef}
                        onReady={onEditorReady}
                        minHeight="100%"
                        options={{
                            id: 'editor',
                            displayMode: 'email',
                            fonts: {
                                showDefaultFonts: true
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
