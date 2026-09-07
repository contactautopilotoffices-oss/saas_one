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
import type { ScanCoverage } from './checks';
import { DISPOSITION_SPECS, statusLine, type Disposition, type DispositionStatus } from './disposition';
import type { RecipientBundle, RoutedFinding } from './router';
import { tagFromSubject } from './reply';

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
    // The order in Zoho Books wins over our own read-only page: that is where
    // the comment box is, and the comment box is where things actually change.
    const url = ref.url ?? entityUrl(ref, orgId);
    const label = esc(ref.label);
    if (!url) return `<span style="display:inline-block;padding:3px 9px;margin:0 5px 5px 0;border:1px solid ${LINE};border-radius:4px;font-size:12px;color:${BODY};background:${TINT}">${label}</span>`;
    return `<a href="${esc(url)}" style="display:inline-block;padding:4px 10px;margin:0 5px 5px 0;border:1px solid ${EDGE};border-radius:4px;font-size:12px;font-weight:600;color:${BRAND};background:${CARD};text-decoration:none">${label} &nbsp;&#8599;</a>`;
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
function vettingLine(v: VettingStamp): string {
    const tone = v.verdict === 'sound' ? '#0B6E5F' : v.verdict === 'needs_human' ? '#B0442E' : '#B07206';
    const label = v.verdict === 'sound' ? 'sound' : v.verdict === 'needs_human' ? 'needs a human read' : `${v.concerns.length} concern${v.concerns.length === 1 ? '' : 's'}`;
    const runLevel = v.concerns.filter((c) => !c.finding_key);
    return `<div style="margin-top:9px;font-size:12px;color:${BODY}">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tone};margin-right:6px;vertical-align:middle"></span>
      Vetted by <b style="color:${BRAND}">${esc(v.reviewer)}</b> &middot; <span style="color:${tone};font-weight:700">${esc(label)}</span>
      ${runLevel.length ? `<div style="margin-top:4px;font-size:11.5px;color:${MUTED}">${runLevel.map((c) => esc(c.concern)).join(' ')}</div>` : ''}
    </div>`;
}

function closeStrip(links: FeedbackLinks[string] | undefined, replyTo?: string, subject?: string, multi = false): string {
    /**
     * PER FINDING: the one-tap buttons only.
     *
     * The full "hit Reply" invitation used to render under EVERY item, so a
     * five-item email repeated the same three paragraphs five times. It is one
     * instruction about the whole email, so it is printed once, at the end —
     * see replyFooter().
     *
     * The ref still travels invisibly. An HTML comment survives a quoted reply
     * in every client we care about and never renders as text, so the poller
     * keeps a reliable match without the reader ever seeing a hash. If it is
     * stripped, matching falls back to the PO number in their own words.
     */
    const hiddenRef = subject ? tagFromSubject(subject) : null;
    const buttons = DISPOSITION_ORDER.filter((d) => links?.[d]);
    void replyTo; void multi;
    if (!buttons.length) return hiddenRef ? `<!--ira-ref:${hiddenRef}-->` : '';

    return `
      ${hiddenRef ? `<!--ira-ref:${hiddenRef}-->` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:13px 0 0">
        <tr><td style="padding:10px 12px;border:1px solid ${LINE};border-radius:4px;background:${GROUND}">
          <div style="font-size:12px;line-height:1.55;color:${MUTED};margin:0 0 7px">Nothing to add? One tap:</div>
          ${buttons.map((d) => {
              const spec = DISPOSITION_SPECS[d];
              const strong = spec.closes;
              return `<a href="${esc((links?.[d]) as string)}" style="display:inline-block;padding:7px 12px;margin:0 6px 6px 0;border:1px solid ${strong ? EDGE : LINE};border-radius:4px;font-size:12px;font-weight:600;color:${strong ? BRAND : BODY};background:${strong ? CARD : TINT};text-decoration:none">${esc(spec.label)}</a>`;
          }).join('')}
          <div style="font-size:11px;color:${MUTED};margin-top:2px">These links work once and are yours &mdash; please do not forward them.</div>
        </td></tr>
      </table>`;
}

/**
 * THE ONE INVITATION TO WRITE BACK, printed once at the foot of the mail.
 *
 * This is the whole point of the email: a person telling us, in their own
 * words, what they did. So it gets room, plain language, and no instruction to
 * quote a code at anybody.
 */
function replyFooter(replyTo: string | null, multi: boolean): string {
    if (!replyTo) return '';
    return `
      <tr><td style="padding:4px 0 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border:1px solid ${EDGE};border-radius:5px;background:${CARD};padding:16px 17px">
            <div style="font-size:15px;font-weight:800;color:${BRAND};line-height:1.4">
              &#8629;&nbsp; Just hit Reply and tell us what you did.
            </div>
            <div style="font-size:13.5px;color:${BODY};line-height:1.7;margin-top:8px">
              Write it however you like &mdash; &ldquo;cancelled the second one&rdquo;,
              &ldquo;this is correct, two different floors&rdquo;, &ldquo;waiting on the vendor since Tuesday&rdquo;.
              One sentence is enough, and it is kept exactly as you wrote it.
            </div>
            <div style="font-size:13.5px;color:${BODY};line-height:1.7;margin-top:8px">
              Attach anything that helps &mdash; a credit note, a corrected order, a photo.
              ${multi ? 'Answering about one order in particular? Just mention its number and we will file it against that one.' : ''}
            </div>
            <div style="font-size:12px;color:${MUTED};line-height:1.6;margin-top:10px;padding-top:9px;border-top:1px solid ${LINE}">
              Your reply goes to <b style="color:${BODY}">${esc(replyTo)}</b>.
              If something here is wrong or not worth chasing, say so &mdash; that is how these checks get better.
            </div>
          </td></tr>
        </table>
      </td></tr>`;
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

function findingBlock(f: RoutedFinding, orgId: string, index: number, canDisposition: boolean, fb?: FeedbackLinks[string], status?: DispositionStatus, replyTo?: string, replySubject?: string, multi = false, vetting: VettingStamp | null = null): string {
    const tone = TONE[f.priority];
    const lineConcerns = (vetting?.concerns ?? []).filter((c) => c.finding_key === f.key).map((c) => ({ ...c, reviewer: vetting!.reviewer }));
    /**
     * The identifier a HUMAN uses: the purchase-order number. Printing our
     * internal hash here asked the reader to carry our bookkeeping for us —
     * and it is not even the thing they would naturally type. A reply saying
     * "PO-26/27-0609 cancelled" is matched on that number instead.
     */
    const linkable = f.refs.filter((r) => (r.url ?? entityUrl(r, orgId)) !== null);
    // Only print the plain identifier line when the numbers are NOT already
    // shown as links below — otherwise every order number appears twice.
    const idLine = linkable.length ? null
        : (f.refs.map((r) => r.label).filter(Boolean).slice(0, 3).join(' · ') || null);
    const context = [f.vendor, f.property].filter(Boolean).map((x) => esc(String(x))).join(' &middot; ');

    const stats = f.stats?.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:11px 0 0"><tr>${f.stats
              .map((st) => `<td style="padding:0 20px 0 0"><div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${MUTED};font-weight:600">${esc(st.label)}</div><div style="font-size:15px;font-weight:700;color:${BRAND};margin-top:2px">${esc(st.value)}</div></td>`)
              .join('')}</tr></table>`
        : '';

    // Only worth a chip row if the chips actually go somewhere. Otherwise the
    // numbers are already on the identifier line under the title and repeating
    // them is noise.
    const refs = linkable.length
        ? `<div style="margin:12px 0 0">
             <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:600;margin-bottom:5px">Open the order in Zoho Books to comment</div>
             ${linkable.map((r) => refChip(r, orgId)).join('')}
           </div>`
        : '';

    const actions = f.actions
        .map((a) => `<tr><td style="padding:11px 13px;background:${TINT};border:1px solid ${LINE};border-radius:4px">
                   <div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${tone.fg};font-weight:700">Your action${a.deadline ? ` &middot; ${esc(a.deadline)}` : ''}</div>
                   <div style="font-size:14px;line-height:1.55;color:${BRAND};margin-top:4px">${esc(a.action)}</div>
                 </td></tr>`)
        .join('<tr><td style="height:6px"></td></tr>');

    /**
     * THE EVIDENCE, WITH THE FACTS ON IT.
     *
     * A bare list of order numbers asked the reader to open each one to learn
     * what it said — which is the work we are supposed to have already done.
     * Each row now carries the date, the amount, the status and whether it has
     * been billed, so the claim can be checked without leaving the mail.
     */
    const evidence = f.evidence?.length
        ? `<div style="margin:13px 0 0">
             <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:600;margin-bottom:6px">The records</div>
             <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
               ${f.evidence.map((e) => `
               <tr>
                 <td style="padding:6px 10px 6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;font-weight:700;color:${BRAND};white-space:nowrap;vertical-align:top">${esc(e.ref.label)}</td>
                 <td style="padding:6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;line-height:1.5;color:${BODY}">${esc(e.facts)}</td>
               </tr>`).join('')}
             </table>
           </div>`
        : '';

    /** What does not add up, as a comparison the reader can verify. */
    const reconcile = f.reconcile?.length
        ? `<div style="margin:13px 0 0">
             <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:600;margin-bottom:6px">What does not reconcile</div>
             <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
               ${f.reconcile.map((d) => `
               <tr>
                 <td style="padding:6px 10px 6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;color:${BODY};vertical-align:top">${esc(d.what)}</td>
                 <td style="padding:6px 10px 6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;color:${MUTED};white-space:nowrap;vertical-align:top">expected ${esc(d.expected)}</td>
                 <td style="padding:6px 10px 6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;font-weight:700;color:${BRAND};white-space:nowrap;vertical-align:top">actual ${esc(d.actual)}</td>
                 ${d.gap ? `<td style="padding:6px 0;border-bottom:1px solid ${LINE};font-size:12.5px;font-weight:700;color:${tone.fg};white-space:nowrap;vertical-align:top">${esc(d.gap)}</td>` : '<td style="border-bottom:1px solid ' + LINE + '"></td>'}
               </tr>`).join('')}
             </table>
           </div>`
        : '';

    /**
     * THE INNOCENT EXPLANATION, printed by us.
     *
     * Naming the way we could be wrong is what makes the rest credible, and it
     * tells the reader exactly which document would close the line.
     */
    const counter = f.counter
        ? `<div style="margin:13px 0 0;padding:10px 12px;border-left:3px solid ${EDGE};background:${TINT}">
             <div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${MUTED};font-weight:700">If we are wrong</div>
             <div style="font-size:12.5px;line-height:1.6;color:${BODY};margin-top:4px">${esc(f.counter)}</div>
           </div>`
        : '';

    /** The single decision wanted. Not "please check". */
    const ask = f.ask
        ? `<div style="margin:13px 0 0;padding:11px 13px;border:1px solid ${tone.dot};border-radius:4px">
             <div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${tone.fg};font-weight:700">Correction wanted</div>
             <div style="font-size:14px;line-height:1.55;color:${BRAND};margin-top:4px;font-weight:600">${esc(f.ask)}</div>
           </div>`
        : '';

    /** How long this has been open without an answer. */
    const age = f.ageDays && f.ageDays > 0
        ? `<span style="font-size:11px;color:${MUTED};margin-left:8px">&middot; open ${f.ageDays} day${f.ageDays === 1 ? '' : 's'}</span>`
        : '';

    return `
    <tr><td style="padding:0 0 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EDGE};border-radius:5px;background:${CARD};overflow:hidden">
        <tr><td style="padding:12px 16px;background:${TINT};border-bottom:1px solid ${LINE}">
          <div style="display:block;margin-bottom:5px">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${tone.dot};vertical-align:middle"></span>
            <span style="font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:${tone.fg};font-weight:700;vertical-align:middle;margin-left:6px">${index}. ${esc(tone.label)}</span>
            ${age}
          </div>
          <div style="font-size:16px;font-weight:700;color:${BRAND};letter-spacing:-0.01em;line-height:1.35">${esc(f.title)}${f.amount !== null ? ` &mdash; ${inr(f.amount)}` : ''}</div>
          ${lineConcerns.length ? `<div style="margin-top:7px;padding:7px 10px;border-left:3px solid #B07206;background:${TINT};font-size:12px;line-height:1.5;color:${BODY}"><b style="color:${BRAND}">${esc(lineConcerns[0].reviewer)} flags:</b> ${lineConcerns.map((c) => esc(c.concern)).join(' ')}</div>` : ''}
          ${idLine ? `<div style="margin-top:5px;font-size:12px;color:${MUTED}">${esc(idLine)}</div>` : ''}
          ${context ? `<div style="font-size:12px;color:${MUTED};margin-top:3px">${context}</div>` : ''}
        </td></tr>
        <tr><td style="padding:14px 16px">
          <div style="font-size:13px;line-height:1.6;color:${BODY};white-space:pre-line">${esc(f.problem)}</div>
          ${stats}
          ${evidence}
          ${reconcile}
          ${counter}
          ${ask}
          ${refs}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0">${actions}</table>
          ${canDisposition ? closeStrip(fb, replyTo, replySubject, multi) : statusStrip(status)}
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

/**
 * The reviewer's stamp. A reader should know a second pair of eyes looked, and
 * what they flagged, without opening the console. Concerns about a specific
 * line are also printed under that line.
 */
export interface VettingStamp {
    reviewer: string;
    verdict: 'sound' | 'sound_with_concerns' | 'needs_human';
    concerns: Array<{ finding_key: string | null; concern: string }>;
}

/**
 * WHERE NOT TO LOOK — the section that makes the rest believable.
 *
 * Three states, and the third is the one that matters:
 *   clear    — asked, and nothing came back. "107 reference groups, 6 survivors."
 *   skipped  — NOT asked, and why. A check that could not see its data must
 *              never be read as a clean bill of health.
 *   failed   — broke. Said out loud rather than swallowed.
 */
function coverageBlock(coverage: ScanCoverage | null): string {
    if (!coverage?.checks.length) return '';
    const row = (label: string, text: string, dot: string) => `
        <tr>
          <td style="padding:6px 9px 6px 0;vertical-align:top"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot}"></span></td>
          <td style="padding:6px 10px 6px 0;font-size:12px;font-weight:700;color:${BRAND};white-space:nowrap;vertical-align:top">${esc(label)}</td>
          <td style="padding:6px 0;font-size:12px;line-height:1.55;color:${BODY}">${esc(text)}</td>
        </tr>`;

    const rows = coverage.checks.map((c) => {
        if (c.outcome === 'found') return row(c.id, `${c.found} raised above${c.cleared?.note ? ` — ${c.cleared.note}` : ''}`, '#B4543A');
        if (c.outcome === 'clear') return row(c.id, c.cleared?.note ?? `looked at ${c.cleared?.looked ?? 0} ${c.cleared?.unit ?? 'records'}, nothing to raise`, '#0B6E5F');
        if (c.outcome === 'skipped') return row(c.id, `not run — ${c.why ?? 'no reason given'}`, '#797E86');
        return row(c.id, `FAILED — ${c.why ?? 'unknown error'}`, '#B07206');
    }).join('');

    return `
      <tr><td style="padding:0 0 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EDGE};border-radius:5px;background:${CARD}">
          <tr><td style="padding:14px 16px">
            <div style="font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:${MUTED};font-weight:700">What else was checked</div>
            <div style="font-size:12px;color:${BODY};line-height:1.6;margin:5px 0 9px">
              ${coverage.ran} question${coverage.ran === 1 ? '' : 's'} asked of the data${coverage.skipped ? `, ${coverage.skipped} not asked` : ''}${coverage.failed ? `, ${coverage.failed} failed` : ''}.
              A line marked <b style="color:${BRAND}">not run</b> is not a clean bill of health.
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          </td></tr>
        </table>
      </td></tr>`;
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
    /** Who vetted this run and what they concluded. Null = nobody did. */
    vetting: VettingStamp | null = null,
    /**
     * WHAT THE SCAN COVERED — every question asked, and what came back.
     *
     * Without this the mail can only say what it FOUND, and a quiet scan is
     * indistinguishable from a broken one. Null renders nothing, so a caller
     * that does not have it is unchanged.
     */
    coverage: ScanCoverage | null = null,
): RenderedEmail {
    const { counts, recipient, findings } = bundle;

    const date = when.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const open = counts.total - counts.closed;
    // Three site mails land in the SAME mailbox. Without the site in the subject
    // they are three identical lines in a list and the owner opens the wrong one.
    /**
     * THE SUBJECT SAYS THE NEWS.
     *
     * It used to read `[IRA-9AD0D96D] 07 SEPT 2026 PO SCAN — UNASSIGNED — 1
     * item needs your attention`. Every word of that is written for the
     * machine: an internal hash, a shouted date, our word for "we could not
     * work out the site", and a count that says nothing about what happened.
     *
     * A subject line is the one sentence everybody reads. So it now carries the
     * finding itself — the vendor, what is wrong, the money — the way a
     * colleague would put it. Matching a reply is OUR problem and is solved on
     * the PO number instead (see reply.ts), which is what people type anyway.
     */
    const dayLabel = when.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    });
    const where = siteTag ? ` · ${siteTag.label}` : '';
    const top = findings.find((f) => f.priority !== 'closed') ?? findings[0];
    const topMoney = top?.amount ? ` · ${inr(top.amount)}` : '';
    const others = open - 1;

    const subject = open === 0
        ? `PO scan · ${dayLabel}${where} — everything answered, nothing new`
        : open === 1 && top
            ? `PO scan · ${dayLabel}${where} — ${top.title}${topMoney}`
            : `PO scan · ${dayLabel}${where} — ${top ? `${top.title}${others > 0 ? `, and ${others} more` : ''}` : `${open} to check`}${counts.exposure ? ` · ${inrShort(counts.exposure)}` : ''}`;

    /**
     * WHAT THE HEADLINE FIGURE ACTUALLY IS.
     *
     * This line read "None of it is billed yet, so it can still be stopped" —
     * hardcoded, on every mail ever sent. On the 7 Sept scan all six findings
     * were on orders Zoho has already billed, so the first sentence a reader saw
     * contradicted every item under it. A summary that asserts the opposite of
     * its own contents is worse than no summary.
     *
     * It is now read off the findings.
     */
    const billedCount = findings.filter((f) => f.exposure === 'billed' || f.exposure === 'paid').length;
    const monetary = findings.filter((f) => (f.amount ?? 0) > 0).length;
    const money =
        billedCount === 0
            ? 'is committed and none of it is billed yet, so it can still be stopped'
            : billedCount === monetary
                ? 'is on orders that have already been billed — past the point where cancelling fixes it, so what is left is a credit or debit note'
                : `is committed, and ${billedCount} of these ${billedCount === 1 ? 'is' : 'are'} already billed — that part comes back only as a credit or debit note`;

    // FIRST SCREEN: health, count, critical, exposure. Nothing above this.
    const summary = `
      <tr><td style="padding:0 0 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EDGE};border-radius:5px;background:${CARD};overflow:hidden">
          <tr><td style="padding:18px 16px">
            <div style="font-size:24px;font-weight:800;color:${BRAND};letter-spacing:-0.02em;line-height:1.25">${
                open === 0 ? 'Nothing new today.'
                : open === 1 ? 'One thing needs a look.'
                : `${open} things need a look.`
            }</div>
            <div style="font-size:14px;line-height:1.65;color:${BODY};margin-top:7px">
              ${counts.exposure ? `<b style="color:${BRAND}">${inr(counts.exposure)}</b> ${money}. ` : ''}
              ${counts.critical > 0 ? `${counts.critical === 1 ? 'One is' : `${counts.critical} are`} urgent. ` : ''}
              ${counts.closed ? `${counts.closed} ${counts.closed === 1 ? 'item was' : 'items were'} already answered and ${counts.closed === 1 ? 'is' : 'are'} shown below for the record. ` : ''}
            </div>
            <div style="font-size:13.5px;line-height:1.6;color:${BODY};margin-top:8px">
              ${recipient.canDisposition
                  ? 'Reply to this email and tell us what you did. A sentence is enough.'
                  : 'Where procurement has answered, their words are shown under the item.'}
            </div>
          </td></tr>
        </table>
      </td></tr>`;

    // The old "no application URL is configured on this deployment" notice was
    // an engineering apology printed inside a procurement email. A reference
    // that cannot be linked is simply shown as text; that needs no explanation.
    const linkNotice = '';

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${GROUND};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:100%">
        <tr><td style="padding:0 0 16px">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:600">Purchase order scan</div>
          <div style="font-size:17px;font-weight:800;color:${BRAND};letter-spacing:-0.01em;line-height:1.3;margin-top:2px">
            ${esc(when.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }))}${siteTag ? ` &middot; ${esc(siteTag.label)}` : ''}
          </div>
          <div style="font-size:12.5px;color:${BODY};margin-top:3px">
            ${siteTag && siteTag.owners.length
                ? `For <b style="color:${BRAND};font-weight:700">${esc(siteTag.owners.join(' and '))}</b> &middot; run at ${esc(time)}`
                : `Run at ${esc(time)}`}
          </div>
          ${vetting ? vettingLine(vetting) : ''}
        </td></tr>
        ${summary}
        ${linkNotice}
        ${findings.map((f, i) => findingBlock(f, orgId, i + 1, recipient.canDisposition, feedbackLinks[f.key], statuses[f.key], replyTo ?? undefined, replySubjects[f.key], findings.length > 1, vetting)).join('')}
        ${coverageBlock(coverage)}
        ${recipient.canDisposition ? replyFooter(replyTo, findings.length > 1) : ''}
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
