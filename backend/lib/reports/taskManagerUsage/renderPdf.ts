/**
 * Print report HTML to an A4 PDF through headless Chromium.
 *
 * Vercel functions have no Chrome: the `puppeteer` package keeps its browser in a cache folder that is not deployed, so
 * there we use the serverless build from @sparticuz/chromium. Locally and on ordinary servers `puppeteer` works as it is.
 * Both are imported lazily because a browser must not load with every route that imports this file's types.
 */

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function launchBrowser() {
    if (IS_SERVERLESS) {
        const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
            import('@sparticuz/chromium'),
            import('puppeteer-core'),
        ]);
        return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell' });
    }
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
}

export async function renderPdf(html: string, footerLabel: string): Promise<Buffer> {
    const browser = await launchBrowser();
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: `<div style="width:100%;padding:0 14mm;font-size:8px;color:#64748B;font-family:sans-serif;display:flex;justify-content:space-between;">
                <span>${footerLabel}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
        });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}
