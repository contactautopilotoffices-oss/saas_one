/**
 * The ONE way this codebase loads pdfjs-dist on the server.
 *
 * Why it exists: pdfjs runs "on the main thread" in Node by importing its own worker file at run
 * time from a computed path. Vercel packages only files it can SEE being imported, so on the live
 * site that file was left out and every PDF read failed with
 *   Setting up fake worker failed: Cannot find module '.../pdfjs-dist/legacy/build/pdf.worker.mjs'
 * (it worked on a developer machine, where node_modules is complete).
 *
 * Importing the worker here with a LITERAL path makes the packager include it, and handing it to
 * pdfjs as `globalThis.pdfjsWorker` stops pdfjs looking for it by path at all.
 */
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loading: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
    loading ??= (async () => {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        // @ts-expect-error the worker file ships without type declarations
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
        return pdfjs;
    })().catch((e) => { loading = null; throw e; });
    return loading;
}
