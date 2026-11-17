/**
 * The lines of a resume around the search keywords (owner 2026-11-11, redesign): a result card shows where in the
 * resume the keywords were found, with each one marked, so HR does not have to open the file to see why it matched.
 * Pure: the same function serves the server (filter-search.ts) and the tests. No AI.
 */

/** One run of text; `hit` marks a keyword. */
export interface SnippetPart {
  text: string;
  hit?: true;
}

/** Characters of resume shown on a card. */
export const SNIPPET_CHARS = 190;
/** Text kept before the first keyword, so the line reads from its start. */
const LEAD_CHARS = 45;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The stretch of `text` that holds the most different keywords (the earliest one on a tie), cut at word edges, as
 * plain and marked parts. Null when the text holds none of them: the card then shows the resume's summary instead.
 */
export function resumeSnippet(text: string | null | undefined, keywords: string[], max: number = SNIPPET_CHARS): SnippetPart[] | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const terms = [...new Set(keywords.map((k) => k.replace(/\s+/g, " ").trim().toLowerCase()).filter((k) => k.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);
  if (!flat || !terms.length) return null;

  // A keyword counts where it starts a word ("BMS" in "BMS," but not the "bms" inside another word).
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegex).join("|")})`, "giu");
  const hits: { start: number; end: number; term: string }[] = [];
  for (let m = pattern.exec(flat); m && hits.length < 300; m = pattern.exec(flat)) {
    hits.push({ start: m.index, end: m.index + m[0].length, term: m[0].toLowerCase() });
  }
  if (!hits.length) return null;

  const windowOf = (anchor: number) => {
    let start = Math.max(0, anchor - LEAD_CHARS);
    if (start > 0) {
      const space = flat.indexOf(" ", start);
      if (space >= 0 && space < anchor) start = space + 1;
    }
    let end = Math.min(flat.length, start + max);
    if (end < flat.length) {
      const space = flat.lastIndexOf(" ", end);
      if (space > start + max / 2) end = space;
    }
    return { start, end };
  };

  let best = { ...windowOf(hits[0].start), different: 0 };
  for (const hit of hits) {
    const w = windowOf(hit.start);
    const different = new Set(hits.filter((h) => h.start >= w.start && h.end <= w.end).map((h) => h.term)).size;
    if (different > best.different) best = { ...w, different };
  }

  const parts: SnippetPart[] = [];
  const push = (value: string, hit = false) => {
    if (!value) return;
    parts.push(hit ? { text: value, hit: true } : { text: value });
  };
  let at = best.start;
  if (best.start > 0) push("… ");
  for (const hit of hits) {
    if (hit.start < at || hit.end > best.end) continue;
    push(flat.slice(at, hit.start));
    push(flat.slice(hit.start, hit.end), true);
    at = hit.end;
  }
  push(flat.slice(at, best.end));
  if (best.end < flat.length) push(" …");
  return parts;
}

/**
 * The whole text with the keywords marked, line breaks kept: the resume as the candidate's panel shows it. A text
 * with none of the keywords comes back as one plain part.
 */
export function markKeywords(text: string, keywords: string[]): SnippetPart[] {
  const terms = [...new Set(keywords.map((k) => k.replace(/\s+/g, " ").trim().toLowerCase()).filter((k) => k.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);
  if (!text || !terms.length) return text ? [{ text }] : [];
  // A keyword of several words may be split over a line break in the file: any white space stands for its spaces.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map((t) => escapeRegex(t).replace(/ /g, "\\s+")).join("|")})`, "giu");
  const parts: SnippetPart[] = [];
  let at = 0;
  for (let m = pattern.exec(text); m && parts.length < 4000; m = pattern.exec(text)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
