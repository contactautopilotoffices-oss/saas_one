'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bug, Lightbulb, Image as ImageIcon, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import { compressImage } from '@/frontend/utils/image-compression';
import { Toast } from './Toast';
import { useParams, usePathname } from 'next/navigation';

interface FeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const BUG_CATEGORIES = [
    { id: 'ui_broken', label: '🎨 UI / Display' },
    { id: 'data_not_loading', label: '🔄 Data Loading' },
    { id: 'wrong_data', label: '⚠️ Incorrect Info' },
    { id: 'upload_failed', label: '📁 Upload Issue' },
    { id: 'permission_error', label: '🔒 Permission Error' },
    { id: 'performance', label: '⚡ Slow / Lag' },
    { id: 'other', label: '💡 Other' }
];

const SEVERITIES = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'critical', label: 'Critical' }
];

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
    const { user, membership } = useAuth();
    const params = useParams();
    const pathname = usePathname();
    const orgId = params.orgId as string || membership?.org_id;
    const propertyId = params.propertyId as string || null;

    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({
        message: '', type: 'success', visible: false
    });

    // Form state
    const [text, setText] = useState('');
    const [category, setCategory] = useState('ui_broken');
    const [severity, setSeverity] = useState('medium');
    
    // Attachments
    const [files, setFiles] = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const supabase = createClient();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const selectedFiles = Array.from(e.target.files);
        
        const validFiles = selectedFiles.filter(f => f.type.startsWith('image/'));
        if (validFiles.length + files.length > 3) {
            showToast('Maximum 3 screenshots allowed', 'error');
            return;
        }

        setFiles(prev => [...prev, ...validFiles]);
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type, visible: true });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3500);
    };

    // Robust Image Uploader with Base64 Fallback
    const uploadFiles = async (): Promise<string[]> => {
        const urls: string[] = [];
        const totalFiles = files.length;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                setUploadProgress(Math.round(((i + 0.5) / totalFiles) * 100));
                
                // Compress image first
                const compressedFile = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, maxSizeKB: 800 });
                
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${compressedFile.name}`;
                
                // Try standard Supabase Storage upload
                const { data, error } = await supabase.storage
                    .from('feedback-attachments')
                    .upload(fileName, compressedFile, { upsert: true });
                
                if (!error && data?.path) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('feedback-attachments')
                        .getPublicUrl(data.path);
                    urls.push(publicUrl);
                } else {
                    // Fallback to Base64 encoding so upload never fails if storage bucket policies block client
                    const base64Url = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(compressedFile);
                    });
                    urls.push(base64Url);
                }
            } catch (error) {
                console.warn('[Feedback Upload Fallback] Using base64 due to:', error);
                const base64Url = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(file);
                });
                urls.push(base64Url);
            }
        }
        setUploadProgress(100);
        return urls;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!text.trim()) {
            showToast('Please describe the issue', 'error');
            return;
        }

        setIsLoading(true);
        setUploadProgress(0);

        try {
            let uploadedUrls: string[] = [];
            if (files.length > 0) {
                uploadedUrls = await uploadFiles();
            }

            const payload = {
                type: 'bug',
                organization_id: orgId,
                property_id: propertyId,
                attachments: uploadedUrls,
                error_text: text,
                error_category: category,
                severity: severity,
                error_page_url: pathname,
            };

            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to submit feedback');
            }

            showToast('Bug report submitted! Our team & AI pipeline will inspect it.', 'success');
            
            // Reset and close
            setTimeout(() => {
                setText('');
                setFiles([]);
                onClose();
                setIsLoading(false);
            }, 1200);

        } catch (error: any) {
            console.error('Submit error:', error);
            showToast(error.message || 'Something went wrong', 'error');
            setIsLoading(false);
        }
    };

    if (!mounted) return null;

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                />
            )}
            {isOpen && (
                <motion.div
                    key="modal"
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface border border-border shadow-2xl rounded-2xl z-50 overflow-hidden flex flex-col max-h-[90vh]"
                >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-elevated shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                    <Bug className="w-4 h-4" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-text-primary">Send Feedback & Issue</h2>
                                    <p className="text-xs text-text-secondary">Directly notify Org Admin & AI Orchestrator</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 text-text-tertiary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
                            {/* Type Toggle */}
                            <div className="grid grid-cols-2 p-1.5 bg-muted/60 dark:bg-white/5 rounded-xl border border-border gap-1.5">
                                <button
                                    type="button"
                                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all bg-surface text-primary shadow-sm border border-primary/20"
                                >
                                    <Bug className="w-4 h-4 text-primary shrink-0" />
                                    <span className="truncate">Report Bug</span>
                                </button>
                                <button
                                    type="button"
                                    disabled
                                    className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs sm:text-sm font-medium text-text-tertiary cursor-not-allowed bg-black/5 dark:bg-white/5 opacity-80"
                                >
                                    <Lightbulb className="w-3.5 h-3.5 opacity-60 text-secondary shrink-0" />
                                    <span className="truncate">Request Feature</span>
                                    <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-secondary font-black bg-secondary/10 rounded border border-secondary/20 shrink-0">
                                        SOON
                                    </span>
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* Bug Category */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">
                                        Category
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {BUG_CATEGORIES.map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setCategory(cat.id)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                                                    category === cat.id
                                                        ? 'bg-primary text-white border-primary shadow-sm'
                                                        : 'bg-black/5 dark:bg-white/5 text-text-secondary border-border hover:bg-black/10 dark:hover:bg-white/10'
                                                }`}
                                            >
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">
                                        Describe the Issue <span className="text-primary">*</span>
                                    </label>
                                    <textarea
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        placeholder="What happened? What page were you on? What steps reproduce this bug?"
                                        className="w-full bg-black/5 dark:bg-white/5 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[110px] resize-none"
                                        required
                                    />
                                </div>

                                {/* Screenshots */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">
                                        Screenshots <span className="text-text-tertiary font-normal">(Optional, max 3)</span>
                                    </label>
                                    
                                    <div className="flex gap-3 flex-wrap">
                                        {files.map((file, idx) => (
                                            <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border group bg-black/5 dark:bg-white/5 shadow-sm">
                                                <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                                                <button
                                                    type="button"
                                                    onClick={() => removeFile(idx)}
                                                    className="absolute top-1 right-1 bg-black/70 hover:bg-rose-500 text-white rounded-full p-1 transition-all"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                        
                                        {files.length < 3 && (
                                            <button
                                                type="button"
                                                onClick={() => fileInputRef.current?.click()}
                                                className="w-20 h-20 rounded-xl border-2 border-dashed border-border hover:border-primary flex flex-col items-center justify-center text-text-tertiary hover:text-primary transition-colors bg-black/5 dark:bg-white/5"
                                            >
                                                <ImageIcon className="w-6 h-6 mb-1" />
                                                <span className="text-[10px] font-semibold">Add Photo</span>
                                            </button>
                                        )}
                                        <input 
                                            type="file" 
                                            ref={fileInputRef} 
                                            onChange={handleFileChange} 
                                            accept="image/*" 
                                            multiple 
                                            className="hidden" 
                                        />
                                    </div>
                                </div>
                            </form>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-border bg-surface-elevated shrink-0">
                            <button
                                onClick={handleSubmit}
                                disabled={isLoading || !text.trim()}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white transition-all shadow-md bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        {uploadProgress > 0 ? `Uploading (${uploadProgress}%)...` : 'Submitting...'}
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-4 h-4" />
                                        Submit Bug Report
                                    </>
                                )}
                            </button>
                            <p className="text-center text-[11px] text-text-tertiary mt-2.5 font-medium">
                                Submissions are visible to Org Admins and processed by AI Orchestrator.
                            </p>
                        </div>
                    </motion.div>
            )}
            
            <Toast 
                visible={toast.visible} 
                message={toast.message} 
                type={toast.type} 
                onClose={() => setToast(prev => ({ ...prev, visible: false }))} 
            />
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
}
