/**
 * Standalone HTML for the email-action landing page.
 *
 * Deliberately dependency-free and self-contained: it is opened from a mail client,
 * often on mobile, by someone who may not have an app session.
 */

interface ConfirmingPage { kind: 'confirming'; token: string }
interface ResultPage { kind: 'success' | 'error'; title: string; message: string; link?: string; linkLabel?: string }
/**
 * A page that ASKS before it acts. Unlike 'confirming' this must NOT auto-submit:
 * the whole point is to capture what the recipient types, so a mail scanner's GET
 * — and an auto-submit — would destroy the very thing being collected.
 */
interface FeedbackPage {
    kind: 'feedback';
    title: string;
    /** The finding being answered, so the responder knows which line this closes. */
    context: string;
    /** Preselected answer from the button they tapped in the email. */
    signal: string;
    /**
     * What they already typed, carried across a rejected submit. Without this a
     * missing-note error threw away the paragraph they had just written.
     */
    note?: string;
    /** Why the previous submit was not accepted. The link is still live. */
    error?: { title: string; message: string } | null;
    /** The answer set. Supplied by the caller so this file owns no domain vocabulary. */
    options: Array<{ v: string; label: string; hint: string }>;
}
export type ActionPageInput = ConfirmingPage | ResultPage | FeedbackPage;

const shell = (inner: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Autopilot</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#FBFBF9; color:#16181C; padding:24px; }
  .card { background:#fff; border:1px solid #D3D2CB; border-radius:5px; padding:28px; max-width:520px; width:100%;
          text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; font-weight:800; letter-spacing:-0.02em; }
  p { font-size:14px; line-height:1.6; color:#4A4E55; margin:0 0 18px; }
  .icon { width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center;
          margin:0 auto 16px; font-size:26px; }
  .ok { background:#E7F0EE; color:#0B6E5F; } .bad { background:#F6E7E3; color:#B0442E; } .wait { background:#F5F5F1; color:#797E86; }
  a.btn, button.btn { display:inline-block; background:#16181C; color:#fff; padding:12px 22px; border-radius:4px;
          text-decoration:none; font-weight:700; font-size:14px; border:0; cursor:pointer; }
  .spin { width:26px; height:26px; border:3px solid #E4E3DE; border-top-color:#797E86; border-radius:50%;
          animation:s .8s linear infinite; margin:0 auto 16px; }
  @keyframes s { to { transform:rotate(360deg) } }
  @media (prefers-color-scheme: dark) {
    body { background:#16181C; color:#F5F5F1; } .card { background:#1D2025; border-color:#2A2E34; }
    p { color:#A8ACB2; }
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

    if (input.kind === 'feedback') {
        const OPTIONS = input.options;
        return shell(`
        <h1>${escapeHtml(input.title)}</h1>
        ${input.error ? `<div style="text-align:left;border:1px solid #E4C4BB;background:#F6E7E3;color:#B0442E;border-radius:4px;padding:11px 13px;margin:0 0 16px">
          <div style="font-weight:700;font-size:13.5px">${escapeHtml(input.error.title)}</div>
          <div style="font-size:12.5px;line-height:1.55;margin-top:2px">${escapeHtml(input.error.message)}</div>
        </div>` : ''}
        <p style="text-align:left;font-size:13px;color:#4A4E55;border-left:2px solid #E4E3DE;padding-left:12px;margin:0 0 20px">${escapeHtml(input.context)}</p>
        <form id="f" method="POST" action="" enctype="multipart/form-data" style="text-align:left">
          <label for="g" style="display:block;font-weight:700;font-size:15px;margin:0 0 4px;letter-spacing:-0.01em">
            In your words &mdash; what happened here?
          </label>
          <p style="font-size:12.5px;color:#797E86;margin:0 0 8px;line-height:1.55">
            This is the part that is kept. The button below records that the line closed;
            this text is the context saved against it, quoted back to whoever reads the summary,
            and folded into what the agent looks for next scan.
          </p>
          <textarea id="g" name="guidance" rows="5" autofocus
            placeholder="e.g. Credit note CN/2026/118 received from One Solution and blocked from the Sep payment run. Going forward they submit one invoice per site, so this pair should not recur."
            style="width:100%;box-sizing:border-box;border:1px solid ${input.error ? '#B0442E' : '#D3D2CB'};border-radius:4px;padding:12px 13px;font:inherit;font-size:14px;line-height:1.6;resize:vertical;background:#fff;color:#16181C">${escapeHtml(input.note ?? '')}</textarea>

          <div style="font-weight:700;font-size:13px;margin:18px 0 6px">And which is it?</div>
          <div style="display:grid;gap:6px;margin:0 0 16px">
            ${OPTIONS.map(o => `
            <label style="display:flex;gap:10px;align-items:flex-start;border:1px solid #E4E3DE;border-radius:4px;padding:10px 12px;cursor:pointer;background:#FBFBF9">
              <input type="radio" name="signal" value="${o.v}" ${o.v === input.signal ? 'checked' : ''} style="margin-top:2px">
              <span>
                <span style="display:block;font-weight:700;font-size:13.5px;color:#16181C">${escapeHtml(o.label)}</span>
                <span style="display:block;font-size:12px;color:#797E86;margin-top:1px">${escapeHtml(o.hint)}</span>
              </span>
            </label>`).join('')}
          </div>

          <label for="proof" style="display:block;font-weight:700;font-size:13px;margin:0 0 6px">
            Attach proof <span style="font-weight:400;color:#64748b">(optional)</span>
          </label>
          <input id="proof" name="proof" type="file"
            accept="application/pdf,image/png,image/jpeg,.xlsx,.xls,.csv"
            style="width:100%;box-sizing:border-box;border:1px dashed #D3D2CB;border-radius:4px;padding:11px 13px;font:inherit;font-size:13px;background:#FBFBF9">
          <p style="font-size:12px;color:#797E86;margin:6px 0 16px">
            Credit note, corrected PO, or signed confirmation. PDF, image or spreadsheet, up to 10&nbsp;MB. Stored against this finding as the audit record.
          </p>

          <button class="btn" type="submit" style="width:100%">Submit</button>
        </form>
        <p style="font-size:12px;color:#94a3b8;margin:14px 0 0">Works once. Do not forward this link.</p>`);
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
