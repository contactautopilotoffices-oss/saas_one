export const escapeReviewText = (s: unknown) => String(s ?? "").replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function reviewPage(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeReviewText(title)}</title>
<link rel="stylesheet" href="/apply/assets/recruitment-forms.css"></head><body class="rf rf-review">
<header class="rf-bar"><span class="rf-brand">Recruitment</span><span>Reviewer portal</span></header>
<main class="rf-content"><div class="rf-stack">${body}</div></main></body></html>`;
}
