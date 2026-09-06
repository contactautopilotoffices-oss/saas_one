/**
 * THE FIXED HTML TEMPLATE. Deterministic. The AI never touches layout.
 * -----------------------------------------------------------------------------
 * Everything here is a pure function of a RecipientBundle. No model call, no
 * randomness, no branching on anything but the data. Given the same findings it
 * emits byte-identical HTML — which is what makes it reviewable and testable,
 * and why asking an LLM to "write the email" was one AI step too many.
 *
 * FIRST SCREEN CONTRACT: health → count → critical → decisions required. Evidence
 * lives below the fold. The recipient must never read an analysis to discover
 * what they personally need to do.
 *
 * EMAIL-CLIENT CONSTRAINTS, deliberately: tables for layout, inline styles only,
 * no flexbox/grid, no web fonts, no background images, 600px. Outlook and Gmail
 * strip <style> blocks and ignore modern CSS; this renders the same in both.
 */

import { entityUrl, type EntityRef, type Priority } from './types';
import { DISPOSITION_SPECS, statusLine, type Disposition, type DispositionStatus } from './disposition';
import type { RecipientBundle, RoutedFinding } from './router';

/**
 * PALETTE — taken verbatim from backend/lib/ira/dailyDigest.ts, so the two Ira
 * emails read as one system rather than two products. Warm off-white ground,
 * near-black text, 4-5px radii, no blue-slate anywhere.
 */
const GROUND = '#FBFBF9';  // page
const CARD   = '#ffffff';
const TINT   = '#F5F5F1';  // header bands, chips
const LINE   = '#E4E3DE';  // inner rules
const EDGE   = '#D3D2CB';  // outer card border
const BRAND  = '#16181C';  // primary text
const BODY   = '#4A4E55';  // secondary text
const MUTED  = '#797E86';  // labels

/** Status tones are the digest's, not a second vocabulary. */
const TONE: Record<Priority, { dot: string; fg: string; label: string }> = {
    critical: { dot: '#B0442E', fg: '#B0442E', label: 'Critical' },
    action:   { dot: '#B07206', fg: '#B07206', label: 'Action' },
    watch:    { dot: '#7A776E', fg: '#7A776E', label: 'Watch' },
    closed:   { dot: '#0B6E5F', fg: '#0B6E5F', label: 'Closed' },
};

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ₹1,66,432 — Indian digit grouping, because that is what the reader expects. */
export function inr(n: number): string {
    const rounded = Math.round(n);
    const s = String(Math.abs(rounded));
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
    return `${rounded < 0 ? '-' : ''}₹${grouped}`;
}

/** ₹1.66L / ₹2.3Cr for headline figures. */
export function inrShort(n: number): string {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
    return inr(n);
}

/**
 * A reference, as a link when it resolves and as plain text when it does not.
 * There is no third branch: a URL is never invented to fill the gap.
 */
function refChip(ref: EntityRef, orgId: string): string {
    const url = entityUrl(ref, orgId);
    const label = esc(ref.label);
    if (!url) {
        return `<span style="display:inline-block;padding:3px 9px;margin:0 5px 5px 0;border:1px solid ${LINE};border-radius:4px;font-size:12px;color:${MUTED};background:${TINT}">${label}</span>`;
    }
    return `<a href="${esc(url)}" style="display:inline-block;padding:3px 9px;margin:0 5px 5px 0;border:1px solid ${EDGE};border-radius:4px;font-size:12px;color:${BRAND};background:${TINT};text-decoration:none">${label} &#8599;</a>`;
}

/** Per-finding one-click disposition URLs, keyed by finding.key then disposition. */
export type FeedbackLinks = Record<string, Partial<Record<Disposition, string>>>;

/** Per-finding status of what someone has ALREADY answered. Keyed by finding.key. */
export type DispositionStatuses = Record<string, DispositionStatus>;

/** Order shown in the email. Closing answers first — they are the common case. */
const DISPOSITION_ORDER: Disposition[] = ['done', 'not_an_issue', 'in_progress', 'blocked', 'need_info'];

/**
 * THE CLOSE STRIP — one answer per line, for the people who work the lines.
 *
 * THE POINT IS THE EXPLANATION, NOT THE BUTTON. A tap alone records that a line
 * closed; it does not record WHY, and the why is the only part that survives to
 * change the next scan. So the strip leads with the ask ("tell it what you did"),
 * every button opens a page whose main field is free text, and the copy says so
 * before anyone taps.
 *
 * Rendered ONLY when real signed links exist. There is deliberately no decorative
 * version: a button that records nothing teaches people their answers are ignored.
 */
function closeStrip(links: FeedbackLinks[string] | undefined, replyTo?: string, subject?: string): string {
    if (!links && !replyTo) return '';
    const buttons = DISPOSITION_ORDER.filter((d) => links?.[d]);

    /**
     * THE REPLY BOX THAT ISN'T ONE.
     *
     * An email body cannot contain a working text field — Zoho Mail (this team's
     * client) strips <form>, and AMP for Email, which would allow it, is not
     * rendered by Zoho.
     *
     * The previous version made the whole box a mailto: link and called that
     * "works everywhere mailto works — which is everywhere". IT IS NOT. Chrome
     * with no registered mail handler — the exact setup on this team's machines —
     * swallows the click and lands on `about:blank#blocked`. The one affordance
     * on the card was a dead end, and a dead end is worse than no button because
     * the reader concludes the whole loop is broken.
     *
     * So the PRIMARY instruction is now the thing that cannot fail: hit Reply.
     * The thread is already addressed to the polled mailbox (Reply-To is set on
     * the send) and the subject already carries the tag the parser matches, so a
     * plain reply lands correctly with zero special handling.
     *
     * mailto: survives only as a SECONDARY convenience, small and clearly
     * optional — useful on a phone, harmless when the browser blocks it.
     * The address is NOT percent-encoded: `mailto:` takes the address in the
     * path, and encoding the "@" produced a malformed target on clients that
     * did follow it.
     */
    const mailto = replyTo
        ? `mailto:${replyTo}?subject=${encodeURIComponent(subject ?? '')}`
        : null;

    const replyBox = replyTo
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px">
             <tr><td style="border:1px solid ${EDGE};border-radius:4px;background:${CARD};padding:13px 14px">
               <div style="font-size:13.5px;font-weight:700;color:${BRAND};line-height:1.5">
                 &#8629;&nbsp; Hit <span style="text-decoration:underline">Reply</span> and type what you did.
               </div>
               <div style="font-size:11.5px;color:${MUTED};line-height:1.55;margin-top:6px">
                 Reply goes to <b style="color:${BODY}">${esc(replyTo)}</b>. Keep the subject line as it is &mdash;
                 that is how Ira matches your answer to this line. Attach the credit note, corrected PO or
                 photo to the same reply if you have one.
               </div>
               ${mailto ? `<div style="font-size:11px;margin-top:9px"><a href="${esc(mailto)}" style="color:${MUTED};text-decoration:underline">On a phone? Tap to open a pre-addressed reply</a></div>` : ''}
             </td></tr>
           </table>`
        : '';

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0">
        <tr><td style="padding:12px 13px;border:1px solid ${EDGE};border-radius:4px;background:${GROUND}">
          <div style="font-size:13px;font-weight:700;color:${BRAND};letter-spacing:-0.01em;margin-bottom:8px">Close this line</div>
          ${replyBox}
          <div style="font-size:11.5px;line-height:1.55;color:${MUTED};margin:0 0 9px">
            Your sentence is what gets kept &mdash; quoted to whoever reads the summary, and it changes what
            Ira raises next scan.
            ${buttons.length ? '<br>Nothing to add? Tap:' : ''}
          </div>
          ${buttons.map((d) => {
              const spec = DISPOSITION_SPECS[d];
              const strong = spec.closes;
              return `<a href="${esc((links?.[d]) as string)}" style="display:inline-block;padding:7px 12px;margin:0 6px 6px 0;border:1px solid ${strong ? EDGE : LINE};border-radius:4px;font-size:12px;font-weight:600;color:${strong ? BRAND : BODY};background:${strong ? CARD : TINT};text-decoration:none">${esc(spec.label)}</a>`;
          }).join('')}
          ${buttons.length ? `<div style="font-size:11px;color:${MUTED};margin-top:4px">Buttons work once. Do not forward.</div>` : ''}
        </td></tr>
      </table>`;
}

/**
 * What someone who is NOT going to action the line sees instead of buttons:
 * whether the team has answered, and IN THEIR OWN WORDS why.
 *
 * The quote is the point. "Done by Vidya" says a box was ticked; "Credit note
 * CN/2026/118 received, blocked from the Sep payment run" is the thing an
 * executive actually needed to know.
 */
function statusStrip(status: DispositionStatus | undefined): string {
    const line = statusLine(status);
    if (!line) {
        return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0">
        <tr><td style="padding:9px 12px;border:1px solid ${LINE};border-radius:4px;background:${TINT}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#B07206;vertical-align:middle"></span>
          <span style="font-size:12px;color:${BODY};margin-left:7px;vertical-align:middle">Open &mdash; procurement has not answered this yet</span>
        </td></tr>
      </table>`;
    }
    const closed = status?.disposition ? DISPOSITION_SPECS[status.disposition].closes : false;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0">
        <tr><td style="padding:10px 12px;border:1px solid ${LINE};border-radius:4px;background:${TINT}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${closed ? '#0B6E5F' : '#3D5A8A'};vertical-align:middle"></span>
          <span style="font-size:12px;font-weight:700;color:${BRAND};margin-left:7px;vertical-align:middle">${esc(line)}</span>
          ${status?.note ? `<div style="font-size:12.5px;line-height:1.6;color:${BODY};margin:7px 0 0;padding-left:15px;border-left:2px solid ${EDGE}">&ldquo;${esc(status.note)}&rdquo;</div>` : ''}
        </td></tr>
      </table>`;
}

function findingBlock(f: RoutedFinding, orgId: string, index: number, canDisposition: boolean, fb?: FeedbackLinks[string], status?: DispositionStatus, replyTo?: string, replySubject?: string): string {
    const tone = TONE[f.priority];
    const context = [f.vendor, f.property].filter(Boolean).map((x) => esc(String(x))).join(' &middot; ');

    const stats = f.stats?.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:11px 0 0"><tr>${f.stats
              .map((st) => `<td style="padding:0 20px 0 0"><div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${MUTED};font-weight:600">${esc(st.label)}</div><div style="font-size:15px;font-weight:700;color:${BRAND};margin-top:2px">${esc(st.value)}</div></td>`)
              .join('')}</tr></table>`
        : '';

    const refs = f.refs.length ? `<div style="margin:12px 0 0">${f.refs.map((r) => refChip(r, orgId)).join('')}</div>` : '';

    const actions = f.actions
        .map((a) => `<tr><td style="padding:11px 13px;background:${TINT};border:1px solid ${LINE};border-radius:4px">
                   <div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${tone.fg};font-weight:700">Your action${a.deadline ? ` &middot; ${esc(a.deadline)}` : ''}</div>
                   <div style="font-size:14px;line-height:1.55;color:${BRAND};margin-top:4px">${esc(a.action)}</div>
                 </td></tr>`)
        .join('<tr><td style="height:6px"></td></tr>');

    return `
    <tr><td style="padding:0 0 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EDGE};border-radius:5px;background:${CARD};overflow:hidden">
        <tr><td style="padding:12px 16px;background:${TINT};border-bottom:1px solid ${LINE}">
          <div style="display:block;margin-bottom:5px">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${tone.dot};vertical-align:middle"></span>
            <span style="font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:${tone.fg};font-weight:700;vertical-align:middle;margin-left:6px">${index}. ${esc(tone.label)}</span>
          </div>
          <div style="font-size:16px;font-weight:700;color:${BRAND};letter-spacing:-0.01em;line-height:1.35">${esc(f.title)}${f.amount !== null ? ` &mdash; ${inr(f.amount)}` : ''}</div>
          ${context ? `<div style="font-size:12px;color:${MUTED};margin-top:3px">${context}</div>` : ''}
        </td></tr>
        <tr><td style="padding:14px 16px">
          <div style="font-size:13px;line-height:1.6;color:${BODY};white-space:pre-line">${esc(f.problem)}</div>
          ${stats}
          ${refs}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0">${actions}</table>
          ${canDisposition ? closeStrip(fb, replyTo, replySubject) : statusStrip(status)}
        </td></tr>
      </table>
    </td></tr>`;
}

export interface RenderedEmail {
    subject: string;
    html: string;
    /** Recipients with nothing to do produce no email; this is never true here. */
    findingCount: number;
}

/**
 * The site stamp on a mail that shares an inbox with two other people's mail.
 *
 * `label` is the city ("BLR"); `owners` are the humans who answer for it. Both
 * come from configuration, never from a model — see procurement/sites.ts.
 */
export interface SiteTag {
    label: string;
    owners: string[];
}

export function renderRecipientEmail(
    bundle: RecipientBundle,
    orgId: string,
    when: Date = new Date(),
    feedbackLinks: FeedbackLinks = {},
    attachmentNames: ReadonlyArray<string> = [],
    /** Address replies come back to. Omit and the reply box is not rendered. */
    replyTo: string | null = null,
    /** finding.key -> the tagged subject its reply must carry. */
    replySubjects: Record<string, string> = {},
    /** What the workers have already answered. Read by recipients who don't close lines. */
    statuses: DispositionStatuses = {},
    /**
     * Whose city this mail is, when one shared mailbox serves several owners.
     * Null renders exactly today's header — the tag is additive, never required.
     */
    siteTag: SiteTag | null = null,
): RenderedEmail {
    const { counts, recipient, findings } = bundle;

    const date = when.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const open = counts.total - counts.closed;
    // Three site mails land in the SAME mailbox. Without the site in the subject
    // they are three identical lines in a list and the owner opens the wrong one.
    const scanTag = siteTag ? `${date.toUpperCase()} PO SCAN — ${siteTag.label.toUpperCase()}` : null;
    const lead = scanTag ?? 'FMS Procurement';
    const subject =
        counts.critical > 0
            ? `${lead} — ${counts.critical} critical · ${inrShort(counts.exposure)} exposure`
            : `${lead} — ${open} item${open === 1 ? ' needs' : 's need'} your attention`;

    // FIRST SCREEN: health, count, critical, exposure. Nothing above this.
    const summary = `
      <tr><td style="padding:0 0 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EDGE};border-radius:5px;background:${CARD};overflow:hidden">
          <tr><td style="padding:9px 16px;background:${TINT};border-bottom:1px solid ${LINE};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">
            ${esc(recipient.lens)} &middot; ${esc(date)}
          </td></tr>
          <tr><td style="padding:18px 16px">
            <div style="font-size:26px;font-weight:800;color:${BRAND};letter-spacing:-0.02em;line-height:1.2">${open} ${open === 1 ? 'item needs' : 'items need'} your attention</div>
            <div style="font-size:13.5px;line-height:1.6;color:${BODY};margin-top:6px">
              ${counts.critical} critical &middot; ${inrShort(counts.exposure)} exposure${counts.closed ? ` &middot; ${counts.closed} already closed` : ''}.
              ${recipient.canDisposition
                  ? 'Close each line below and say what you did &mdash; that note is what the agent keeps.'
                  : 'Lines already answered by procurement show their reason underneath.'}
            </div>
          </td></tr>
        </table>
      </td></tr>`;

    const anyLink = findings.some((f) => f.refs.some((r) => entityUrl(r, orgId) !== null));
    const linkNotice =
        !anyLink && findings.some((f) => f.refs.length)
            ? `<tr><td style="padding:0 0 16px"><div style="padding:10px 12px;background:${TINT};border:1px solid ${LINE};border-radius:4px;font-size:11.5px;line-height:1.55;color:${MUTED}">Record references are shown as plain text: no application URL is configured on this deployment, and a link that cannot be verified is not generated.</div></td></tr>`
            : '';

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${GROUND};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:100%">
        <tr><td style="padding:0 0 16px">
          ${scanTag
            ? `<div style="font-size:15px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${BRAND};line-height:1.3">${esc(scanTag)}</div>
               <div style="font-size:12.5px;color:${BODY};margin-top:3px">${
                   siteTag && siteTag.owners.length
                       ? `Assigned to <b style="color:${BRAND};font-weight:700">${esc(siteTag.owners.join(', '))}</b>`
                       : 'No owner configured for this site &mdash; set one in Agent Console &rsaquo; Delivery.'
               }</div>
               <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:600;margin-top:7px">FMS Procurement &middot; ${esc(time)}</div>`
            : `<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:600">FMS Procurement &middot; ${esc(time)}</div>`}
        </td></tr>
        ${summary}
        ${linkNotice}
        ${findings.map((f, i) => findingBlock(f, orgId, i + 1, recipient.canDisposition, feedbackLinks[f.key], statuses[f.key], replyTo ?? undefined, replySubjects[f.key])).join('')}
        ${attachmentNames.length ? `<tr><td style="padding:0 0 14px"><div style="padding:10px 12px;background:${TINT};border:1px solid ${LINE};border-radius:4px;font-size:11.5px;line-height:1.6;color:${BODY}"><strong style="color:${BRAND}">Attached:</strong> ${attachmentNames.map((n) => esc(n)).join(', ')}. Everything else is linked above rather than attached, to keep this email light.</div></td></tr>` : ''}
        <tr><td style="padding:4px 0 0;border-top:1px solid ${LINE}">
          <div style="font-size:11px;line-height:1.6;color:${MUTED};padding-top:12px">
            Sent by Ira &middot; procurement agent. You are receiving only the lines that need <strong style="color:${BODY}">you</strong>; the rest went to the people who own them.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    return { subject, html, findingCount: counts.total };
}
