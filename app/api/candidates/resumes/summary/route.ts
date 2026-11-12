import { after, NextResponse } from "next/server";

import { RESUME_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { inferMissingDetailsSometimes } from "@/backend/lib/candidates/resume-extract";
import { refileLongScans } from "@/backend/lib/candidates/resume-scan";
import { resumeSummary, uploaderName } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";

/** Files, size and download dates per uploader and in all, plus the name the signed-in person uploads under. Query: orgId. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resumes", auth.user.id, RESUME_RATE_LIMIT);
  if (limited) return limited;
  try {
    const [summary, uploader] = await Promise.all([
      resumeSummary(auth.admin, auth.orgId),
      uploaderName(auth.admin, { id: auth.user.id, email: auth.user.email ?? null }),
    ]);
    // After the answer, at most once in a few minutes per organisation: designation, company and total experience
    // that the reader left empty are worked out from the employers listed (the cron does the same every minute where
    // one runs; this covers a deployment without it).
    // On the same turn, scans that an earlier version marked "couldn't be read" for their length are filed as other documents.
    after(async () => {
      if (await inferMissingDetailsSometimes(auth.admin, auth.orgId)) await refileLongScans(auth.admin, auth.orgId);
    });
    return NextResponse.json({ ...summary, uploader });
  } catch (error) {
    return errorResponse(error, "Couldn't count the resumes");
  }
}
