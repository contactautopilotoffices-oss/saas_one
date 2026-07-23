'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    isLoading?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'danger',
    isLoading = false
}) => {
    const typeStyles = {
        danger: {
            bg: 'bg-rose-50',
            icon: 'text-rose-500',
            button: 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'
        },
        warning: {
            bg: 'bg-amber-50',
            icon: 'text-amber-500',
            button: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
        },
        info: {
            bg: 'bg-blue-50',
            icon: 'text-blue-500',
            button: 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20'
        }
    };

    const style = typeStyles[type];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998]"
                    />
                    <div className="fixed inset-0 flex items-center justify-center z-[9999] p-4 pointer-events-none">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white dark:bg-[#161b22] rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden pointer-events-auto border border-slate-200 dark:border-[#30363d] p-8 relative"
                        >
                            <div className="flex justify-center mb-6">
                                <div className={`w-16 h-16 ${style.bg} dark:bg-opacity-10 rounded-2xl flex items-center justify-center`}>
                                    <AlertCircle className={`w-8 h-8 ${style.icon}`} />
                                </div>
                            </div>

                            <div className="text-center mb-8">
                                <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">{title}</h3>
                                <p className="text-slate-500 dark:text-slate-400 font-medium text-sm leading-relaxed">{message}</p>
                            </div>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={onConfirm}
                                    disabled={isLoading}
                                    className={`w-full py-4 ${style.button} text-white rounded-2xl font-black text-sm transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 disabled:opacity-70`}
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : confirmText}
                                </button>
                                <button
                                    onClick={onClose}
                                    disabled={isLoading}
                                    className="w-full py-4 bg-slate-100 dark:bg-[#21262d] text-slate-600 dark:text-slate-400 rounded-2xl font-black text-sm hover:bg-slate-200 dark:hover:bg-[#30363d] transition-all active:scale-[0.98]"
                                >
                                    {cancelText}
                                </button>
                            </div>

                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-all"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

export default ConfirmModal;
