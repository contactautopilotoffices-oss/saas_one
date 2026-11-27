import { NextResponse } from "next/server";
import { uploadAssignmentBrief } from "@/backend/lib/candidates/assignment-brief-storage";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { MAX_BRIEF_BYTES } from "@/backend/lib/candidates/outreach-settings";
import { requireCandidateAccess, errorResponse, rateLimited } from "../../_lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireCandidateAccess(new URL(request.url).searchParams.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  if (Number(request.headers.get("content-length")) > MAX_BRIEF_BYTES + 65536) {
    return NextResponse.json({ error: "Choose a file of up to 4 MB." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose an assignment file." }, { status: 400 });
  try {
    return NextResponse.json({ attachment: await uploadAssignmentBrief(auth.admin, auth.orgId, file) });
  } catch (error) {
    return errorResponse(error, "Couldn't upload the assignment attachment");
  }
}
