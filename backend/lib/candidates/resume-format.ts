/**
 * A resume's text laid out for reading (owner 2026-11-11): section headings found and set apart, lines that the file
 * broke mid-sentence joined again, bullets kept as bullets, skill lists turned into labels, job lines with dates set
 * in bold. Pure and deterministic (no AI), so it is instant and the same every time; the client runs it on the text
 * the reader already stored.
 *
 * What it cannot do: put a file's sections back in order. A PDF made from a design template (two columns, a side
 * bar) often comes out of the reader with its lines out of order, and no rule can know the order the eye would read
 * them in. For those files the structured profile above the text (built from what the details reader found) is the
 * reliable part, and "Open original" shows the file itself.
 */

export type ResumeBlock =
  | { kind: "heading"; text: string }
  /** A job or a degree line: it carries dates, or the file set it in capitals. */
  | { kind: "role"; text: string }
  | { kind: "paragraph"; text: string }
  /** Short lines that belong together but are not a sentence (an address, a list without bullets). */
  | { kind: "lines"; items: string[] }
  | { kind: "bullets"; items: string[] }
  /** A skills / languages / tools list. */
  | { kind: "tags"; items: string[] };

/** Lines read from one file; past this a file is not a resume and the rest is left out. */
const MAX_LINES = 1500;

const BULLET_ONLY = /^[•●○◦▪■‣⁃➢➤✓✔►▶*·\-–—|_.]+$/;
const BULLET = /^(?:[•●○◦▪■‣⁃➢➤✓✔►▶]\s*|[*\-–—]\s+|o\s+(?=[A-Z])|\(?\d{1,2}[.)]\s+(?=\D))(.+)$/;
const TERMINAL = /[.!?:;]$/;
const JOINER_END = /(?:[,&/(\-–]|\b(?:and|of|the|in|to|for|with|a|an|on|at|by|or|as|from))$/i;

/** What a section heading ends with ("Work experience", "Certifications & awards", "Tools known"). */
const SECTION_CORE =
  "summary|profile|objectives?|experiences?|history|education|qualifications?|skills?|competenc(?:y|ies)|expertise|languages?(?: known)?|projects?|" +
  "certifications?|certificates?|courses?|achievements?|accomplishments?|awards?|honou?rs?|details|information|info|declaration|interests?|hobbies|" +
  "references?|internships?|trainings?|strengths?|contact|tools(?: known)?|software|activities|publications?|responsibilit(?:y|ies)|volunteering|highlights?|" +
  "extra[- ]?curriculars?";
/** The words a heading may start with before its core word. Anything else in front ("Communication skills") is a list item, not a heading. */
const SECTION_LEAD =
  "professional|career|work|working|employment|job|academic|academics|educational|education|technical|key|core|soft|hard|personal|additional|other|" +
  "relevant|areas? of|positions? of|extra[- ]?curricular|co[- ]?curricular|it|computer|major|notable|my|brief|executive|industrial|summer|live|academic and|" +
  "profile|contact";
/** Headings a design template printed letter by letter come out as one word once the letters are joined. */
const GLUED_HEADINGS: Record<string, string> = {
  aboutme: "About me", workexperience: "Work experience", professionalexperience: "Professional experience", professionalsummary: "Professional summary",
  careerobjective: "Career objective", personaldetails: "Personal details", technicalskills: "Technical skills", keyskills: "Key skills", coreskills: "Core skills",
  softskills: "Soft skills", workhistory: "Work history", employmenthistory: "Employment history", profilesummary: "Profile summary", contactinfo: "Contact info",
};
const HEADING = new RegExp(`^(?:about me|(?:(?:${SECTION_LEAD})\\s+)*(?:${SECTION_CORE})(?:\\s*(?:&|and|/)\\s*(?:${SECTION_CORE}))?)$`, "i");
const TAG_SECTION = /skills?|competenc|expertise|languages?|interests?|hobbies|strengths?|tools|software/i;

/** "Jun 2021 – Present", "2018 - 2021", "04/2019 to 03/2020". */
const DATE_RANGE = /(?:19|20)\d{2}\s*(?:[-–—]|to|till|until)\s*(?:(?:[A-Za-z]{3,9}\.?|\d{1,2}[/.-])\s*)?(?:(?:19|20)\d{2}|present|current|till date|date|now|ongoing)/i;
const KEEP_UPPER = new Set(["IT", "UI", "UX", "HR", "QA", "AI", "ML", "CV", "BMS", "HVAC", "MEP"]);

/** Design templates print headings letter by letter ("E D U C A T I O N"): join them. */
const joinSpacedLetters = (line: string) => line.replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (run) => run.replace(/ /g, ""));

const clean = (line: string) => joinSpacedLetters(line.replace(/[\t ]+/g, " ").replace(/ {2,}/g, " ").trim());
const words = (line: string) => line.split(/\s+/).filter(Boolean).length;
const isUpper = (line: string) => /[A-Z]/.test(line) && line === line.toUpperCase();

/** The heading as it is shown: one style for every resume ("WORK EXPERIENCE" and "Work Experience:" both become "Work experience"). */
function headingText(line: string): string {
  const bare = line.replace(/[:\-–—\s]+$/, "").trim();
  const glued = GLUED_HEADINGS[bare.toLowerCase()];
  if (glued) return glued;
  return bare
    .split(/\s+/)
    .map((word, i) => {
      if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase();
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function isHeading(line: string): boolean {
  if (line.length > 48 || /\d/.test(line) || words(line) > 5) return false;
  const bare = line.replace(/[:\-–—\s]+$/, "").trim();
  if (!bare || /[.,;!?]$/.test(bare)) return false;
  return HEADING.test(bare) || bare.toLowerCase() in GLUED_HEADINGS;
}

/** A job or degree line: dates in it, or a short line the file set in capitals that is not a known heading. */
function isRole(line: string): boolean {
  if (line.length <= 140 && DATE_RANGE.test(line)) return true;
  return isUpper(line) && line.length >= 4 && line.length <= 48 && words(line) <= 5 && !/[.,;!?@]/.test(line) && !/\d{3,}/.test(line);
}

/** Split a list line on commas and bars, but not inside brackets: "Python (NumPy, Pandas), SQL" is two items. */
function splitList(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of line) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "|" || ch === ";" || ch === "•" || ch === "·")) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((item) => item.trim()).filter(Boolean);
}

/** A web address or an email starts in lower case without being the rest of a sentence. */
const LINK_START = /^(?:https?:|www\.|[\w.+-]+@[\w-]+\.|[\w-]+\.(?:com|in|net|org|io|co|me|dev|app)\b)/i;
/** The line starts the way the middle of a sentence does. */
const startsMidSentence = (line: string) => /^[a-z(]/.test(line) && !LINK_START.test(line);

/** Whether `line` carries on the sentence `prev` left open (the file broke the line; the sentence did not end). */
function continues(prev: string, line: string): boolean {
  if (TERMINAL.test(prev)) return false;
  if (LINK_START.test(line)) return false;
  if (startsMidSentence(line)) return true;
  if (JOINER_END.test(prev)) return true;
  // A full-width line of prose that stops without punctuation was wrapped by the page, whatever the next line starts with.
  return prev.length >= 60 && words(prev) >= 8;
}

export function formatResume(text: string | null | undefined): ResumeBlock[] {
  const blocks: ResumeBlock[] = [];
  let prose: string[] = [];
  let bullets: string[] = [];
  let tags: string[] = [];
  let inTags = false;

  const flushProse = () => {
    if (!prose.length) return;
    if (prose.length === 1) blocks.push({ kind: "paragraph", text: prose[0] });
    else if (prose.every((line) => line.length <= 72)) blocks.push({ kind: "lines", items: prose });
    else for (const line of prose) blocks.push({ kind: "paragraph", text: line });
    prose = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push({ kind: "bullets", items: bullets });
    bullets = [];
  };
  const flushTags = () => {
    if (tags.length) blocks.push({ kind: "tags", items: [...new Set(tags)] });
    tags = [];
  };
  const flush = () => {
    flushProse();
    flushBullets();
    flushTags();
  };

  const lines = (text ?? "").split(/\r?\n/).slice(0, MAX_LINES);
  /** An empty line was passed since the last text: it ends a paragraph unless the sentence plainly carries on. */
  let gap = false;
  for (let i = 0; i < lines.length; i += 1) {
    let line = clean(lines[i]);
    if (!line) {
      gap = true;
      continue;
    }
    if (BULLET_ONLY.test(line)) continue;
    // A heading the file broke over two lines ("HOBBIES &" / "INTERESTS").
    if (/(?:&|\band)$/i.test(line) && i + 1 < lines.length) {
      const both = `${line} ${clean(lines[i + 1])}`;
      if (isHeading(both)) {
        line = both;
        i += 1;
      }
    }
    if (gap) {
      gap = false;
      // Some files put an empty line inside a sentence ("…creatives across" / "" / "travel and education…"): only a
      // line that starts in lower case after an unfinished one is taken as the same sentence across the gap.
      const open = prose.length ? prose[prose.length - 1] : bullets.length ? bullets[bullets.length - 1] : null;
      if (!(open && !TERMINAL.test(open) && startsMidSentence(line))) flushProse();
    }

    if (isHeading(line)) {
      flush();
      const heading = headingText(line);
      blocks.push({ kind: "heading", text: heading });
      inTags = TAG_SECTION.test(heading);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const item = bullet[1].trim();
      flushProse();
      // A short bullet in a skills section is a label; a long one is a sentence about a skill.
      if (inTags && item.length <= 48 && !TERMINAL.test(item)) {
        flushBullets();
        tags.push(...splitList(item).filter((part) => part.length <= 48));
      } else {
        flushTags();
        bullets.push(item);
      }
      continue;
    }

    if (isRole(line)) {
      flush();
      blocks.push({ kind: "role", text: line });
      continue;
    }

    // A bullet that the file wrapped onto the next line.
    if (bullets.length && continues(bullets[bullets.length - 1], line)) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`;
      continue;
    }
    flushBullets();

    if (inTags) {
      const parts = splitList(line);
      const short = parts.every((part) => part.length <= 48);
      // "Languages: JavaScript, Go, SQL" is a labelled line, kept whole; a bare list becomes labels.
      const labelled = /^[^,|;:]{2,32}:\s/.test(line);
      if (!labelled && short && !/[.!?]$/.test(line) && (parts.length > 1 || line.length <= 48)) {
        flushProse();
        tags.push(...parts);
        continue;
      }
      flushTags();
    }

    if (prose.length && continues(prose[prose.length - 1], line)) prose[prose.length - 1] = `${prose[prose.length - 1]} ${line}`;
    else prose.push(line);
  }
  flush();

  // Short one-line paragraphs in a row (a name, a title, a city; a list the file printed without bullets) read better
  // as one tight group than as separate paragraphs.
  const merged: ResumeBlock[] = [];
  const isShortLine = (block: ResumeBlock): block is { kind: "paragraph"; text: string } => block.kind === "paragraph" && block.text.length <= 72 && !/[.!?]$/.test(block.text);
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (isShortLine(block) && last?.kind === "lines" && last.items.every((item) => item.length <= 72)) last.items.push(block.text);
    else if (isShortLine(block) && last && isShortLine(last)) merged[merged.length - 1] = { kind: "lines", items: [last.text, block.text] };
    else merged.push(block);
  }
  return merged;
}

/** "2021-06" -> "Jun 2021", "2021" -> "2021"; anything else as it is. For the dates of the employers a resume lists. */
export function formatMonth(value: string | null | undefined): string | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec((value ?? "").trim());
  if (!m) return value?.trim() || null;
  if (!m[2]) return m[1];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : m[1];
}
