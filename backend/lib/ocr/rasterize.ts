/**
 * PDF → page images. The missing layer between a scanned upload and a vision model.
 * -----------------------------------------------------------------------------
 * No vision API in use here accepts a PDF. ENGY rejects one outright:
 *
 *     "external image URLs are not fetched; inline the image as a base64 data: URI"
 *
 * So a scanned PDF — an AMC contract photographed and printed to PDF, a utility
 * bill from a scanner — has to become raster images before any model can read it.
 * Until now that path did not exist: documentBank/ocr.ts returned
 * 'no text layer and no image fallback available' and the upload silently
 * degraded to ocr_status 'failed'.
 *
 * ── WHY NOT ALWAYS RASTERIZE ────────────────────────────────────────────────
 * Because it is strictly worse when a text layer exists. A digital PDF's own text
 * is exact; OCR of a picture of that text is a guess. Rasterizing is the FALLBACK,
 * chosen only when `pdfjs` yields no usable text — never the default path.
 *
 * ── SIZE IS THE REAL CONSTRAINT ─────────────────────────────────────────────
 * Base64 inflates bytes by ~33%, and the encoded image travels in the request
 * body on every call. A 300-dpi full-page PNG is several MB and would blow both
 * the request limit and the token budget. So every page is rendered at a bounded
 * scale, then re-encoded through sharp as JPEG — typically 60-200KB per page,
 * which is ample for text a model has to read rather than a human.
 */

import sharp from 'sharp';

/** Pages beyond this are not read. Matches MAX_PAGES in documentBank/ocr.ts. */
export const DEFAULT_MAX_PAGES = 3;

/** Longest edge, in pixels, after rendering. Enough for body text; small enough to send. */
export const DEFAULT_MAX_EDGE = 1800;

/** JPEG quality. 82 is visually lossy and textually lossless in practice. */
const JPEG_QUALITY = 82;

/** Hard ceiling per page after compression. A page over this is dropped, loudly. */
const MAX_PAGE_BYTES = 1_400_000;

export interface RasterPage {
    /** 1-based page number, so an error can name the page a human sees. */
    page: number;
    buffer: Buffer;
    mime: 'image/jpeg';
    width: number;
    height: number;
    bytes: number;
}

export interface RasterizeOptions {
    maxPages?: number;
    maxEdge?: number;
}

export interface RasterizeResult {
    pages: RasterPage[];
    /** Total pages in the document, even when only some were rendered. */
    totalPages: number;
    /** Non-fatal problems: a page that failed to render or was too large. */
    warnings: string[];
}

/**
 * Render the first N pages of a PDF to compressed JPEG buffers.
 *
 * Throws only when the PDF itself cannot be opened. A single page that fails to
 * render is recorded in `warnings` and skipped, because one bad page must not
 * cost the caller the pages that did render.
 */
export async function rasterizePdf(
    pdfBytes: Buffer,
    opts: RasterizeOptions = {},
): Promise<RasterizeResult> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
    const warnings: string[] = [];

    // Imported lazily: both are heavy native/ESM deps, and a caller whose PDF has
    // a text layer must not pay to load them.
    const [{ createCanvas }, pdfjs] = await Promise.all([
        import('@napi-rs/canvas'),
        import('pdfjs-dist/legacy/build/pdf.mjs'),
    ]);

    const doc = await pdfjs.getDocument({
        data: new Uint8Array(pdfBytes),
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
    } as never).promise;

    const totalPages: number = doc.numPages;
    const count = Math.min(totalPages, maxPages);
    const pages: RasterPage[] = [];

    for (let n = 1; n <= count; n++) {
        try {
            const page = await doc.getPage(n);

            // Scale so the longest edge lands on maxEdge — never upscale past 2x,
            // which only inflates bytes without adding legible detail.
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2, Math.max(1, maxEdge / Math.max(base.width, base.height)));
            const viewport = page.getViewport({ scale });

            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const ctx = canvas.getContext('2d');
            // Scanned pages often have transparent margins; a white ground stops
            // them rendering as black once flattened into JPEG.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({
                canvas,
                canvasContext: ctx as never,
                viewport,
            } as never).promise;

            const jpeg = await sharp(canvas.toBuffer('image/png'))
                .flatten({ background: '#ffffff' })
                .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
                .toBuffer();

            if (jpeg.length > MAX_PAGE_BYTES) {
                warnings.push(`page ${n} is ${(jpeg.length / 1024 / 1024).toFixed(1)}MB after compression — skipped`);
                continue;
            }

            pages.push({
                page: n,
                buffer: jpeg,
                mime: 'image/jpeg',
                width: canvas.width,
                height: canvas.height,
                bytes: jpeg.length,
            });
        } catch (e) {
            warnings.push(`page ${n} failed to render: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (totalPages > count) {
        warnings.push(`document has ${totalPages} pages; only the first ${count} were read`);
    }

    return { pages, totalPages, warnings };
}

/**
 * The one encoding every vision API in use here actually accepts.
 * Kept in this module so no caller hand-rolls the prefix and gets the mime wrong.
 */
export function toDataUri(page: Pick<RasterPage, 'buffer' | 'mime'>): string {
    return `data:${page.mime};base64,${page.buffer.toString('base64')}`;
}
