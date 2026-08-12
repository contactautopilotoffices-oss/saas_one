'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Upload, FileText, Loader2, Trash2, Save, MapPin, CheckSquare, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toast } from '@/frontend/components/ui/Toast';

interface ChecklistItem {
    id: string;
    title: string;
    order_index?: number;
}

interface CADArea {
    id: string;
    label: string;
    coordinates: { x: number; y: number; width: number; height: number };
    linked_step_ids: string[];
}

interface SOPCADConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    templateId: string;
    templateTitle?: string;
    items: ChecklistItem[];
    onSuccess?: () => void;
}

/** Render first page of a PDF file to a PNG blob using pdfjs-dist */
async function pdfToImageBlob(file: File): Promise<{ blob: Blob; dataUrl: string }> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = window.location.origin + '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    const scale = 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    await (page.render as any)({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));

    return { blob, dataUrl };
}

const SOPCADConfigModal: React.FC<SOPCADConfigModalProps> = ({
    isOpen,
    onClose,
    propertyId,
    templateId,
    templateTitle,
    items,
    onSuccess,
}) => {
    const [step, setStep] = useState<'upload' | 'converting' | 'editing' | 'error'>('upload');
    const [preview, setPreview] = useState<string | null>(null);
    const [uploadBlob, setUploadBlob] = useState<Blob | null>(null);
    const [fileName, setFileName] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isSavingAreas, setIsSavingAreas] = useState(false);
    const [cadConvertedImageUrl, setCadConvertedImageUrl] = useState<string | null>(null);
    const [cadFileType, setCadFileType] = useState<string | null>(null);
    const [areas, setAreas] = useState<CADArea[]>([]);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [drawing, setDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
    const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [editingAreaLabel, setEditingAreaLabel] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load existing CAD config
    useEffect(() => {
        if (!isOpen || !templateId) return;
        const loadExisting = async () => {
            try {
                const res = await fetch(`/api/properties/${propertyId}/sop/templates/${templateId}/cad/areas`);
                const data = await res.json();
                if (res.ok && data.cadConvertedImageUrl) {
                    setCadConvertedImageUrl(data.cadConvertedImageUrl);
                    setCadFileType(data.cadFileType);
                    setAreas(data.areas || []);
                    setPreview(data.cadConvertedImageUrl);
                    setStep('editing');
                }
            } catch (err) {
                console.error('Failed to load CAD config:', err);
            }
        };
        loadExisting();
    }, [isOpen, templateId, propertyId]);

    const processFile = async (file: File) => {
        setFileName(file.name);
        setErrorMsg('');

        if (file.type === 'application/pdf') {
            setStep('converting');
            try {
                const { blob, dataUrl } = await pdfToImageBlob(file);
                setUploadBlob(blob);
                setPreview(dataUrl);
                setStep('upload');
            } catch (err: any) {
                setErrorMsg(`Failed to read PDF: ${err.message}`);
                setStep('error');
            }
        } else {
            setUploadBlob(file);
            setPreview(URL.createObjectURL(file));
            setStep('upload');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    };

    const handleUpload = async () => {
        if (!uploadBlob) return;
        setIsUploading(true);
        setErrorMsg('');

        try {
            const formData = new FormData();
            formData.append('file', uploadBlob, fileName || 'cad.png');

            const res = await fetch(`/api/properties/${propertyId}/sop/templates/${templateId}/cad`, {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            setCadConvertedImageUrl(data.cadConvertedImageUrl);
            setCadFileType(data.cadFileType);
            setPreview(data.cadConvertedImageUrl);
            setStep('editing');
            setToast({ message: 'CAD uploaded successfully. Draw areas and link to steps.', type: 'success' });
        } catch (err: any) {
            setErrorMsg(err.message || 'Failed to upload CAD');
            setStep('error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveAreas = async () => {
        setIsSavingAreas(true);
        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/templates/${templateId}/cad/areas`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ areas }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save areas');

            setToast({ message: 'CAD areas saved successfully', type: 'success' });
            onSuccess?.();
            onClose();
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to save areas', type: 'error' });
        } finally {
            setIsSavingAreas(false);
        }
    };

    const handleReset = () => {
        setStep('upload');
        setPreview(null);
        setUploadBlob(null);
        setFileName('');
        setErrorMsg('');
        setAreas([]);
        setSelectedAreaId(null);
        setCadConvertedImageUrl(null);
        setCadFileType(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Canvas drawing logic
    const getCanvasCoordinates = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
        if (!imageRef.current || !containerRef.current) return null;
        const rect = imageRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * imageSize.width;
        const y = ((e.clientY - rect.top) / rect.height) * imageSize.height;
        return { x, y };
    }, [imageSize]);

    const handleImageMouseDown = (e: React.MouseEvent) => {
        const coords = getCanvasCoordinates(e);
        if (!coords) return;
        setDrawing(true);
        setDrawStart(coords);
        setDrawCurrent(coords);
        setSelectedAreaId(null);
    };

    const handleImageMouseMove = (e: React.MouseEvent) => {
        if (!drawing || !drawStart) return;
        const coords = getCanvasCoordinates(e);
        if (!coords) return;
        setDrawCurrent(coords);
    };

    const handleImageMouseUp = () => {
        if (!drawing || !drawStart || !drawCurrent) return;
        setDrawing(false);

        const x = Math.min(drawStart.x, drawCurrent.x);
        const y = Math.min(drawStart.y, drawCurrent.y);
        const width = Math.abs(drawCurrent.x - drawStart.x);
        const height = Math.abs(drawCurrent.y - drawStart.y);

        // Ignore tiny rectangles
        if (width < 10 || height < 10) {
            setDrawStart(null);
            setDrawCurrent(null);
            return;
        }

        const newArea: CADArea = {
            id: `area-${Date.now()}`,
            label: `Area ${areas.length + 1}`,
            coordinates: { x, y, width, height },
            linked_step_ids: [],
        };

        setAreas([...areas, newArea]);
        setSelectedAreaId(newArea.id);
        setEditingAreaLabel(newArea.label);
        setDrawStart(null);
        setDrawCurrent(null);
    };

    const handleDeleteArea = (areaId: string) => {
        setAreas(areas.filter((a) => a.id !== areaId));
        if (selectedAreaId === areaId) setSelectedAreaId(null);
    };

    const handleUpdateAreaLabel = (areaId: string, label: string) => {
        setAreas(areas.map((a) => (a.id === areaId ? { ...a, label } : a)));
    };

    const handleToggleStepLink = (areaId: string, stepId: string) => {
        setAreas(areas.map((a) => {
            if (a.id !== areaId) return a;
            const isLinked = a.linked_step_ids.includes(stepId);
            return {
                ...a,
                linked_step_ids: isLinked
                    ? a.linked_step_ids.filter((id) => id !== stepId)
                    : [...a.linked_step_ids, stepId],
            };
        }));
    };

    const getAreaColor = (areaId: string) => {
        if (selectedAreaId === areaId) return '#3b82f6';
        const area = areas.find((a) => a.id === areaId);
        return area && area.linked_step_ids.length > 0 ? '#10b981' : '#f59e0b';
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !preview) return;

        const render = () => {
            const rect = image.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext('2d')!;

            // Draw existing areas
            areas.forEach((area) => {
                const scaleX = rect.width / imageSize.width;
                const scaleY = rect.height / imageSize.height;
                const x = area.coordinates.x * scaleX;
                const y = area.coordinates.y * scaleY;
                const w = area.coordinates.width * scaleX;
                const h = area.coordinates.height * scaleY;

                ctx.strokeStyle = getAreaColor(area.id);
                ctx.lineWidth = selectedAreaId === area.id ? 3 : 2;
                ctx.strokeRect(x, y, w, h);

                // Draw label
                ctx.fillStyle = getAreaColor(area.id);
                ctx.font = 'bold 12px sans-serif';
                const labelText = area.label + (area.linked_step_ids.length > 0 ? ` (${area.linked_step_ids.length})` : '');
                const textWidth = ctx.measureText(labelText).width;
                ctx.fillRect(x, y - 20, textWidth + 10, 20);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(labelText, x + 5, y - 6);
            });

            // Draw current drawing rectangle
            if (drawing && drawStart && drawCurrent) {
                const scaleX = rect.width / imageSize.width;
                const scaleY = rect.height / imageSize.height;
                const x = Math.min(drawStart.x, drawCurrent.x) * scaleX;
                const y = Math.min(drawStart.y, drawCurrent.y) * scaleY;
                const w = Math.abs(drawCurrent.x - drawStart.x) * scaleX;
                const h = Math.abs(drawCurrent.y - drawStart.y) * scaleY;

                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);
            }
        };

        render();
    }, [areas, drawing, drawStart, drawCurrent, selectedAreaId, imageSize, preview, getAreaColor]);

    const handleImageLoad = () => {
        if (imageRef.current) {
            setImageSize({
                width: imageRef.current.naturalWidth,
                height: imageRef.current.naturalHeight,
            });
        }
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (!imageRef.current) return;
        const rect = imageRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * imageSize.width;
        const y = ((e.clientY - rect.top) / rect.height) * imageSize.height;

        // Find clicked area
        const clickedArea = areas.find((area) => {
            const { x: ax, y: ay, width: aw, height: ah } = area.coordinates;
            return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
        });

        if (clickedArea) {
            setSelectedAreaId(clickedArea.id);
            setEditingAreaLabel(clickedArea.label);
        } else {
            setSelectedAreaId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <MapPin size={16} className="text-primary" />
                            </div>
                            <div>
                                <h2 className="font-black text-sm text-slate-900 tracking-tight">CAD Configuration</h2>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                    {templateTitle ? `${templateTitle} — ` : ''}Upload floor plan & map areas to steps
                                </p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto">
                        {step === 'upload' && (
                            <div className="p-5 space-y-4">
                                <p className="text-xs text-slate-500 font-medium">
                                    Upload a CAD floor plan (DWG, DXF, PDF, or image). After upload, draw areas on the plan and link them to checklist steps.
                                </p>

                                <div
                                    onDrop={handleDrop}
                                    onDragOver={(e) => e.preventDefault()}
                                    onClick={() => !preview && fileInputRef.current?.click()}
                                    className={`relative border-2 border-dashed rounded-xl transition-all overflow-hidden ${preview ? 'border-primary/40 bg-primary/5' : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50 cursor-pointer'}`}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,application/pdf,.dwg,.dxf"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />

                                    {preview ? (
                                        <div className="relative">
                                            <img src={preview} alt="CAD preview" className="w-full max-h-96 object-contain p-2" />
                                            <button
                                                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                                className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest transition-all"
                                            >
                                                Change
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center py-12 px-6 text-center">
                                            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                                                <Upload size={20} className="text-slate-400" />
                                            </div>
                                            <p className="font-black text-sm text-slate-700">Drop CAD file here</p>
                                            <p className="text-xs text-slate-400 mt-1 font-medium">or click to browse</p>
                                            <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-black rounded uppercase tracking-widest">DWG</span>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-black rounded uppercase tracking-widest">DXF</span>
                                                <span className="px-2 py-0.5 bg-rose-50 text-rose-500 text-[10px] font-black rounded uppercase tracking-widest">PDF</span>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-black rounded uppercase tracking-widest">PNG</span>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-black rounded uppercase tracking-widest">JPEG</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {fileName && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                                        <FileText size={13} className="text-slate-500 flex-shrink-0" />
                                        <p className="text-xs font-bold text-slate-700 truncate">{fileName}</p>
                                    </div>
                                )}

                                {preview && (
                                    <div className="flex gap-2 pt-1">
                                        <button
                                            onClick={handleReset}
                                            className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            onClick={handleUpload}
                                            disabled={isUploading}
                                            className="flex-1 py-2.5 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                            {isUploading ? 'Uploading...' : 'Upload & Configure'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 'converting' && (
                            <div className="flex flex-col items-center justify-center py-20 px-6">
                                <div className="relative w-14 h-14 mb-4">
                                    <div className="absolute inset-0 rounded-full border-4 border-rose-100" />
                                    <div className="absolute inset-0 rounded-full border-4 border-rose-400 border-t-transparent animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <FileText size={16} className="text-rose-500" />
                                    </div>
                                </div>
                                <p className="font-black text-sm text-slate-900 mb-1">Processing PDF</p>
                                <p className="text-xs text-slate-500 font-medium text-center max-w-xs">
                                    Rendering floor plan from PDF…
                                </p>
                            </div>
                        )}

                        {step === 'error' && (
                            <div className="flex flex-col items-center justify-center py-20 px-6">
                                <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center mb-4">
                                    <AlertCircle size={20} className="text-rose-500" />
                                </div>
                                <p className="font-black text-sm text-slate-900 mb-1">Something went wrong</p>
                                <p className="text-xs text-slate-500 font-medium text-center max-w-xs mb-4">{errorMsg}</p>
                                <button
                                    onClick={handleReset}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2"
                                >
                                    <RefreshCw size={14} />
                                    Try Again
                                </button>
                            </div>
                        )}

                        {step === 'editing' && (
                            <div className="p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-slate-500 font-medium">
                                        Draw rectangles on the CAD image, label each area, and link to checklist steps.
                                    </p>
                                    <button
                                        onClick={handleReset}
                                        className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest flex items-center gap-1"
                                    >
                                        <RefreshCw size={12} />
                                        Re-upload
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                    {/* CAD Image with overlay */}
                                    <div className="lg:col-span-2 relative bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
                                        <div
                                            ref={containerRef}
                                            className="relative cursor-crosshair"
                                            onMouseDown={handleImageMouseDown}
                                            onMouseMove={handleImageMouseMove}
                                            onMouseUp={handleImageMouseUp}
                                            onMouseLeave={handleImageMouseUp}
                                        >
                                            <img
                                                ref={imageRef}
                                                src={preview || ''}
                                                alt="CAD"
                                                className="w-full h-auto select-none"
                                                onLoad={handleImageLoad}
                                                draggable={false}
                                            />
                                            <canvas
                                                ref={canvasRef}
                                                className="absolute top-0 left-0 pointer-events-none"
                                                onClick={handleCanvasClick}
                                            />
                                        </div>
                                    </div>

                                    {/* Areas panel */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-black text-xs text-slate-700 uppercase tracking-widest">Areas ({areas.length})</h3>
                                        </div>

                                        {areas.length === 0 && (
                                            <div className="text-center py-8 text-slate-400">
                                                <MapPin size={24} className="mx-auto mb-2 opacity-50" />
                                                <p className="text-xs font-medium">No areas yet. Draw on the image to create one.</p>
                                            </div>
                                        )}

                                        <div className="space-y-2 max-h-96 overflow-y-auto">
                                            {areas.map((area) => (
                                                <div
                                                    key={area.id}
                                                    className={`border rounded-xl p-3 transition-all ${selectedAreaId === area.id ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 bg-white'}`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <input
                                                            type="text"
                                                            value={selectedAreaId === area.id ? editingAreaLabel : area.label}
                                                            onChange={(e) => {
                                                                if (selectedAreaId === area.id) setEditingAreaLabel(e.target.value);
                                                            }}
                                                            onBlur={() => {
                                                                if (selectedAreaId === area.id) {
                                                                    handleUpdateAreaLabel(area.id, editingAreaLabel);
                                                                }
                                                            }}
                                                            className="font-black text-xs text-slate-900 bg-transparent border-none outline-none flex-1"
                                                            placeholder="Area label"
                                                        />
                                                        <button
                                                            onClick={() => handleDeleteArea(area.id)}
                                                            className="p-1 text-slate-400 hover:text-rose-500 transition-all"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>

                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Linked Steps</p>
                                                        <div className="max-h-32 overflow-y-auto space-y-1">
                                                            {items.map((item) => (
                                                                <label
                                                                    key={item.id}
                                                                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={area.linked_step_ids.includes(item.id)}
                                                                        onChange={() => handleToggleStepLink(area.id, item.id)}
                                                                        className="w-3.5 h-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                                                                    />
                                                                    <span className="text-xs text-slate-700 font-medium">{item.title}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {areas.length > 0 && (
                                            <button
                                                onClick={handleSaveAreas}
                                                disabled={isSavingAreas}
                                                className="w-full py-2.5 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {isSavingAreas ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                {isSavingAreas ? 'Saving...' : 'Save Areas'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {toast && (
                        <Toast
                            message={toast.message}
                            type={toast.type}
                            visible={true}
                            onClose={() => setToast(null)}
                            duration={3000}
                        />
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default SOPCADConfigModal;
