'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Download, Loader2, Printer } from 'lucide-react';
import type { jsPDF as JsPDF } from 'jspdf';
import { assetScanUrl, appOrigin } from '@/frontend/lib/assets/roles';

export interface LabelAsset { id: string; asset_code: string; name: string; qr_token: string }

interface Props {
    assets: LabelAsset[];
    propertyName?: string;
    onClose: () => void;
}

// A4 label sheet: 3 columns x 6 rows, 18 labels/page — generous for a hand-held scanner.
const COLS = 3;
const ROWS = 6;
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 8;
const CELL_W = (PAGE_W - MARGIN * 2) / COLS;
const CELL_H = (PAGE_H - MARGIN * 2) / ROWS;

// Card layout inside each cell (mm)
const CARD_PAD = 1.5;
const QR_SIZE_MM = 30;
const QR_TOP_PAD = 1.5;
const PILL_GAP = 1.5;
const PILL_H = 6.5;
/** Code baseline below the pill — keeps ~1.7 mm clear of the card's bottom edge. */
const CODE_BASELINE = 2.6;

// Brand palette — sampled from the reference label design; the pink is the
// --neon-magenta token already defined in globals.css.
const PINK_BORDER: [number, number, number] = [236, 72, 153]; // #EC4899
const PINK_FILL: [number, number, number] = [253, 234, 241];
const CARD_BORDER: [number, number, number] = [230, 230, 235];
const TEXT_DARK: [number, number, number] = [20, 20, 24];
const TEXT_MUTED: [number, number, number] = [140, 140, 148];

/** The Autopilot "A", cut from the wordmark in public/ and tinted brand pink. */
const LOGO_SRC = '/autopilot-mark-pink.png';

/**
 * Width of the white logo plate as a fraction of the QR image (quiet zone
 * included). Measured, not guessed: with real site addresses (44–66 chars) the
 * code stops decoding at 0.36–0.38, blurred or not. 0.24 keeps a wide margin for
 * glare, dirt and curved surfaces on printed stickers. Re-run the scan test
 * before raising it.
 */
const PLATE_FRAC = 0.24;
const QR_PX = 480;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function svgToImage(svgEl: SVGSVGElement): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // a missing logo must not block printing
        img.src = src;
    });
}

/**
 * One QR as a PNG: the code, a white rounded plate in the middle, the pink "A"
 * on the plate. Error correction is level H so the plate is survivable. The
 * on-screen preview and the PDF both use this, so what you see is what prints.
 */
async function composeQrWithLogo(svgEl: SVGSVGElement, logo: HTMLImageElement | null, px = QR_PX): Promise<string> {
    const qrImg = await svgToImage(svgEl);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(qrImg, 0, 0, px, px);

    if (logo) {
        const plate = px * PLATE_FRAC;
        const plateXY = (px - plate) / 2;
        ctx.fillStyle = '#ffffff';
        roundRectPath(ctx, plateXY, plateXY, plate, plate, plate * 0.18);
        ctx.fill();

        const inner = plate * 0.72;
        const scale = Math.min(inner / logo.width, inner / logo.height);
        const lw = logo.width * scale;
        const lh = logo.height * scale;
        ctx.drawImage(logo, (px - lw) / 2, (px - lh) / 2, lw, lh);
    }

    return canvas.toDataURL('image/png');
}

/** Shrink the name down to minSize, then cut it with an ellipsis — never overflow the pill. */
function fitText(doc: JsPDF, text: string, maxW: number, startSize: number, minSize: number): string {
    let size = startSize;
    doc.setFontSize(size);
    while (size > minSize && doc.getTextWidth(text) > maxW) {
        size -= 0.5;
        doc.setFontSize(size);
    }
    if (doc.getTextWidth(text) <= maxW) return text;
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxW) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
}

// window.location is browser-only; this reads it without a hydration mismatch
// (null during server render, the real value once mounted).
const noopSubscribe = () => () => {};

/**
 * Bulk QR label sheet — one hidden QRCodeSVG per asset, the Autopilot "A"
 * composited into its center, laid into a branded A4 grid PDF: QR, the asset
 * name in a pink pill, and its code underneath.
 */
export default function AssetQRLabelsModal({ assets, propertyName, onClose }: Props) {
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [previewPng, setPreviewPng] = useState<string | null>(null);

    const origin = useSyncExternalStore(noopSubscribe, appOrigin, () => null);
    const ready = !!origin && /^https?:\/\//.test(origin);

    const urls = useMemo(
        () => new Map(assets.map((a) => [a.id, ready ? assetScanUrl(a.qr_token, origin!) : ''])),
        [assets, origin, ready],
    );
    const previewAsset = assets[0];

    useEffect(() => {
        if (!ready || !previewAsset) return;
        let cancelled = false;
        (async () => {
            const el = document.getElementById(`asset-label-qr-${previewAsset.id}`) as unknown as SVGSVGElement | null;
            if (!el) return;
            const png = await composeQrWithLogo(el, await loadImage(LOGO_SRC));
            if (!cancelled) setPreviewPng(png);
        })();
        return () => { cancelled = true; };
    }, [ready, previewAsset]);

    const handleDownload = async () => {
        if (!ready) return;
        setGenerating(true);
        setProgress(0);
        try {
            const { jsPDF } = await import('jspdf');
            const doc = new jsPDF('p', 'mm', 'a4');
            const logo = await loadImage(LOGO_SRC);
            let col = 0;
            let row = 0;

            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                const svgEl = document.getElementById(`asset-label-qr-${asset.id}`) as unknown as SVGSVGElement | null;
                if (!svgEl) continue;

                if (i > 0 && col === 0 && row === 0) doc.addPage();

                const x = MARGIN + col * CELL_W;
                const y = MARGIN + row * CELL_H;
                const cardX = x + CARD_PAD;
                const cardY = y + CARD_PAD;
                const cardW = CELL_W - CARD_PAD * 2;
                const cardH = CELL_H - CARD_PAD * 2;

                doc.setDrawColor(...CARD_BORDER);
                doc.setLineWidth(0.25);
                doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, 'S');

                const png = await composeQrWithLogo(svgEl, logo);
                const qrX = x + (CELL_W - QR_SIZE_MM) / 2;
                const qrY = cardY + QR_TOP_PAD;
                // 'FAST' = Flate-compressed. Without it jsPDF stores raw pixels, ~0.7 MB
                // per label — a few hundred labels would make an unopenable file.
                doc.addImage(png, 'PNG', qrX, qrY, QR_SIZE_MM, QR_SIZE_MM, undefined, 'FAST');

                // Pink pill with the asset name
                const pillY = qrY + QR_SIZE_MM + PILL_GAP;
                const pillW = cardW - 3;
                const pillX = x + (CELL_W - pillW) / 2;
                doc.setFillColor(...PINK_FILL);
                doc.setDrawColor(...PINK_BORDER);
                doc.setLineWidth(0.3);
                doc.roundedRect(pillX, pillY, pillW, PILL_H, PILL_H / 2, PILL_H / 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...TEXT_DARK);
                const name = fitText(doc, asset.name, pillW - 4, 8, 6);
                doc.text(name, x + CELL_W / 2, pillY + PILL_H / 2 + 1, { align: 'center' });

                // Asset code, small and muted, under the pill
                doc.setFontSize(6);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...TEXT_MUTED);
                doc.text(asset.asset_code, x + CELL_W / 2, pillY + PILL_H + CODE_BASELINE, { align: 'center' });

                setProgress(Math.round(((i + 1) / assets.length) * 100));

                col++;
                if (col >= COLS) { col = 0; row++; }
                if (row >= ROWS) { row = 0; }
            }

            doc.save(`asset_qr_labels_${(propertyName || 'property').replace(/\s+/g, '_')}.pdf`);
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
                            <Printer size={20} className="text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-extrabold text-slate-900">Print QR Labels</h2>
                            <p className="text-xs text-slate-500">{assets.length} asset{assets.length === 1 ? '' : 's'} selected</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {previewAsset && (
                        <div className="flex justify-center">
                            <div className="flex flex-col items-center gap-2.5 p-4 rounded-2xl border border-slate-200 bg-white w-48">
                                {previewPng ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={previewPng} alt={`QR label for ${previewAsset.name}`} className="w-36 h-36" />
                                ) : (
                                    <div className="w-36 h-36 flex items-center justify-center">
                                        <Loader2 size={20} className="text-slate-300 animate-spin" />
                                    </div>
                                )}
                                <span
                                    className="w-full px-3 py-1.5 rounded-full text-xs font-bold text-slate-900 text-center leading-tight truncate"
                                    style={{ backgroundColor: '#FDEAF1', border: '1.2px solid #EC4899' }}
                                >
                                    {previewAsset.name}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">{previewAsset.asset_code}</span>
                            </div>
                        </div>
                    )}

                    <p className="text-sm text-slate-600">
                        One A4 PDF, {COLS}×{ROWS} labels per page. Print on adhesive label sheets and stick each one on its equipment.
                    </p>
                    {ready && (
                        <p className="text-xs text-slate-400">
                            Labels open <span className="font-mono text-slate-500">{origin}</span> when scanned. Print from the live site, not a test link.
                        </p>
                    )}
                    {generating && (
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    )}
                    <button
                        onClick={handleDownload}
                        disabled={!ready || generating || assets.length === 0}
                        className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        {generating ? `Generating (${progress}%)` : 'Download PDF'}
                    </button>
                </div>
            </div>

            {/* Off-screen QR renders, one per asset, composited with the logo for the preview and the PDF. */}
            {ready && (
                <div style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0 }} aria-hidden>
                    {assets.map((a) => (
                        <QRCodeSVG key={a.id} id={`asset-label-qr-${a.id}`} value={urls.get(a.id) || ''} size={QR_PX} level="H" includeMargin />
                    ))}
                </div>
            )}
        </div>
    );
}
