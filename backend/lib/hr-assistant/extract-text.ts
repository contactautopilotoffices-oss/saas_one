/** Pull plain text out of an uploaded policy document. */
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

import { SUPPORTED_EXTENSIONS } from "./config";

/** A problem with the file itself (shown to the uploader), not a server error. */
export class DocumentError extends Error {}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

export function isSupportedFile(fileName: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(data: Uint8Array, fileName: string): Promise<string> {
  const extension = fileExtension(fileName);
  let text: string;

  switch (extension) {
    case ".txt":
    case ".md":
      text = new TextDecoder("utf-8").decode(data);
      break;
    case ".pdf":
      try {
        const pdf = await getDocumentProxy(new Uint8Array(data));
        ({ text } = await extractPdfText(pdf, { mergePages: true }));
      } catch {
        throw new DocumentError("Couldn't read this PDF. Is it corrupted or password-protected?");
      }
      break;
    case ".docx":
      try {
        ({ value: text } = await mammoth.extractRawText({ buffer: Buffer.from(data) }));
      } catch {
        throw new DocumentError("Couldn't read this Word document. Is it a valid .docx file?");
      }
      break;
    default:
      throw new DocumentError(
        `Unsupported file type "${extension || "none"}". Use ${SUPPORTED_EXTENSIONS.join(", ")}.`,
      );
  }

  const normalized = normalize(text);
  if (!normalized) {
    throw new DocumentError(
      "No text found in this file. Scanned PDFs need to be converted to text (OCR) first.",
    );
  }
  return normalized;
}
