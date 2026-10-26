/**
 * A tiny, safe Markdown subset for the assistant's answers: paragraphs, bullet and numbered
 * lists, **bold** and *italic*. It returns plain data (no HTML), so nothing in an answer can
 * ever be rendered as markup. Anything outside this subset shows as text, minus stray asterisks.
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
    | { kind: 'paragraph'; lines: Inline[][] }
    | { kind: 'bullets'; items: Inline[][] }
    | { kind: 'numbered'; items: Inline[][]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Split one line into bold / italic / plain runs. Unpaired markers are dropped. */
export function parseInline(line: string): Inline[] {
    const runs: Inline[] = [];
    // *italic* must hug its text ("5 * 2" stays as is); no lookbehind, the build targets ES2017.
    const pattern = /\*\*(.+?)\*\*|__(.+?)__|\*(?![\s*])([^*\n]*[^*\s])\*/g;
    let last = 0;
    for (const match of line.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > last) runs.push({ text: line.slice(last, index) });
        if (match[1] ?? match[2]) runs.push({ text: (match[1] ?? match[2]) as string, bold: true });
        else runs.push({ text: match[3] as string, italic: true });
        last = index + match[0].length;
    }
    if (last < line.length) runs.push({ text: line.slice(last) });
    return runs
        .map(run => (run.bold || run.italic ? run : { text: run.text.replace(/\*\*|__/g, '') }))
        .filter(run => run.text !== '');
}

export function formatAnswer(text: string): Block[] {
    const blocks: Block[] = [];
    let current: Block | null = null;
    const flush = () => {
        if (current) blocks.push(current);
        current = null;
    };

    for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (!rawLine.trim()) {
            flush();
            continue;
        }
        const bullet = BULLET.exec(rawLine);
        const numbered = NUMBERED.exec(rawLine);
        const heading = HEADING.exec(rawLine);

        if (bullet) {
            if (current?.kind !== 'bullets') {
                flush();
                current = { kind: 'bullets', items: [] };
            }
            current.items.push(parseInline(bullet[1]));
        } else if (numbered) {
            if (current?.kind !== 'numbered') {
                flush();
                current = { kind: 'numbered', items: [], start: Number(numbered[1]) };
            }
            current.items.push(parseInline(numbered[2]));
        } else {
            if (current?.kind !== 'paragraph') {
                flush();
                current = { kind: 'paragraph', lines: [] };
            }
            // A "## Heading" line reads as a bold line.
            current.lines.push(heading ? [{ text: heading[1].replace(/\*\*/g, ''), bold: true }] : parseInline(rawLine));
        }
    }
    flush();
    return blocks;
}
