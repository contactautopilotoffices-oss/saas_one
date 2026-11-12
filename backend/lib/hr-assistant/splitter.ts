/**
 * Chop a document into small, overlapping, searchable chunks.
 *
 * Same algorithm as LangChain's RecursiveCharacterTextSplitter: try to split on
 * paragraphs, then lines, then words, then characters, and merge the pieces
 * back up to chunkSize with chunkOverlap characters of overlap.
 */
import { CHUNK_OVERLAP, CHUNK_SIZE } from "./config";

const SEPARATORS = ["\n\n", "\n", " ", ""];

interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export function splitIntoChunks(
  text: string,
  { chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP }: SplitOptions = {},
): string[] {
  if (chunkOverlap >= chunkSize) throw new Error("chunkOverlap must be smaller than chunkSize");

  function merge(splits: string[], separator: string): string[] {
    const chunks: string[] = [];
    const current: string[] = [];
    let total = 0;
    const sepLen = separator.length;

    for (const piece of splits) {
      const extra = piece.length + (current.length > 0 ? sepLen : 0);
      if (total + extra > chunkSize && current.length > 0) {
        const chunk = current.join(separator).trim();
        if (chunk) chunks.push(chunk);
        // Drop pieces from the front until we're within the overlap budget.
        while (
          total > chunkOverlap ||
          (total > 0 && total + piece.length + (current.length > 0 ? sepLen : 0) > chunkSize)
        ) {
          total -= current[0].length + (current.length > 1 ? sepLen : 0);
          current.shift();
        }
      }
      current.push(piece);
      total += piece.length + (current.length > 1 ? sepLen : 0);
    }
    const last = current.join(separator).trim();
    if (last) chunks.push(last);
    return chunks;
  }

  function split(input: string, separators: string[]): string[] {
    let separator = separators[separators.length - 1];
    let remaining: string[] = [];
    for (let i = 0; i < separators.length; i++) {
      const candidate = separators[i];
      if (candidate === "") {
        separator = candidate;
        break;
      }
      if (input.includes(candidate)) {
        separator = candidate;
        remaining = separators.slice(i + 1);
        break;
      }
    }

    const pieces = input.split(separator).filter((piece) => piece !== "");
    const result: string[] = [];
    let small: string[] = [];
    for (const piece of pieces) {
      if (piece.length < chunkSize) {
        small.push(piece);
        continue;
      }
      if (small.length) {
        result.push(...merge(small, separator));
        small = [];
      }
      if (remaining.length) result.push(...split(piece, remaining));
      else result.push(piece);
    }
    if (small.length) result.push(...merge(small, separator));
    return result;
  }

  return split(text.replace(/\r\n/g, "\n"), SEPARATORS);
}
