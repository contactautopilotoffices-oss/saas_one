import type { User } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";

import {
  createVersion,
  DOCUMENTS_BUCKET,
  DocumentError,
  extractText,
  getSupabaseAdmin,
  isSupportedFile,
  MAX_UPLOAD_BYTES,
  processVersion,
  SUPPORTED_EXTENSIONS,
  UPLOAD_RATE_LIMIT,
} from "@/backend/lib/hr-assistant";

import { rateLimited } from "./admin-auth";

/**
 * Handle a policy upload (multipart field "file"): validate, read and store it,
 * record it as the next version ('processing'), reply 202, then index it in the
 * background. With policyId it's a new version of that policy; without, the
 * policy is matched by file name (or created).
 */
export async function handlePolicyUpload(
  request: Request,
  user: User,
  policyId: string | null,
): Promise<NextResponse> {
  const limited = rateLimited("upload", user.id, UPLOAD_RATE_LIMIT);
  if (limited) return limited;

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a non-empty file to upload" }, { status: 400 });
  }
  if (!isSupportedFile(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type. Use ${SUPPORTED_EXTENSIONS.join(", ")}.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());

  let text: string;
  try {
    text = await extractText(data, file.name);
  } catch (error) {
    if (error instanceof DocumentError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const admin = getSupabaseAdmin();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const storagePath = `${crypto.randomUUID()}/${safeName}`;
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, data, { contentType: file.type || undefined });
  if (uploadError) {
    console.error("[hr-assistant] failed to store upload", uploadError);
    return NextResponse.json({ error: "Couldn't store the file" }, { status: 500 });
  }

  let version;
  try {
    version = await createVersion(admin, {
      name: file.name,
      policyId,
      storagePath,
      mimeType: file.type || null,
      sizeBytes: file.size,
      uploadedBy: user.id,
      uploadedByEmail: user.email ?? null,
    });
  } catch (error) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    if ((error as { code?: string })?.code === "P0002") {
      return NextResponse.json({ error: "That policy no longer exists." }, { status: 404 });
    }
    console.error("[hr-assistant] failed to record upload", error);
    return NextResponse.json({ error: "Couldn't save the upload. Please try again." }, { status: 500 });
  }

  // Runs after the response is sent; records live/archived/failed itself.
  after(() => processVersion(admin, version, text));

  return NextResponse.json({ version }, { status: 202 });
}
