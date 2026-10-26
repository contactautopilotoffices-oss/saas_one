export const EVIDENCE_BUCKET = 'petty_cash_evidence';
export function evidenceType(bytes: Uint8Array): string | null {
    if (bytes.length < 12) return null;
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (ascii(0, 5) === '%PDF-' && bytes.length > 20 && ascii(Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF')) return 'application/pdf';
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return null;
}
/** Validate decodability, not invoice authenticity; finance reviews the actual receipt. */
export async function validateEvidence(bytes: Uint8Array, type: string): Promise<boolean> {
    try {
        if (type === 'application/pdf') {
            const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
            try { const doc = await task.promise; return doc.numPages > 0; } finally { await task.destroy(); }
        }
        const sharp = (await import('sharp')).default;
        const metadata = await sharp(bytes, { limitInputPixels: 25000000, failOn: 'error' }).metadata();
        return Boolean(metadata.width && metadata.height);
    } catch { return false; }
}
