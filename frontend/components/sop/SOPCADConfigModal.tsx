'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, Loader2, Trash2, Save, MapPin, CheckSquare, AlertCircle, RefreshCw, Camera, Eye, Plus, Check, Square, Shapes, Pencil, Undo2, MousePointer } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toast } from '@/frontend/components/ui/Toast';
import { createClient } from '@/frontend/utils/supabase/client';

export type ShapeTool = 'polygon' | 'rectangle' | 'freehand' | 'select';

export interface Point {
    x: number;
    y: number;
}

export interface ChecklistItem {
    id: string;
    title: string;
    order_index?: number;
    reference_photo_url?: string;
}

export interface CADArea {
    id: string;
    label: string;
    shape_type?: 'rectangle' | 'polygon' | 'freehand';
    coordinates: { x: number; y: number; width: number; height: number };
    points?: Point[];
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
    onItemsUpdate?: (updatedItems: ChecklistItem[]) => void;
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
    onItemsUpdate,
}) => {
    const [mounted, setMounted] = useState(false);
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
    const [shapeTool, setShapeTool] = useState<ShapeTool>('polygon');
    const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
    const [freehandPoints, setFreehandPoints] = useState<Point[]>([]);
    const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [editingAreaLabel, setEditingAreaLabel] = useState('');
    const [localItems, setLocalItems] = useState<ChecklistItem[]>(items);
    const [refUploads, setRefUploads] = useState<Record<string, boolean>>({});

    const supabase = React.useMemo(() => createClient(), []);

    useEffect(() => {
        if (items && items.length > 0) {
            setLocalItems(prev => items.map(incoming => {
                const existing = prev.find(p => p.id === incoming.id);
                return {
                    ...incoming,
                    reference_photo_url: incoming.reference_photo_url || existing?.reference_photo_url,
                };
            }));
        }
    }, [items]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Load existing CAD config and latest checklist items with photos
    useEffect(() => {
        if (!isOpen || !templateId) return;
        const loadExisting = async () => {
            try {
                // 1. Fetch CAD areas
                const res = await fetch(`/api/properties/${propertyId}/sop/templates/${templateId}/cad/areas`);
                const data = await res.json();
                if (res.ok && data.cadConvertedImageUrl) {
                    setCadConvertedImageUrl(data.cadConvertedImageUrl);
                    setCadFileType(data.cadFileType);
                    setAreas(data.areas || []);
                    setPreview(data.cadConvertedImageUrl);
                    setStep('editing');
                }

                // 2. Fetch fresh checklist items to guarantee reference_photo_url is always loaded
                const { data: dbItems } = await supabase
                    .from('sop_checklist_items')
                    .select('id, title, description, order_index, reference_photo_url')
                    .eq('template_id', templateId)
                    .order('order_index', { ascending: true });

                if (dbItems && dbItems.length > 0) {
                    setLocalItems(dbItems);
                    onItemsUpdate?.(dbItems);
                }
            } catch (err) {
                console.error('Failed to load CAD config:', err);
            }
        };
        loadExisting();
    }, [isOpen, templateId, propertyId, supabase]);

    const handleStepPhotoUpload = async (stepId: string, file: File) => {
        if (!stepId || stepId.startsWith('ai-')) {
            setToast({ message: 'Please save the template first before uploading reference photos', type: 'error' });
            return;
        }

        setRefUploads(prev => ({ ...prev, [stepId]: true }));
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/properties/${propertyId}/sop/checklist-items/${stepId}/reference-photo`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            const photoUrl = data.referencePhotoUrl || data.reference_photo_url;
            setLocalItems(prev => {
                const updated = prev.map(it => it.id === stepId ? { ...it, reference_photo_url: photoUrl } : it);
                onItemsUpdate?.(updated);
                return updated;
            });
            setToast({ message: 'Clean reference photo updated', type: 'success' });
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to upload photo', type: 'error' });
        } finally {
            setRefUploads(prev => ({ ...prev, [stepId]: false }));
        }
    };

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

    // Point-in-polygon hit test for custom shapes
    const isPointInPolygon = (pt: Point, poly: Point[]): boolean => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    // Canvas coordinate translation
    const getCanvasCoordinates = useCallback((e: React.MouseEvent): Point | null => {
        if (!imageRef.current) return null;
        const rect = imageRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const x = Math.max(0, Math.min(imageSize.width, ((e.clientX - rect.left) / rect.width) * imageSize.width));
        const y = Math.max(0, Math.min(imageSize.height, ((e.clientY - rect.top) / rect.height) * imageSize.height));
        return { x, y };
    }, [imageSize]);

    const finishPolygon = useCallback((pts: Point[], shapeType: 'polygon' | 'freehand' = 'polygon') => {
        if (pts.length < 3) {
            setToast({ message: 'A shape requires at least 3 points', type: 'error' });
            return;
        }

        const minX = Math.round(Math.min(...pts.map((p) => p.x)));
        const maxX = Math.round(Math.max(...pts.map((p) => p.x)));
        const minY = Math.round(Math.min(...pts.map((p) => p.y)));
        const maxY = Math.round(Math.max(...pts.map((p) => p.y)));
        const width = Math.max(10, maxX - minX);
        const height = Math.max(10, maxY - minY);

        const newArea: CADArea = {
            id: `area-${Date.now()}`,
            label: `Area ${areas.length + 1}`,
            shape_type: shapeType,
            points: pts,
            coordinates: { x: minX, y: minY, width, height },
            linked_step_ids: [],
        };

        setAreas((prev) => [...prev, newArea]);
        setSelectedAreaId(newArea.id);
        setEditingAreaLabel(newArea.label);
        setPolygonPoints([]);
        setCurrentMousePos(null);
        setToast({ message: `Shape created: ${newArea.label}`, type: 'success' });
    }, [areas.length]);

    const handleImageMouseDown = (e: React.MouseEvent) => {
        const coords = getCanvasCoordinates(e);
        if (!coords) return;

        if (shapeTool === 'select') {
            const clickedArea = areas.find((area) => {
                if (Array.isArray(area.points) && area.points.length > 2) {
                    return isPointInPolygon(coords, area.points);
                }
                const { x: ax, y: ay, width: aw, height: ah } = area.coordinates;
                return coords.x >= ax && coords.x <= ax + aw && coords.y >= ay && coords.y <= ay + ah;
            });
            if (clickedArea) {
                setSelectedAreaId(clickedArea.id);
                setEditingAreaLabel(clickedArea.label);
            } else {
                setSelectedAreaId(null);
            }
            return;
        }

        if (shapeTool === 'rectangle') {
            setDrawing(true);
            setDrawStart(coords);
            setDrawCurrent(coords);
            setSelectedAreaId(null);
        } else if (shapeTool === 'freehand') {
            setDrawing(true);
            setFreehandPoints([coords]);
            setSelectedAreaId(null);
        } else if (shapeTool === 'polygon') {
            // Check if clicking near point 0 to finish shape
            if (polygonPoints.length >= 3) {
                const p0 = polygonPoints[0];
                const rect = imageRef.current?.getBoundingClientRect();
                const scaleX = rect ? rect.width / imageSize.width : 1;
                const scaleY = rect ? rect.height / imageSize.height : 1;
                const screenDist = Math.hypot((coords.x - p0.x) * scaleX, (coords.y - p0.y) * scaleY);
                if (screenDist < 25) {
                    finishPolygon(polygonPoints, 'polygon');
                    return;
                }
            }
            setPolygonPoints((prev) => [...prev, coords]);
            setSelectedAreaId(null);
        }
    };

    const handleImageMouseMove = (e: React.MouseEvent) => {
        const coords = getCanvasCoordinates(e);
        if (!coords) return;
        setCurrentMousePos(coords);

        if (shapeTool === 'rectangle' && drawing) {
            setDrawCurrent(coords);
        } else if (shapeTool === 'freehand' && drawing) {
            const last = freehandPoints[freehandPoints.length - 1];
            if (!last || Math.hypot(coords.x - last.x, coords.y - last.y) > 4) {
                setFreehandPoints((prev) => [...prev, coords]);
            }
        }
    };

    const handleImageMouseUp = () => {
        if (shapeTool === 'rectangle' && drawing && drawStart && drawCurrent) {
            setDrawing(false);
            const x = Math.min(drawStart.x, drawCurrent.x);
            const y = Math.min(drawStart.y, drawCurrent.y);
            const width = Math.abs(drawCurrent.x - drawStart.x);
            const height = Math.abs(drawCurrent.y - drawStart.y);

            if (width < 10 || height < 10) {
                setDrawStart(null);
                setDrawCurrent(null);
                return;
            }

            const pts: Point[] = [
                { x, y },
                { x: x + width, y },
                { x: x + width, y: y + height },
                { x, y: y + height },
            ];

            const newArea: CADArea = {
                id: `area-${Date.now()}`,
                label: `Area ${areas.length + 1}`,
                shape_type: 'rectangle',
                points: pts,
                coordinates: { x, y, width, height },
                linked_step_ids: [],
            };

            setAreas((prev) => [...prev, newArea]);
            setSelectedAreaId(newArea.id);
            setEditingAreaLabel(newArea.label);
            setDrawStart(null);
            setDrawCurrent(null);
            setToast({ message: `Area created: ${newArea.label}`, type: 'success' });
        } else if (shapeTool === 'freehand' && drawing) {
            setDrawing(false);
            if (freehandPoints.length >= 4) {
                finishPolygon(freehandPoints, 'freehand');
            }
            setFreehandPoints([]);
        }
    };

    const handleCanvasDoubleClick = () => {
        if (shapeTool === 'polygon' && polygonPoints.length >= 3) {
            finishPolygon(polygonPoints, 'polygon');
        }
    };

    const handleUndoPolygonPoint = () => {
        setPolygonPoints((prev) => prev.slice(0, -1));
    };

    const handleCancelPolygon = () => {
        setPolygonPoints([]);
        setFreehandPoints([]);
        setDrawing(false);
        setDrawStart(null);
        setDrawCurrent(null);
    };

    // Keyboard shortcuts for polygon drawing
    useEffect(() => {
        if (step !== 'editing') return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'Escape') {
                handleCancelPolygon();
            } else if (e.key === 'Enter') {
                if (shapeTool === 'polygon' && polygonPoints.length >= 3) {
                    e.preventDefault();
                    finishPolygon(polygonPoints, 'polygon');
                }
            } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
                if (shapeTool === 'polygon' && polygonPoints.length > 0) {
                    e.preventDefault();
                    handleUndoPolygonPoint();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [step, shapeTool, polygonPoints, finishPolygon]);

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

    const getAreaColor = useCallback((areaId: string) => {
        if (selectedAreaId === areaId) return '#3b82f6';
        const area = areas.find((a) => a.id === areaId);
        return area && area.linked_step_ids.length > 0 ? '#10b981' : '#f59e0b';
    }, [areas, selectedAreaId]);

    // Draw area badge label
    const drawAreaBadge = useCallback((ctx: CanvasRenderingContext2D, area: CADArea, x: number, y: number) => {
        ctx.fillStyle = getAreaColor(area.id);
        ctx.font = 'bold 11px sans-serif';
        const labelText = area.label + (area.linked_step_ids.length > 0 ? ` (${area.linked_step_ids.length})` : '');
        const textWidth = ctx.measureText(labelText).width;
        const badgeY = Math.max(20, y);
        ctx.fillRect(x, badgeY - 18, textWidth + 10, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x + 5, badgeY - 5);
    }, [getAreaColor]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !image || !preview || imageSize.width === 0 || imageSize.height === 0) return;

        const render = () => {
            const rect = image.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext('2d')!;
            const scaleX = rect.width / imageSize.width;
            const scaleY = rect.height / imageSize.height;

            // 1. Draw existing areas
            areas.forEach((area) => {
                const isSelected = selectedAreaId === area.id;
                ctx.strokeStyle = getAreaColor(area.id);
                ctx.lineWidth = isSelected ? 3 : 2;

                if (Array.isArray(area.points) && area.points.length > 2) {
                    ctx.beginPath();
                    ctx.moveTo(area.points[0].x * scaleX, area.points[0].y * scaleY);
                    for (let i = 1; i < area.points.length; i++) {
                        ctx.lineTo(area.points[i].x * scaleX, area.points[i].y * scaleY);
                    }
                    ctx.closePath();
                    ctx.fillStyle = isSelected
                        ? 'rgba(59, 130, 246, 0.25)'
                        : area.linked_step_ids.length > 0
                        ? 'rgba(16, 185, 129, 0.18)'
                        : 'rgba(245, 158, 11, 0.18)';
                    ctx.fill();
                    ctx.stroke();

                    // Vertex dots if selected
                    if (isSelected) {
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#3b82f6';
                        ctx.lineWidth = 1.5;
                        area.points.forEach((p) => {
                            ctx.beginPath();
                            ctx.arc(p.x * scaleX, p.y * scaleY, 3.5, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.stroke();
                        });
                    }

                    drawAreaBadge(ctx, area, area.coordinates.x * scaleX, area.coordinates.y * scaleY);
                } else {
                    const x = area.coordinates.x * scaleX;
                    const y = area.coordinates.y * scaleY;
                    const w = area.coordinates.width * scaleX;
                    const h = area.coordinates.height * scaleY;

                    ctx.fillStyle = isSelected
                        ? 'rgba(59, 130, 246, 0.25)'
                        : area.linked_step_ids.length > 0
                        ? 'rgba(16, 185, 129, 0.18)'
                        : 'rgba(245, 158, 11, 0.18)';
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);

                    drawAreaBadge(ctx, area, x, y);
                }
            });

            // 2. Draw current drawing rectangle
            if (shapeTool === 'rectangle' && drawing && drawStart && drawCurrent) {
                const x = Math.min(drawStart.x, drawCurrent.x) * scaleX;
                const y = Math.min(drawStart.y, drawCurrent.y) * scaleY;
                const w = Math.abs(drawCurrent.x - drawStart.x) * scaleX;
                const h = Math.abs(drawCurrent.y - drawStart.y) * scaleY;

                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x, y, w, h);
                ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
                ctx.fillRect(x, y, w, h);
                ctx.setLineDash([]);
            }

            // 3. Draw live polygon in progress
            if (shapeTool === 'polygon' && polygonPoints.length > 0) {
                ctx.beginPath();
                ctx.moveTo(polygonPoints[0].x * scaleX, polygonPoints[0].y * scaleY);
                for (let i = 1; i < polygonPoints.length; i++) {
                    ctx.lineTo(polygonPoints[i].x * scaleX, polygonPoints[i].y * scaleY);
                }

                if (currentMousePos) {
                    ctx.lineTo(currentMousePos.x * scaleX, currentMousePos.y * scaleY);
                }

                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
                ctx.fill();

                // Draw vertices
                polygonPoints.forEach((p, idx) => {
                    const px = p.x * scaleX;
                    const py = p.y * scaleY;
                    ctx.beginPath();
                    ctx.arc(px, py, idx === 0 ? 6 : 4, 0, Math.PI * 2);
                    ctx.fillStyle = idx === 0 ? '#10b981' : '#3b82f6';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                });

                // Highlight snap to first point if hovering near it
                if (currentMousePos && polygonPoints.length >= 3) {
                    const p0 = polygonPoints[0];
                    const dist = Math.hypot((currentMousePos.x - p0.x) * scaleX, (currentMousePos.y - p0.y) * scaleY);
                    if (dist < 25) {
                        ctx.beginPath();
                        ctx.arc(p0.x * scaleX, p0.y * scaleY, 11, 0, Math.PI * 2);
                        ctx.strokeStyle = '#10b981';
                        ctx.lineWidth = 2.5;
                        ctx.setLineDash([4, 4]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
            }

            // 4. Draw live freehand in progress
            if (shapeTool === 'freehand' && drawing && freehandPoints.length > 1) {
                ctx.beginPath();
                ctx.moveTo(freehandPoints[0].x * scaleX, freehandPoints[0].y * scaleY);
                for (let i = 1; i < freehandPoints.length; i++) {
                    ctx.lineTo(freehandPoints[i].x * scaleX, freehandPoints[i].y * scaleY);
                }
                ctx.strokeStyle = '#8b5cf6';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.fillStyle = 'rgba(139, 92, 246, 0.12)';
                ctx.fill();
            }
        };

        render();
    }, [areas, drawing, drawStart, drawCurrent, polygonPoints, freehandPoints, currentMousePos, shapeTool, selectedAreaId, imageSize, preview, getAreaColor, drawAreaBadge]);

    const handleImageLoad = () => {
        if (imageRef.current) {
            setImageSize({
                width: imageRef.current.naturalWidth,
                height: imageRef.current.naturalHeight,
            });
        }
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (shapeTool === 'polygon' && polygonPoints.length > 0) return;
        if (drawing) return;

        const coords = getCanvasCoordinates(e);
        if (!coords) return;

        // Find clicked area using point-in-polygon or bounding box
        const clickedArea = areas.find((area) => {
            if (Array.isArray(area.points) && area.points.length > 2) {
                return isPointInPolygon(coords, area.points);
            }
            const { x: ax, y: ay, width: aw, height: ah } = area.coordinates;
            return coords.x >= ax && coords.x <= ax + aw && coords.y >= ay && coords.y <= ay + ah;
        });

        if (clickedArea) {
            setSelectedAreaId(clickedArea.id);
            setEditingAreaLabel(clickedArea.label);
        } else if (shapeTool === 'select') {
            setSelectedAreaId(null);
        }
    };

    const handleSelectAllSteps = (areaId: string) => {
        setAreas(areas.map(a => a.id === areaId ? { ...a, linked_step_ids: items.map(it => it.id) } : a));
    };

    const handleClearSteps = (areaId: string) => {
        setAreas(areas.map(a => a.id === areaId ? { ...a, linked_step_ids: [] } : a));
    };

    const [isMaximized, setIsMaximized] = useState(false);

    if (!isOpen || !mounted) return null;

    const modalContent = (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[9999] flex items-center justify-center p-1 sm:p-3">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className={`bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 transition-all duration-300 ${
                        isMaximized ? 'w-[99vw] h-[98vh]' : 'w-[96vw] max-w-[1500px] h-[92vh]'
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 flex-shrink-0 bg-slate-50/50">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                                <MapPin size={18} className="text-primary" />
                            </div>
                            <div>
                                <h2 className="font-black text-sm text-slate-900 tracking-tight">CAD Floor Plan Configuration</h2>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {templateTitle ? `${templateTitle} — ` : ''}Draw Areas & Link Checklist Steps
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setIsMaximized(!isMaximized)}
                                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all font-bold text-xs flex items-center gap-1"
                                title={isMaximized ? 'Restore down' : 'Maximize window'}
                            >
                                {isMaximized ? '🗗 Restore' : '🗖 Maximize'}
                            </button>
                            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all">
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto">
                        {step === 'upload' && (
                            <div className="p-5 space-y-4">
                                <p className="text-xs text-slate-500 font-medium">
                                    Upload a CAD floor plan (DWG, DXF, PDF, or image). After upload, draw areas on the plan and link them to checklist steps.
                                </p>

                                <div
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-slate-200 hover:border-primary/40 rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-primary/[0.02]"
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".dwg,.dxf,.pdf,image/*"
                                        onChange={handleFileChange}
                                        className="hidden"
                                    />
                                    <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                                        <Upload size={22} />
                                    </div>
                                    <p className="font-black text-sm text-slate-900 mb-1">Click to upload CAD Floor Plan</p>
                                    <p className="text-xs text-slate-400 font-medium">Supports PDF, DWG, DXF, PNG, JPG (up to 50MB)</p>
                                </div>

                                {preview && (
                                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText size={16} className="text-primary flex-shrink-0" />
                                            <span className="text-xs font-bold text-slate-700 truncate">{fileName}</span>
                                        </div>
                                        <button
                                            onClick={handleUpload}
                                            disabled={isUploading}
                                            className="px-4 py-2 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-1.5"
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
                            <div className="p-4 sm:p-5 space-y-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                                {/* Drawing Tools & Status Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 bg-slate-50/90 rounded-2xl border border-slate-200 flex-shrink-0 shadow-sm">
                                    {/* Tool Selectors */}
                                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200/80 shadow-xs">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShapeTool('polygon');
                                                handleCancelPolygon();
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                shapeTool === 'polygon'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                            title="Click anywhere to place points. Outline irregular rooms, L-shapes, cafeterias, etc."
                                        >
                                            <Shapes size={14} />
                                            <span>Polygon (Any Shape)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShapeTool('rectangle');
                                                handleCancelPolygon();
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                shapeTool === 'rectangle'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                            title="Click and drag to draw a box"
                                        >
                                            <Square size={14} />
                                            <span>Rectangle</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShapeTool('freehand');
                                                handleCancelPolygon();
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                shapeTool === 'freehand'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                            title="Click and drag to trace freely"
                                        >
                                            <Pencil size={14} />
                                            <span>Freehand Lasso</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShapeTool('select');
                                                handleCancelPolygon();
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                shapeTool === 'select'
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                            title="Click any area on the floor plan to select and inspect it"
                                        >
                                            <MousePointer size={14} />
                                            <span>Select</span>
                                        </button>
                                    </div>

                                    {/* Active Drawing Controls & Hints */}
                                    <div className="flex items-center gap-2 text-xs flex-1 min-w-[280px]">
                                        {shapeTool === 'polygon' && (
                                            <>
                                                {polygonPoints.length === 0 ? (
                                                    <span className="text-slate-600 font-medium flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                                        Click on the CAD to place the first point of any shape.
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 font-black text-[11px]">
                                                            {polygonPoints.length} point{polygonPoints.length !== 1 ? 's' : ''}
                                                        </span>
                                                        <span className="text-slate-500 text-[11px]">
                                                            Click next vertex • Double-click or click start point to close
                                                        </span>
                                                        <button
                                                            type="button"
                                                            disabled={polygonPoints.length < 3}
                                                            onClick={() => finishPolygon(polygonPoints, 'polygon')}
                                                            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                                                polygonPoints.length >= 3
                                                                    ? 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700'
                                                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                            }`}
                                                        >
                                                            <Check size={13} />
                                                            Finish Shape
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={handleUndoPolygonPoint}
                                                            className="px-2 py-1 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-all flex items-center gap-1"
                                                            title="Undo last point (Backspace)"
                                                        >
                                                            <Undo2 size={13} />
                                                            Undo
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={handleCancelPolygon}
                                                            className="px-2 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all flex items-center gap-1"
                                                            title="Cancel shape (Esc)"
                                                        >
                                                            <X size={13} />
                                                            Cancel
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {shapeTool === 'rectangle' && (
                                            <span className="text-slate-600 font-medium flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                                Click and drag on the CAD to draw a rectangular area.
                                            </span>
                                        )}
                                        {shapeTool === 'freehand' && (
                                            <span className="text-slate-600 font-medium flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-purple-500" />
                                                Click and drag freely to trace any room boundary. Release to close.
                                            </span>
                                        )}
                                        {shapeTool === 'select' && (
                                            <span className="text-slate-600 font-medium flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-slate-500" />
                                                Click any area to select it and link checklist steps.
                                            </span>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleReset}
                                            className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-all"
                                        >
                                            <RefreshCw size={12} />
                                            Re-upload CAD
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0">
                                    {/* CAD Image with overlay */}
                                    <div className="lg:col-span-2 relative bg-slate-900 rounded-2xl overflow-auto border border-slate-200 shadow-inner flex items-center justify-center h-full min-h-[500px]">
                                        <div
                                            ref={containerRef}
                                            className={`relative max-w-full my-auto select-none ${
                                                shapeTool === 'select' ? 'cursor-pointer' : 'cursor-crosshair'
                                            }`}
                                            onMouseDown={handleImageMouseDown}
                                            onMouseMove={handleImageMouseMove}
                                            onMouseUp={handleImageMouseUp}
                                            onMouseLeave={handleImageMouseUp}
                                            onClick={handleCanvasClick}
                                            onDoubleClick={handleCanvasDoubleClick}
                                        >
                                            <img
                                                ref={imageRef}
                                                src={preview || ''}
                                                alt="CAD Floor Plan"
                                                className="w-full h-auto select-none rounded-lg"
                                                onLoad={handleImageLoad}
                                                draggable={false}
                                            />
                                            <canvas
                                                ref={canvasRef}
                                                className="absolute top-0 left-0 pointer-events-none w-full h-full"
                                            />
                                        </div>
                                    </div>

                                    {/* Areas panel */}
                                    <div className="flex flex-col h-full space-y-3 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200 min-h-0">
                                        <div className="flex items-center justify-between pb-1 border-b border-slate-200 flex-shrink-0">
                                            <h3 className="font-black text-xs text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                                                <span>Areas</span>
                                                <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">{areas.length}</span>
                                            </h3>
                                            <span className="text-[10px] font-bold text-slate-400">
                                                {items.length} checklist step{items.length !== 1 ? 's' : ''}
                                            </span>
                                        </div>

                                        {items.length === 0 && (
                                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2 flex-shrink-0">
                                                <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-amber-600" />
                                                <span>No steps added in template yet. You can draw areas now and link steps once you add steps to the template.</span>
                                            </div>
                                        )}

                                        {areas.length === 0 && (
                                            <div className="text-center py-10 px-4 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                                                <MapPin size={28} className="mx-auto mb-2 text-primary/40" />
                                                <p className="text-xs font-black text-slate-700 mb-1">No areas drawn yet</p>
                                                <p className="text-[11px] font-medium text-slate-400">Use the shape tools on top to outline any room, cafeteria, or space on the CAD floor plan.</p>
                                            </div>
                                        )}

                                        <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
                                            {areas.map((area, areaIdx) => {
                                                const linkedCount = area.linked_step_ids?.length || 0;
                                                const isSelected = selectedAreaId === area.id;
                                                return (
                                                    <div
                                                        key={area.id}
                                                        className={`border rounded-xl p-3 transition-all ${
                                                            isSelected
                                                                ? 'border-blue-400 bg-blue-50/70 shadow-sm ring-1 ring-blue-400/30'
                                                                : linkedCount > 0
                                                                ? 'border-emerald-200 bg-white hover:border-emerald-300'
                                                                : 'border-amber-200 bg-white hover:border-amber-300'
                                                        }`}
                                                    >
                                                        {/* Area Header */}
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2 flex-1 mr-2">
                                                                <span
                                                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                                    style={{ backgroundColor: getAreaColor(area.id) }}
                                                                />
                                                                <input
                                                                    type="text"
                                                                    value={isSelected ? editingAreaLabel : area.label}
                                                                    onChange={(e) => {
                                                                        if (isSelected) setEditingAreaLabel(e.target.value);
                                                                    }}
                                                                    onBlur={() => {
                                                                        if (isSelected) {
                                                                            handleUpdateAreaLabel(area.id, editingAreaLabel);
                                                                        }
                                                                    }}
                                                                    onFocus={() => {
                                                                        setSelectedAreaId(area.id);
                                                                        setEditingAreaLabel(area.label);
                                                                    }}
                                                                    className="font-black text-xs text-slate-900 bg-transparent border-b border-transparent focus:border-primary outline-none flex-1 py-0.5"
                                                                    placeholder="Area name (e.g. Cafeteria)"
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                {area.shape_type === 'polygon' && area.points && (
                                                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 flex items-center gap-1" title={`${area.points.length} polygon vertices`}>
                                                                        <Shapes size={10} />
                                                                        {area.points.length} pts
                                                                    </span>
                                                                )}
                                                                {area.shape_type === 'freehand' && (
                                                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 flex items-center gap-1" title="Freehand lasso shape">
                                                                        <Pencil size={10} />
                                                                        Lasso
                                                                    </span>
                                                                )}
                                                                <span
                                                                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${
                                                                        linkedCount > 0
                                                                            ? 'bg-emerald-100 text-emerald-700'
                                                                            : 'bg-amber-100 text-amber-700'
                                                                    }`}
                                                                >
                                                                    {linkedCount} {linkedCount === 1 ? 'step' : 'steps'}
                                                                </span>
                                                                <button
                                                                    onClick={() => handleDeleteArea(area.id)}
                                                                    className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                                    title="Delete Area"
                                                                >
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Linked Steps Dropdown Section */}
                                                        {localItems.length > 0 && (
                                                            <div className="space-y-2 pt-1 border-t border-slate-100">
                                                                <div className="flex items-center justify-between">
                                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                                                        Select Steps for Area
                                                                    </p>
                                                                    {area.linked_step_ids.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleClearSteps(area.id)}
                                                                            className="text-[9px] font-bold text-rose-500 hover:underline"
                                                                        >
                                                                            Clear All
                                                                        </button>
                                                                    )}
                                                                </div>

                                                                {/* Dropdown to select step */}
                                                                <div className="relative">
                                                                    <select
                                                                        value=""
                                                                        onChange={(e) => {
                                                                            const val = e.target.value;
                                                                            if (val === 'ALL') {
                                                                                handleSelectAllSteps(area.id);
                                                                            } else if (val) {
                                                                                handleToggleStepLink(area.id, val);
                                                                            }
                                                                        }}
                                                                        className="w-full text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl p-2 focus:border-primary outline-none appearance-none cursor-pointer"
                                                                    >
                                                                        <option value="" disabled>+ Add / Select Step for Area...</option>
                                                                        <option value="ALL">-- Select All Steps --</option>
                                                                        {localItems.map((item) => {
                                                                            const isLinked = area.linked_step_ids?.includes(item.id);
                                                                            return (
                                                                                <option key={item.id} value={item.id}>
                                                                                    {isLinked ? '✓ ' : ''}{item.title}
                                                                                </option>
                                                                            );
                                                                        })}
                                                                    </select>
                                                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
                                                                        <span className="text-[10px]">▼</span>
                                                                    </div>
                                                                </div>

                                                                {/* Display linked steps with Clean Photo Upload & View option */}
                                                                {area.linked_step_ids.length > 0 && (
                                                                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                                                                        {localItems
                                                                            .filter((item) => area.linked_step_ids.includes(item.id))
                                                                            .map((item) => (
                                                                                <div key={item.id} className="flex items-center justify-between gap-2 p-2 bg-white rounded-lg border border-slate-200 text-xs shadow-xs">
                                                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                                        {/* Step title */}
                                                                                        <span className="font-bold text-slate-800 truncate text-[11px] flex-1">{item.title}</span>

                                                                                        {/* Clean reference photo thumbnail view */}
                                                                                        {item.reference_photo_url ? (
                                                                                            <a
                                                                                                href={item.reference_photo_url}
                                                                                                target="_blank"
                                                                                                rel="noopener noreferrer"
                                                                                                className="relative group flex-shrink-0"
                                                                                                title="View Clean Reference Photo"
                                                                                            >
                                                                                                <img
                                                                                                    src={item.reference_photo_url}
                                                                                                    alt="Clean Ref"
                                                                                                    className="w-7 h-7 rounded-lg object-cover border border-emerald-300"
                                                                                                />
                                                                                                <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                                    <Eye size={10} className="text-white" />
                                                                                                </div>
                                                                                            </a>
                                                                                        ) : (
                                                                                            <span className="text-[8px] font-bold text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                                                                                                No Clean Photo
                                                                                            </span>
                                                                                        )}
                                                                                    </div>

                                                                                    {/* Photo Upload action */}
                                                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                                                        <input
                                                                                            type="file"
                                                                                            accept="image/*"
                                                                                            className="hidden"
                                                                                            id={`cad-step-ref-${area.id}-${item.id}`}
                                                                                            onChange={(e) => {
                                                                                                const file = e.target.files?.[0];
                                                                                                if (file) handleStepPhotoUpload(item.id, file);
                                                                                            }}
                                                                                        />
                                                                                        <label
                                                                                            htmlFor={`cad-step-ref-${area.id}-${item.id}`}
                                                                                            className={`p-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider cursor-pointer flex items-center gap-1 transition-all ${
                                                                                                refUploads[item.id]
                                                                                                    ? 'bg-primary/10 text-primary'
                                                                                                    : item.reference_photo_url
                                                                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                                                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                                                                                            }`}
                                                                                            title={item.reference_photo_url ? 'Change Clean Photo' : 'Upload Clean Photo'}
                                                                                        >
                                                                                            {refUploads[item.id] ? (
                                                                                                <Loader2 size={11} className="animate-spin" />
                                                                                            ) : (
                                                                                                <Camera size={11} />
                                                                                            )}
                                                                                            <span>{item.reference_photo_url ? 'Edit Photo' : 'Add Photo'}</span>
                                                                                        </label>

                                                                                        {/* Unlink step button */}
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => handleToggleStepLink(area.id, item.id)}
                                                                                            className="p-1 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50"
                                                                                            title="Remove step from area"
                                                                                        >
                                                                                            <X size={12} />
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {areas.length > 0 && (
                                            <button
                                                onClick={handleSaveAreas}
                                                disabled={isSavingAreas}
                                                className="w-full mt-auto py-3 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-all shadow-md shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {isSavingAreas ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                {isSavingAreas ? 'Saving Areas...' : 'Save Areas'}
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

    return createPortal(modalContent, document.body);
};

export default SOPCADConfigModal;

