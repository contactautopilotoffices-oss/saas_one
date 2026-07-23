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

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
    const { user, membership } = useAuth();
    const params = useParams();
    const pathname = usePathname();
    const orgId = params.orgId as string || membership?.org_id;
    const propertyId = params.propertyId as string || null; // Will be defined if property context

    const [type, setType] = useState<'bug' | 'feature'>('bug');
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({
        message: '', type: 'success', visible: false
    });

    // Form state
    const [text, setText] = useState('');
    
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
        
        // Filter out non-images or too many files
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
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    };

    const uploadFiles = async (): Promise<string[]> => {
        const urls: string[] = [];
        const totalFiles = files.length;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                setUploadProgress(Math.round(((i) / totalFiles) * 100));
                
                // Compress image
                const compressedFile = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, maxSizeKB: 1000 });
                
                // Upload to Supabase
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${compressedFile.name}`;
                const { data, error } = await supabase.storage
                    .from('feedback-attachments')
                    .upload(fileName, compressedFile);
                
                if (error) throw error;

                const { data: { publicUrl } } = supabase.storage
                    .from('feedback-attachments')
                    .getPublicUrl(data.path);
                    
                urls.push(publicUrl);
            } catch (error) {
                console.error('Upload failed:', error);
                throw new Error('Failed to upload screenshots');
            }
        }
        setUploadProgress(100);
        return urls;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!text.trim()) {
            showToast(type === 'bug' ? 'Please describe the bug' : 'Please describe the feature', 'error');
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

            showToast('Feedback submitted successfully! Our AI will analyze it shortly.', 'success');
            
            // Reset and close
            setTimeout(() => {
                setFiles([]);
                onClose();
                setIsLoading(false);
            }, 1500);

        } catch (error: any) {
            console.error('Submit error:', error);
            showToast(error.message, 'error');
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
                        <div className="flex items-center justify-between p-4 border-b border-border bg-surface-elevated shrink-0">
                            <h2 className="text-lg font-bold font-display text-text-primary">Send Feedback</h2>
                            <button
                                onClick={onClose}
                                className="p-2 text-text-tertiary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                            {/* Type Toggle */}
                            <div className="flex p-1 bg-black/5 dark:bg-white/5 rounded-xl mb-6">
                                <button
                                    type="button"
                                    onClick={() => setType('bug')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                        type === 'bug' 
                                            ? 'bg-surface text-primary shadow-sm' 
                                            : 'text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    <Bug className="w-4 h-4" />
                                    Report Bug
                                </button>
                                <button
                                    type="button"
                                    disabled
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all text-text-tertiary cursor-not-allowed bg-black/5 dark:bg-white/5 opacity-70"
                                >
                                    <Lightbulb className="w-4 h-4 opacity-50" />
                                    Request Feature <span className="text-[10px] uppercase tracking-wider text-primary font-bold">(Coming Soon)</span>
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-semibold text-text-primary mb-1.5">
                                        {type === 'bug' ? 'Describe the issue' : 'Describe the feature'} <span className="text-error">*</span>
                                    </label>
                                    <textarea
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        placeholder={type === 'bug' ? "What happened? What were you trying to do?" : "What would you like us to build?"}
                                        className="w-full bg-black/5 dark:bg-white/5 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[120px] resize-none"
                                        required
                                    />
                                </div>



                                {/* Screenshots */}
                                <div>
                                    <label className="block text-sm font-semibold text-text-primary mb-1.5">
                                        Screenshots <span className="text-text-tertiary font-normal">(Optional, max 3)</span>
                                    </label>
                                    
                                    <div className="flex gap-3 flex-wrap">
                                        {files.map((file, idx) => (
                                            <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border group bg-black/5 dark:bg-white/5">
                                                <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                                                <button
                                                    type="button"
                                                    onClick={() => removeFile(idx)}
                                                    className="absolute top-1 right-1 bg-black/50 hover:bg-rose-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
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
                                                <span className="text-[10px] font-medium">Upload</span>
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
                                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        {uploadProgress > 0 ? `Uploading (${uploadProgress}%)...` : 'Submitting...'}
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-5 h-5" />
                                        Send to AI Engine
                                    </>
                                )}
                            </button>
                            <p className="text-center text-[11px] text-text-tertiary mt-3 font-medium">
                                Your feedback will be analyzed and processed by our AI Auto-Dev Pipeline.
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
