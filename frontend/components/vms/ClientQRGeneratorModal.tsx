'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, QrCode, Copy, Download, Printer, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Two things get a QR code off the back of a property:
 *  - 'tenant-onboarding' — clients scan to self-register (the original use)
 *  - 'visitor-kiosk'     — the public lobby check-in screen, /kiosk/<propertyId>
 * Same copy/download/print plumbing, different destination and wording.
 */
export type QRGeneratorVariant = 'tenant-onboarding' | 'visitor-kiosk';

interface ClientQRGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    propertyName: string;
    variant?: QRGeneratorVariant;
}

const VARIANTS: Record<QRGeneratorVariant, {
    path: (propertyId: string) => string;
    heading: string;
    blurb: string;
    posterSubtitle: string;
    posterFooter: string;
    captionUnderQR: string;
    fileLabel: string;
}> = {
    'tenant-onboarding': {
        path: (propertyId) => `/onboard?propertyId=${propertyId}&role=tenant`,
        heading: 'Client Onboarding QR',
        blurb: 'Clients scan this QR code to register, get instant tenant access, and land on their workspace dashboard.',
        posterSubtitle: 'Client & Tenant Self-Onboarding QR',
        posterFooter: 'Scan with phone camera to register & raise requests',
        captionUnderQR: 'Scan to Register as Client / Tenant',
        fileLabel: 'Client_Onboarding_QR',
    },
    'visitor-kiosk': {
        path: (propertyId) => `/kiosk/${propertyId}`,
        heading: 'Visitor Kiosk Link',
        blurb: 'Open this link on the lobby tablet to run the check-in kiosk, or print the QR so visitors can check themselves in from their own phone. No login required.',
        posterSubtitle: 'Visitor Check-In',
        posterFooter: 'Scan with phone camera to check in',
        captionUnderQR: 'Scan to Check In as a Visitor',
        fileLabel: 'Visitor_Kiosk_QR',
    },
};

export default function ClientQRGeneratorModal({
    isOpen,
    onClose,
    propertyId,
    propertyName,
    variant = 'tenant-onboarding'
}: ClientQRGeneratorModalProps) {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const config = VARIANTS[variant];

    // The modal only ever renders client-side, so window.location.origin is the
    // real answer; NEXT_PUBLIC_APP_URL is the inlined fallback for safety.
    const baseUrl = typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const qrUrl = `${baseUrl}${config.path(propertyId)}`;

    const handleCopyLink = () => {
        navigator.clipboard.writeText(qrUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownloadQR = () => {
        const svgElement = document.getElementById('property-qr-svg');
        if (!svgElement) return;

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            canvas.width = img.width + 80;
            canvas.height = img.height + 120;
            if (ctx) {
                // Background fill
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw QR Code
                ctx.drawImage(img, 40, 40);

                // Add Property Name Footer
                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(propertyName || 'Property Onboarding', canvas.width / 2, canvas.height - 40);

                ctx.fillStyle = '#64748b';
                ctx.font = '12px sans-serif';
                ctx.fillText(config.captionUnderQR, canvas.width / 2, canvas.height - 20);

                const pngUrl = canvas.toDataURL('image/png');
                const downloadLink = document.createElement('a');
                downloadLink.href = pngUrl;
                downloadLink.download = `${config.fileLabel}_${(propertyName || 'Property').replace(/\s+/g, '_')}.png`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            }
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const svgElement = document.getElementById('property-qr-svg');
        const svgData = svgElement ? new XMLSerializer().serializeToString(svgElement) : '';

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <title>${config.posterSubtitle} Poster - ${propertyName}</title>
                    <style>
                        body { font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 40px; color: #0f172a; }
                        .poster { border: 4px solid #0284c7; padding: 40px; border-radius: 24px; max-width: 500px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
                        .title { font-size: 28px; font-weight: 900; margin-bottom: 8px; color: #0f172a; }
                        .subtitle { font-size: 16px; color: #64748b; margin-bottom: 30px; }
                        .qr-box { background: #f8fafc; padding: 24px; border-radius: 20px; display: inline-block; border: 1px solid #e2e8f0; }
                        .footer { margin-top: 30px; font-size: 14px; font-weight: bold; color: #0284c7; }
                    </style>
                </head>
                <body>
                    <div class="poster">
                        <div class="title">${propertyName}</div>
                        <div class="subtitle">${config.posterSubtitle}</div>
                        <div class="qr-box">
                            ${svgData}
                        </div>
                        <div class="footer">${config.posterFooter}</div>
                    </div>
                    <script>
                        window.onload = function() { window.print(); window.close(); }
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden my-auto"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                                <QrCode className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white text-base">{config.heading}</h3>
                                <p className="text-xs text-slate-500">{propertyName}</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* QR Display */}
                    <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center overflow-y-auto">
                        {/* QR Box */}
                        <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-inner mb-4 relative group">
                            <QRCodeSVG
                                id="property-qr-svg"
                                value={qrUrl}
                                size={220}
                                level="H"
                                includeMargin={true}
                            />
                        </div>

                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 max-w-xs mb-6">
                            {config.blurb}
                        </p>

                        {/* Link Field */}
                        <div className="w-full flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl mb-6">
                            <input
                                type="text"
                                readOnly
                                value={qrUrl}
                                className="flex-1 px-2 text-xs font-mono bg-transparent text-slate-700 dark:text-slate-300 outline-none truncate"
                            />
                            <button
                                onClick={handleCopyLink}
                                className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5"
                            >
                                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-2 gap-3 w-full">
                            <button
                                onClick={handleDownloadQR}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white rounded-xl text-xs font-bold transition-all shadow-sm"
                            >
                                <Download className="w-4 h-4" /> Download Image
                            </button>
                            <button
                                onClick={handlePrint}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-bold transition-all"
                            >
                                <Printer className="w-4 h-4" /> Print Poster
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
