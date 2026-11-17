/**
 * Boolean keyword search, typed the way job portals take it (owner 2026-11-15):
 *
 *   facility AND (MEP OR HVAC) NOT fresher
 *   "technical executive" AND bms
 *   MEP / HVAC / VRF
 *
 * What is typed becomes the chips the keyword bar already has, so HR sees what was understood and can change it:
 *   - every part joined by AND is a starred chip (compulsory)
 *   - OR inside brackets, or a plain "a OR b OR c", or "a / b / c", is ONE chip with alternatives (any one of them)
 *   - NOT x, or NOT (x OR y), is an exclude
 *   - "..." keeps several words together as one keyword
 * AND, OR and NOT count as operators only in capitals, so "Design and Build" stays one keyword. Pure, no I/O; shared
 * by the keyword bar and the server.
 */
import type { KeywordToken } from "./filters";

export interface BooleanQuery {
  keywords: KeywordToken[];
  excludes: string[];
}

export type BooleanParse = { ok: true; query: BooleanQuery } | { ok: false; reason: string };

/** True when the text uses the boolean operators or "/" between alternatives, so it should be parsed rather than added as typed. */
export function looksBoolean(text: string): boolean {
  return /(^|\s)(AND|OR|NOT)(\s|\()|[()]|"|\s\/\s|\/(?=\S)/.test(text);
}

type Tok = { kind: "word"; text: string } | { kind: "op"; op: "AND" | "OR" | "NOT" | "(" | ")" };

function tokenize(text: string): Tok[] | string {
  const out: Tok[] = [];
  const s = text.replace(/\s+/g, " ").trim();
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (c === "(" || c === ")") { out.push({ kind: "op", op: c }); i++; continue; }
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) return "A quote was opened but not closed.";
      const phrase = s.slice(i + 1, end).trim();
      if (phrase) out.push({ kind: "word", text: phrase });
      i = end + 1;
      continue;
    }
    // "/" between words: alternatives. Taken as an operator with OR's meaning.
    if (c === "/") { out.push({ kind: "op", op: "OR" }); i++; continue; }
    let j = i;
    while (j < s.length && s[j] !== " " && s[j] !== "(" && s[j] !== ")" && s[j] !== '"' && s[j] !== "/") j++;
    const word = s.slice(i, j);
    if (word === "AND" || word === "OR" || word === "NOT") out.push({ kind: "op", op: word });
    else out.push({ kind: "word", text: word });
    i = j;
  }
  // Plain words next to each other are one keyword ("technical executive AND bms" = "technical executive" AND bms).
  const merged: Tok[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (t.kind === "word" && last?.kind === "word") last.text = `${last.text} ${t.text}`;
    else merged.push(t.kind === "word" ? { ...t } : t);
  }
  return merged;
}

/** An atom: a word, or a bracketed list of words joined by OR. Returns the alternatives it names. */
function atom(toks: Tok[], at: { i: number }): string[] | string {
  const t = toks[at.i];
  if (!t) return "Something is missing at the end.";
  if (t.kind === "word") { at.i++; return [t.text]; }
  if (t.op === "(") {
    at.i++;
    const first = toks[at.i];
    if (first?.kind === "op" && first.op === ")") return "The brackets are empty.";
    const alts: string[] = [];
    for (;;) {
      const inner = atom(toks, at);
      if (typeof inner === "string") return inner;
      alts.push(...inner);
      const next = toks[at.i];
      if (!next) return "A bracket was opened but not closed.";
      if (next.kind === "op" && next.op === ")") { at.i++; break; }
      if (next.kind === "op" && next.op === "OR") { at.i++; continue; }
      if (next.kind === "op" && next.op === "AND") return "Inside brackets only OR is allowed, like (MEP OR HVAC).";
      return "Inside brackets, put OR between the words.";
    }
    if (!alts.length) return "The brackets are empty.";
    return alts;
  }
  return `Unexpected ${t.op}.`;
}

/**
 * What the text asks for, as chips and excludes; `ok: false` with a plain reason when it cannot be read. Call only
 * when looksBoolean() is true: a plain keyword is added as typed, not parsed.
 */
export function parseBooleanQuery(text: string): BooleanParse {
  const toks = tokenize(text);
  if (typeof toks === "string") return { ok: false, reason: toks };
  if (!toks.length) return { ok: false, reason: "Nothing to search for." };

  // Top level: items joined by AND, each item an atom, "NOT atom", or a run of atoms joined by OR (one chip).
  const keywords: KeywordToken[] = [];
  const excludes: string[] = [];
  const at = { i: 0 };
  let group: string[] = [];
  const closeGroup = () => {
    if (!group.length) return;
    const [first, ...alts] = dedupe(group);
    keywords.push(alts.length ? { text: first, required: true, alts } : { text: first, required: true });
    group = [];
  };
  while (at.i < toks.length) {
    const t = toks[at.i];
    if (t.kind === "op" && t.op === "NOT") {
      at.i++;
      const terms = atom(toks, at);
      if (typeof terms === "string") return { ok: false, reason: terms };
      closeGroup();
      excludes.push(...terms);
    } else if (t.kind === "op" && t.op === "AND") {
      if (!group.length && !keywords.length && !excludes.length) return { ok: false, reason: "AND needs a keyword before it." };
      closeGroup();
      at.i++;
      if (at.i >= toks.length) return { ok: false, reason: "AND needs a keyword after it." };
    } else if (t.kind === "op" && t.op === "OR") {
      if (!group.length) return { ok: false, reason: "OR needs a keyword before it." };
      at.i++;
      const terms = atom(toks, at);
      if (typeof terms === "string") return { ok: false, reason: terms };
      group.push(...terms);
    } else {
      // A new atom right after another, with no operator: treat as AND.
      closeGroup();
      const terms = atom(toks, at);
      if (typeof terms === "string") return { ok: false, reason: terms };
      group.push(...terms);
    }
  }
  closeGroup();
  if (!keywords.length && !excludes.length) return { ok: false, reason: "Nothing to search for." };
  // A single plain chip is not starred: that keeps "a / b" and "(a OR b)" as a wide search unless HR stars it.
  // Everything joined by AND, or anything beside a NOT, is starred as typed.
  if (keywords.length === 1 && !excludes.length) keywords[0] = { ...keywords[0], required: false };
  return { ok: true, query: { keywords, excludes: dedupe(excludes) } };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((v) => v.trim()).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}
