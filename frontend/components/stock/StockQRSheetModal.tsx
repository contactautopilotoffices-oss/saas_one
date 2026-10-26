'use client';

import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Download, Loader2, QrCode } from 'lucide-react';
import type { jsPDF as JsPDF } from 'jspdf';

export interface QRSheetItem {
    id: string;
    name: string;
    item_code: string;
    barcode?: string | null;
    category?: string | null;
}

interface Props {
    items: QRSheetItem[];
    propertyName?: string;
    onClose: () => void;
}

// A4 sheet: 4 columns, 5 rows, 20 codes per page, item name under each QR.
const COLS = 4;
const ROWS = 5;
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 8;
const HEADER_H = 8;
const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
const CELL_H = (PAGE_H - MARGIN * 2 - HEADER_H) / ROWS;
const QR_SIZE_MM = 34;
const QR_PX = 400;
const CARD_BORDER: [number, number, number] = [225, 225, 230];
const TEXT_DARK: [number, number, number] = [20, 20, 24];
const TEXT_MUTED: [number, number, number] = [130, 130, 138];

/** What the stock scanner reads: the item's barcode, or its code if it has none. */
const qrValue = (item: QRSheetItem) => item.barcode || item.item_code;

function svgToPng(svgEl: SVGSVGElement): Promise<string> {
    return new Promise((resolve, reject) => {
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = QR_PX;
            canvas.height = QR_PX;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('canvas unavailable'));
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, QR_PX, QR_PX);
            ctx.drawImage(img, 0, 0, QR_PX, QR_PX);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    });
}

/** Up to two lines of item name; the second is cut with an ellipsis if it still does not fit. */
function nameLines(doc: JsPDF, text: string, maxW: number): string[] {
    const lines = doc.splitTextToSize(text, maxW) as string[];
    if (lines.length <= 2) return lines;
    let second = lines.slice(1).join(' ');
    while (second.length > 1 && doc.getTextWidth(`${second}…`) > maxW) second = second.slice(0, -1);
    return [lines[0], `${second.trimEnd()}…`];
}

/**
 * One PDF with the QR code of every stock item: 4 per row, item name below.
 * The QR holds the same value the stock scanner already looks up, so codes that
 * are already printed and these new ones scan the same way.
 */
export default function StockQRSheetModal({ items, propertyName, onClose }: Props) {
    const [category, setCategory] = useState('');
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState(0);

    const categories = useMemo(
        () => Array.from(new Set(items.map(i => i.category).filter(Boolean) as string[])).sort(),
        [items]
    );
    const selected = useMemo(
        () => items.filter(i => qrValue(i) && (!category || i.category === category)),
        [items, category]
    );

    const handleDownload = async () => {
        setGenerating(true);
        setProgress(0);
        try {
            const { jsPDF } = await import('jspdf');
            const doc = new jsPDF('p', 'mm', 'a4');
            const title = `${propertyName || 'Property'} - Stock QR Codes${category ? ` (${category})` : ''}`;
            const dateText = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const pages = Math.max(1, Math.ceil(selected.length / (COLS * ROWS)));

            const drawHeader = (page: number) => {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(...TEXT_DARK);
                doc.text(title, MARGIN, MARGIN + 4);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(...TEXT_MUTED);
                doc.text(`${dateText}  |  Page ${page} of ${pages}`, PAGE_W - MARGIN, MARGIN + 4, { align: 'right' });
            };

            drawHeader(1);
            for (let i = 0; i < selected.length; i++) {
                const item = selected[i];
                const slot = i % (COLS * ROWS);
                if (i > 0 && slot === 0) {
                    doc.addPage();
                    drawHeader(i / (COLS * ROWS) + 1);
                }
                const col = slot % COLS;
                const row = Math.floor(slot / COLS);
                const x = MARGIN + col * CELL_W;
                const y = MARGIN + HEADER_H + row * CELL_H;

                doc.setDrawColor(...CARD_BORDER);
                doc.setLineWidth(0.25);
                doc.roundedRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2, 2, 2, 'S');

                const svgEl = document.getElementById(`stock-qr-${item.id}`) as unknown as SVGSVGElement | null;
                if (svgEl) {
                    const png = await svgToPng(svgEl);
                    // 'FAST' compresses the image; raw pixels would make a huge file.
                    doc.addImage(png, 'PNG', x + (CELL_W - QR_SIZE_MM) / 2, y + 3, QR_SIZE_MM, QR_SIZE_MM, undefined, 'FAST');
                }

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(...TEXT_DARK);
                const lines = nameLines(doc, item.name, CELL_W - 6);
                doc.text(lines, x + CELL_W / 2, y + 3 + QR_SIZE_MM + 4, { align: 'center' });

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6);
                doc.setTextColor(...TEXT_MUTED);
                doc.text(item.item_code, x + CELL_W / 2, y + CELL_H - 3.5, { align: 'center' });

                setProgress(Math.round(((i + 1) / selected.length) * 100));
            }

            const safe = (propertyName || 'property').replace(/[^a-zA-Z0-9]+/g, '_');
            doc.save(`stock_qr_codes_${safe}${category ? `_${category.replace(/[^a-zA-Z0-9]+/g, '_')}` : ''}.pdf`);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <QrCode size={20} className="text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-extrabold text-slate-900">Download QR Codes</h2>
                            <p className="text-xs text-slate-500">{selected.length} item{selected.length === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl" aria-label="Close">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {categories.length > 1 && (
                        <label className="block">
                            <span className="text-xs font-semibold text-slate-500">Items</span>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400"
                            >
                                <option value="">All categories</option>
                                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </label>
                    )}
                    <p className="text-sm text-slate-600">
                        One A4 PDF, {COLS} QR codes per row, item name below each. Print it, cut along the boxes and stick each code where the item is kept.
                    </p>
                    {generating && (
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    )}
                    <button
                        onClick={handleDownload}
                        disabled={generating || selected.length === 0}
                        className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        {generating ? `Generating (${progress}%)` : 'Download PDF'}
                    </button>
                </div>
            </div>

            {/* Off-screen QR renders, one per item, turned into images for the PDF. */}
            <div style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0 }} aria-hidden>
                {selected.map(i => (
                    <QRCodeSVG key={i.id} id={`stock-qr-${i.id}`} value={qrValue(i)} size={QR_PX} level="M" includeMargin />
                ))}
            </div>
        </div>
    );
}
