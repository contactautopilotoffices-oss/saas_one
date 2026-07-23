'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Scan, AlertCircle, Loader2, Camera, ImagePlus, Keyboard, CheckCircle2, Boxes, ArrowBigDown, ArrowBigUp, QrCode } from 'lucide-react';
import { useParams } from 'next/navigation';

interface BarcodeScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess?: (barcode: string, format: string) => void;
    onBatchSubmit?: (items: CartItem[], action: 'IN' | 'OUT') => void;
    title?: string;
}

type ScanMode = 'camera' | 'gallery' | 'manual';

interface CartItem {
    id: string;
    item_code: string;
    name: string;
    quantity: number;
    category?: string;
    unit?: string;
    barcode?: string;
    location?: string;
    cartQuantity: number;
    notes?: string;
}


export default function BarcodeScannerModal({
    isOpen,
    onClose,
    onScanSuccess,
    onBatchSubmit,
    title = 'Inventory Scanner'
}: BarcodeScannerModalProps) {
    const params = useParams();
    const propertyId = params?.propertyId as string;

    const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [manualInput, setManualInput] = useState('');
    const [scanMode, setScanMode] = useState<ScanMode>('camera');
    const [cameraActive, setCameraActive] = useState(false);
    const [galleryProcessing, setGalleryProcessing] = useState(false);
    const [galleryPreview, setGalleryPreview] = useState<string | null>(null);
    const isTransitioningRef = useRef(false);
    const isMounted = useRef(true);

    // Identification & Update States
    const [scannedItems, setScannedItems] = useState<CartItem[]>([]);
    const recentScansRef = useRef<Record<string, number>>({});
    const beepAudio = useRef<HTMLAudioElement | null>(null);
    useEffect(() => { beepAudio.current = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"); }, []);
    const [action, setAction] = useState<'IN' | 'OUT'>('IN');
    const [quantity, setQuantity] = useState(1);
    const [isUpdatingStock, setIsUpdatingStock] = useState(false);

    const SCANNER_ID = 'barcode-scanner-region';

    const stopCamera = useCallback(async () => {
        if (html5QrCodeRef.current) {
            try {
                if (html5QrCodeRef.current.isScanning) {
                    await html5QrCodeRef.current.stop();
                }
                await html5QrCodeRef.current.clear();
            } catch (err: any) {
                console.warn('Error during camera stop/clear:', err);
            } finally {
                html5QrCodeRef.current = null;
                setCameraActive(false);
            }
        }
    }, []);

    const handleClose = useCallback(async () => {
        await stopCamera();
        if (html5QrCodeRef.current) {
            try {
                html5QrCodeRef.current.clear();
            } catch (e) { /* ignore */ }
            html5QrCodeRef.current = null;
        }
        setError(null);
        setManualInput('');
        setScanMode('camera');
        setGalleryPreview(null);
        setGalleryProcessing(false);
        setScannedItems([]);
        onClose();
    }, [stopCamera, onClose]);

    
    const fetchItemByBarcode = async (barcode: string) => {
        const now = Date.now();
        if (recentScansRef.current[barcode] && now - recentScansRef.current[barcode] < 3000) {
            return; // Ignore duplicate scan within 3 seconds
        }
        recentScansRef.current[barcode] = now;

        try {
            setLoading(true);
            const res = await fetch(`/api/properties/${propertyId}/stock/items?barcode=${barcode}`);
            const data = await res.json();

            if (data.success && data.items.length > 0) {
                if (onScanSuccess) {
                    onScanSuccess(barcode, 'unknown');
                } else {
                    const item = data.items[0];
                    setScannedItems(prev => {
                        const existing = prev.find(i => i.id === item.id);
                        if (existing) {
                            return prev.map(i => i.id === item.id ? { ...i, cartQuantity: i.cartQuantity + 1 } : i);
                        }
                        return [...prev, { ...item, cartQuantity: 1 }];
                    });
                    if (beepAudio.current) {
                        beepAudio.current.play().catch(() => {});
                    }
                }
            } else {
                setError(`No item found for code: ${barcode}`);
            }
        } catch (err) {
            setError('Failed to fetch item details.');
        } finally {
            setLoading(false);
        }
    };


    // Initialize or get the Html5Qrcode instance
    const getScanner = useCallback(() => {
        if (!isOpen) return null;

        const container = document.getElementById(SCANNER_ID);
        if (!container) return null;

        if (!html5QrCodeRef.current) {
            html5QrCodeRef.current = new Html5Qrcode(SCANNER_ID, {
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.ITF,
                    Html5QrcodeSupportedFormats.DATA_MATRIX
                ],
                verbose: false
            });
        }
        return html5QrCodeRef.current;
    }, [isOpen]);

    const startCamera = async (isRetry = false) => {
        if (cameraActive || !isOpen) return;

        // Robust recursive check for container dimensions
        const checkContainer = async (retries = 15): Promise<boolean> => {
            if (!isMounted.current || !isOpen) return false;
            const container = document.getElementById(SCANNER_ID);
            if (container && container.clientWidth > 0) return true;
            if (retries <= 0) return false;
            await new Promise(r => setTimeout(r, 100));
            return checkContainer(retries - 1);
        };

        const isReady = await checkContainer();
        if (!isReady || !isMounted.current) {
            console.warn('Scanner container not ready/mounted after retries');
            return;
        }

        const scanner = getScanner();
        if (!scanner) return;

        const scanConfig = {
            fps: 30,
            qrbox: { width: 280, height: 200 },
            aspectRatio: Infinity,
            disableFlip: false
        };

        const onSuccess = (decodedText: string) => {
            const code = decodedText.trim();
            // Always continuous scan — never close camera, just add to cart
            fetchItemByBarcode(code);
        };

        try {
            setLoading(true);
            setError(null);
            await scanner.start({ facingMode: 'environment' }, scanConfig, onSuccess, () => { });
            setCameraActive(true);
            setLoading(false);
        } catch (err: any) {
            const msg: string = err?.message || err?.toString() || '';
            // Html5Qrcode internal state machine conflict — destroy instance and retry once
            if (!isRetry && msg.toLowerCase().includes('transition')) {
                console.warn('[Scanner] Transition conflict detected, resetting instance and retrying...');
                try {
                    await html5QrCodeRef.current?.stop().catch(() => { });
                    html5QrCodeRef.current?.clear();
                } catch { /* ignore cleanup errors */ }
                html5QrCodeRef.current = null;
                setCameraActive(false);
                await new Promise(r => setTimeout(r, 400));
                if (isMounted.current && isOpen) await startCamera(true);
                return;
            }
            console.error('Failed to start camera:', err);
            if (scanMode === 'camera' && isOpen) {
                setError('Camera access denied or busy.');
            }
            setLoading(false);
            setCameraActive(false);
        }
    };

    // Handle mode switches and initialization
    useEffect(() => {
        if (!isOpen) return;

        const syncScanner = async () => {
            if (isTransitioningRef.current) return;
            isTransitioningRef.current = true;

            try {
                // Always ensure a clean slate when switching modes
                await stopCamera();

                if (scanMode === 'camera' && isMounted.current) {
                    // Give extra time for React to render/update the SCANNER_ID div
                    await new Promise(r => setTimeout(r, 200));
                    if (isMounted.current && isOpen) await startCamera();
                }
            } finally {
                if (isMounted.current) isTransitioningRef.current = false;
            }
        };

        syncScanner();
    }, [scanMode, isOpen, stopCamera]);

    // Cleanup on unmount
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
            if (html5QrCodeRef.current) {
                if (html5QrCodeRef.current.isScanning) {
                    html5QrCodeRef.current.stop().catch(() => { });
                }
                html5QrCodeRef.current.clear();
                html5QrCodeRef.current = null;
            }
        };
    }, []);

    // Handle manual input auto-identification
    useEffect(() => {
        if (scanMode === 'manual' && manualInput.length >= 8) {
            const timer = setTimeout(() => {
                fetchItemByBarcode(manualInput);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [manualInput, scanMode]);

    
    const handleStockUpdate = async () => {
        if (scannedItems.length === 0) return;

        // If parent provides a batch submit handler, delegate to it
        if (onBatchSubmit) {
            setIsUpdatingStock(true);
            setError(null);
            try {
                await onBatchSubmit(scannedItems, action);
                setScannedItems([]);
                handleClose();
            } catch (err) {
                setError('Failed to submit movement order.');
            } finally {
                setIsUpdatingStock(false);
            }
            return;
        }

        setIsUpdatingStock(true);
        setError(null);

        try {
            const promises = scannedItems.map(item =>
                fetch(`/api/properties/${propertyId}/stock/scan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        itemId: item.id,
                        action: action.toLowerCase(),
                        quantity: item.cartQuantity,
                        notes: item.notes || `Scanned via ${scanMode.toUpperCase()} mode (Batch)`
                    })
                }).then(res => res.json())
            );

            const results = await Promise.all(promises);
            const failed = results.filter(r => !r.success);

            if (failed.length === 0) {
                setScannedItems([]);
                if (onScanSuccess) onScanSuccess('batch', scanMode.toUpperCase());
                handleClose();
            } else {
                setError(`${failed.length} items failed to update.`);
            }
        } catch (err) {
            setError('Network error updating stock.');
        } finally {
            setIsUpdatingStock(false);
        }
    };

    const updateCartQuantity = (id: string, delta: number) => {
        setScannedItems(prev => prev.map(item => {
            if (item.id === id) {
                return { ...item, cartQuantity: Math.max(1, item.cartQuantity + delta) };
            }
            return item;
        }));
    };

    const updateCartNotes = (id: string, notes: string) => {
        setScannedItems(prev => prev.map(item => {
            if (item.id === id) {
                return { ...item, notes };
            }
            return item;
        }));
    };

    const removeCartItem = (id: string) => {
        setScannedItems(prev => prev.filter(item => item.id !== id));
    };


    const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || galleryProcessing) return;

        setGalleryProcessing(true);
        setError(null);
        setGalleryPreview(null);

        // Crucial: Stop camera before starting file scan to avoid instance collision
        await stopCamera();

        const previewUrl = URL.createObjectURL(file);
        setGalleryPreview(previewUrl);

        try {
            // STEP 1: Try Native BarcodeDetector API (Ultra-fast, robust fallback for 1D)
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await (window as any).BarcodeDetector.getSupportedFormats();
                    const detector = new (window as any).BarcodeDetector({
                        formats: formats.length > 0 ? formats : ['code_128', 'qr_code', 'ean_13']
                    });

                    const img = new Image();
                    img.src = previewUrl;
                    await new Promise((resolve) => img.onload = resolve);

                    const barcodes = await detector.detect(img);
                    if (barcodes.length > 0) {
                        fetchItemByBarcode(barcodes[0].rawValue.trim());
                        return;
                    }
                } catch (nativeErr) {
                    console.warn('Native BarcodeDetector failed, falling back to html5-qrcode');
                }
            }

            // STEP 2: Fallback to html5-qrcode with optimized image
            // Always get/create a fresh scanner instance for gallery scan
            await stopCamera(); // Double insurance
            const scanner = getScanner();
            if (!scanner) throw new Error('Could not initialize scanner for gallery');

            const processImage = async (pass: 'normal' | 'high-contrast'): Promise<File> => {
                return new Promise<File>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const MAX_EDGE = 1600; // Increased for better 1D detail
                        let width = img.width;
                        let height = img.height;
                        if (width > height ? width > MAX_EDGE : height > MAX_EDGE) {
                            const ratio = MAX_EDGE / Math.max(width, height);
                            width *= ratio;
                            height *= ratio;
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            if (pass === 'high-contrast') {
                                // Grayscale + Contrast Boost
                                ctx.filter = 'grayscale(100%) contrast(200%) brightness(120%)';
                            }
                            ctx.fillStyle = 'white';
                            ctx.fillRect(0, 0, width, height);
                            ctx.drawImage(img, 0, 0, width, height);
                        }
                        canvas.toBlob((b) => {
                            const processedFile = new File([b || file], `scan_${pass}.jpg`, { type: 'image/jpeg' });
                            resolve(processedFile);
                        }, 'image/jpeg', 0.95);
                    };
                    img.onerror = () => resolve(file);
                    img.src = previewUrl;
                });
            };

            // PASS 1: Normal processing
            const normalFile = await processImage('normal');
            try {
                const result = await scanner.scanFile(normalFile, true);
                const code = result.trim();
                fetchItemByBarcode(code);
                return;
            } catch (err) {
                console.warn('First scan pass failed, trying high-contrast pass...');

                // PASS 2: High-contrast fallback (better for 1D barcodes in poor lighting)
                const highContrastFile = await processImage('high-contrast');
                const result = await scanner.scanFile(highContrastFile, true);
                const secondCode = result.trim();

                if (onScanSuccess) {
                    onScanSuccess(secondCode, 'unknown');
                    handleClose();
                } else {
                    fetchItemByBarcode(secondCode);
                }
            }
        } catch (err) {
            console.error('Gallery scan error:', err);
            setError('Could not detect any QR code. Try a clearer photo or use Manual ID.');
        } finally {
            setGalleryProcessing(false);
            URL.revokeObjectURL(previewUrl);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/80 backdrop-blur-md" onClick={handleClose}>
            <div
                className="bg-white flex flex-col overflow-hidden w-full max-w-lg h-full max-h-full"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
                            <QrCode size={18} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-gray-900 leading-tight">{title}</h2>
                            {scannedItems.length > 0 && (
                                <p className="text-xs text-indigo-500 font-semibold">{scannedItems.length} item(s) scanned</p>
                            )}
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* ── Controls row: tabs + IN/OUT toggle ── */}
                <div className="px-4 py-3 flex items-center gap-3 bg-gray-50 border-b border-gray-200 flex-shrink-0">
                    {/* Mode tabs */}
                    <div className="flex gap-1 p-1 bg-gray-200 rounded-xl">
                        <button
                            onClick={() => setScanMode('camera')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${scanMode === 'camera' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                        >
                            <Camera size={13} />Camera
                        </button>
                        <button
                            onClick={() => setScanMode('gallery')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${scanMode === 'gallery' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                        >
                            <ImagePlus size={13} />Photo
                        </button>
                        <button
                            onClick={() => setScanMode('manual')}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${scanMode === 'manual' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                        >
                            <Keyboard size={13} />Manual
                        </button>
                    </div>

                    <div className="flex-1" />

                    {/* IN/OUT toggle */}
                    <div className="flex rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <button
                            onClick={() => setAction('IN')}
                            className={`px-4 py-2 text-xs font-black ${action === 'IN' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-500'}`}
                        >
                            Stock IN
                        </button>
                        <button
                            onClick={() => setAction('OUT')}
                            className={`px-4 py-2 text-xs font-black ${action === 'OUT' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500'}`}
                        >
                            Stock OUT
                        </button>
                    </div>
                </div>

                {/* ── Error banner ── */}
                {error && (
                    <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 flex-shrink-0">
                        <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-red-700 font-medium">{error}</p>
                    </div>
                )}

                {/* ── Camera Scanner ── */}
                {scanMode === 'camera' && (
                    <div className="flex-shrink-0 relative bg-black" style={{ height: 260 }}>
                        {loading && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                                <Loader2 size={32} className="animate-spin text-white" />
                            </div>
                        )}
                        <div id={SCANNER_ID} className="w-full h-full" />
                    </div>
                )}

                {/* ── Gallery Scanner ── */}
                {scanMode === 'gallery' && (
                    <div className="flex-shrink-0 flex flex-col items-center justify-center bg-gray-50 py-12 gap-3">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex flex-col items-center gap-3 text-gray-400 hover:text-indigo-500 transition-colors"
                        >
                            <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center bg-white">
                                <ImagePlus size={36} />
                            </div>
                            <span className="text-sm font-bold">Choose Photo to Scan</span>
                        </button>
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleGallerySelect} className="hidden" />
                    </div>
                )}

                {/* ── Manual Entry ── */}
                {scanMode === 'manual' && (
                    <div className="flex-shrink-0 flex flex-col justify-center bg-gray-50 px-4 py-6 gap-3">
                        <input
                            type="text"
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && manualInput.trim() && fetchItemByBarcode(manualInput)}
                            placeholder="Type barcode and press Enter…"
                            className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl text-sm font-semibold focus:border-indigo-500 outline-none placeholder:text-gray-400"
                        />
                        <button
                            onClick={() => manualInput.trim() && fetchItemByBarcode(manualInput)}
                            disabled={!manualInput.trim() || loading}
                            className="w-full py-3.5 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-40"
                        >
                            Add to List
                        </button>
                    </div>
                )}

                {/* ── Scanned Items List ── */}
                <div className="flex-1 overflow-y-auto bg-gray-100 min-h-0">
                    {scannedItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full py-16 text-center px-8">
                            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                                <Boxes size={40} className="text-gray-300" />
                            </div>
                            <p className="text-sm font-bold text-gray-400">Scan QR codes to add items</p>
                            <p className="text-xs text-gray-300 mt-1">Items will appear in the list below</p>
                        </div>
                    ) : (
                        <div className="p-3 space-y-2">
                            {scannedItems.map((item, idx) => (
                                <div key={item.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                    {/* Top row: index, name, qty, remove */}
                                    <div className="px-3 py-3 flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                                            <span className="text-[10px] font-black text-white">{idx + 1}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-gray-900 leading-tight">{item.name}</div>
                                            {item.location && (
                                                <div className="text-[10px] font-semibold text-indigo-500 mt-0.5">{item.location}</div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-2 py-1.5 border border-gray-100 flex-shrink-0">
                                            <button
                                                onClick={() => updateCartQuantity(item.id, -1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-sm font-black text-gray-600 hover:bg-gray-50 text-base"
                                            >
                                                −
                                            </button>
                                            <span className="w-8 text-center font-black text-indigo-600">{item.cartQuantity}</span>
                                            <button
                                                onClick={() => updateCartQuantity(item.id, 1)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-sm font-black text-gray-600 hover:bg-gray-50 text-base"
                                            >
                                                +
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => removeCartItem(item.id)}
                                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                    {/* Bottom row: stock info + notes */}
                                    <div className="px-3 pb-3 pt-1 flex gap-2 items-center border-t border-gray-50">
                                        <span className="text-[10px] font-semibold text-gray-400 flex-shrink-0">
                                            In stock: {item.quantity} {item.unit || 'units'}
                                        </span>
                                        <input
                                            type="text"
                                            placeholder="Add note (optional)…"
                                            value={item.notes || ''}
                                            onChange={(e) => updateCartNotes(item.id, e.target.value)}
                                            className="flex-1 text-xs px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-gray-600 focus:border-indigo-400 focus:bg-white outline-none"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Confirm Button ── */}
                <div className="flex-shrink-0 p-3 bg-white border-t border-gray-200">
                    <button
                        onClick={handleStockUpdate}
                        disabled={scannedItems.length === 0 || isUpdatingStock}
                        className={`w-full py-4 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all
                            ${scannedItems.length === 0
                                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                : action === 'IN'
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                    : 'bg-orange-500 hover:bg-orange-600 text-white'
                            }`}
                    >
                        {isUpdatingStock ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : scannedItems.length === 0 ? (
                            <>
                                <Boxes size={20} />
                                Scan Items to Move
                            </>
                        ) : (
                            <>
                                {action === 'IN' ? <ArrowBigDown size={20} /> : <ArrowBigUp size={20} />}
                                Move Order — {scannedItems.length} Item{scannedItems.length > 1 ? 's' : ''} {action === 'IN' ? 'In' : 'Out'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}