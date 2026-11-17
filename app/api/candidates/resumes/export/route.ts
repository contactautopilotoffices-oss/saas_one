import { NextResponse } from "next/server";

import { RESUME_EXPORT_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { parseResumeQuery, resumeWorkbook } from "@/backend/lib/candidates/resumes";

import { errorResponse, rateLimited, requireCandidateAccess } from "../../_lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The resume sheet as Excel, built from the database with the same filters as the list. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const limited = rateLimited("resume-export", auth.user.id, RESUME_EXPORT_RATE_LIMIT);
  if (limited) return limited;
  try {
    // "Open" links in the sheet point back into the portal; a signed-in HR login follows them to the file.
    const origin = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
    const { workbook, count, truncated } = await resumeWorkbook(auth.admin, auth.orgId, parseResumeQuery(params), `${origin}/api/candidates/resumes`);
    const buffer = await workbook.xlsx.writeBuffer();
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="resumes-${day}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Resume-Count": String(count),
        "X-Resume-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (error) {
    return errorResponse(error, "Couldn't build the Excel");
  }
}
