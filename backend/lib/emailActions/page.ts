/**
 * Standalone HTML for the email-action landing page.
 *
 * Deliberately dependency-free and self-contained: it is opened from a mail client,
 * often on mobile, by someone who may not have an app session.
 */

interface ConfirmingPage { kind: 'confirming'; token: string }
interface ResultPage { kind: 'success' | 'error'; title: string; message: string; link?: string; linkLabel?: string }
export type ActionPageInput = ConfirmingPage | ResultPage;

const shell = (inner: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Autopilot</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:system-ui,-apple-system,"Segoe UI",sans-serif; background:#f8fafc; color:#0f172a; padding:24px; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:20px; padding:32px; max-width:420px; width:100%;
          text-align:center; box-shadow:0 10px 30px rgba(15,23,42,.06); }
  h1 { font-size:19px; margin:0 0 8px; font-weight:800; }
  p { font-size:14px; line-height:1.55; color:#475569; margin:0 0 18px; }
  .icon { width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center;
          margin:0 auto 16px; font-size:26px; }
  .ok { background:#dcfce7; color:#15803d; } .bad { background:#fee2e2; color:#b91c1c; } .wait { background:#e0e7ff; color:#4338ca; }
  a.btn, button.btn { display:inline-block; background:#4f46e5; color:#fff; padding:11px 22px; border-radius:12px;
          text-decoration:none; font-weight:700; font-size:14px; border:0; cursor:pointer; }
  .spin { width:26px; height:26px; border:3px solid #c7d2fe; border-top-color:#4338ca; border-radius:50%;
          animation:s .8s linear infinite; margin:0 auto 16px; }
  @keyframes s { to { transform:rotate(360deg) } }
  @media (prefers-color-scheme: dark) {
    body { background:#0b1120; color:#e2e8f0; } .card { background:#111827; border-color:#1f2937; }
    p { color:#94a3b8; }
  }
</style></head><body><div class="card">${inner}</div></body></html>`;

export function actionPage(input: ActionPageInput): string {
    if (input.kind === 'confirming') {
        // The POST is what actually mutates. Auto-submitted so the recipient clicks once;
        // link-scanners that only issue GETs never reach it.
        return shell(`
        <div class="spin"></div>
        <h1>Applying your decision…</h1>
        <p>One moment. Do not close this window.</p>
        <form id="f" method="POST" action="">
          <noscript><button class="btn" type="submit">Confirm</button></noscript>
        </form>
        <script>document.getElementById('f').submit();</script>`);
    }

    const isOk = input.kind === 'success';
    return shell(`
        <div class="icon ${isOk ? 'ok' : 'bad'}">${isOk ? '&#10003;' : '&#33;'}</div>
        <h1>${escapeHtml(input.title)}</h1>
        <p>${escapeHtml(input.message)}</p>
        ${input.link ? `<a class="btn" href="${escapeHtml(input.link)}">${escapeHtml(input.linkLabel || 'Open app')}</a>` : ''}`);
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
