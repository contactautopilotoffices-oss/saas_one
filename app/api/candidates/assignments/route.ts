import { after, NextResponse } from "next/server";

import {
  assignmentFileUrl, assignmentLinkUrl, cancelAssignment, documentFileUrl, listAssignments, listDocuments, requestDocuments, reviewDocument, sendAssignment,
} from "@/backend/lib/candidates/assignments";
import { audit } from "@/backend/lib/candidates/audit";
import { WRITE_RATE_LIMIT } from "@/backend/lib/candidates/config";
import { CandidateActionError, getRecord } from "@/backend/lib/candidates/records";

import { actorFor, errorResponse, rateLimited, readJson, requireCandidateAccess, UUID } from "../_lib/auth";

export const runtime = "nodejs";

/*
 * Assignments and documents on a candidate (owner 2026-11-24). HR only (Candidate Search access): the AI score is part
 * of the answer here; the hiring manager's view (/api/recruitment/hiring-manager) never carries it.
 */

/** Query: orgId, candidateId → { assignments, documents }. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const auth = await requireCandidateAccess(params.get("orgId"));
  if (auth.error) return auth.error;
  const candidateId = params.get("candidateId") ?? "";
  try {
    const [assignments, documents] = await Promise.all([
      listAssignments(auth.admin, auth.orgId, candidateId, { withAi: true }),
      listDocuments(auth.admin, auth.orgId, candidateId),
    ]);
    return NextResponse.json({ assignments, documents });
  } catch (error) {
    return errorResponse(error, "Couldn't load the assignments");
  }
}

/**
 * { orgId, action, ... }:
 *   send            { applicationId, positionId, title, brief, guidelines?, driveLink?, dueAt? }
 *   cancel | link | file | rescore  { id }
 *   request_documents { applicationId, positionId? }
 *   review_document   { id, status: verified|rejected, note? }
 *   document_file     { id }
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const auth = await requireCandidateAccess(body.orgId);
  if (auth.error) return auth.error;
  const limited = rateLimited("write", auth.user.id, WRITE_RATE_LIMIT);
  if (limited) return limited;
  const { admin, orgId } = auth;
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  try {
    const by = await actorFor(admin, auth.user);
    switch (body.action) {
      case "send": {
        if (typeof body.applicationId !== "string" || !UUID.test(body.applicationId) || typeof body.positionId !== "string" || !UUID.test(body.positionId)) {
          return NextResponse.json({ error: "Pick the candidate and the position." }, { status: 400 });
        }
        const record = await getRecord(admin, orgId, body.applicationId);
        const result = await sendAssignment(admin, orgId, by, {
          applicationId: record.id, candidateId: record.candidateId, positionId: body.positionId,
          title: body.title, brief: body.brief, guidelines: body.guidelines, driveLink: body.driveLink, attachment: body.attachment, dueAt: body.dueAt,
        });
        return NextResponse.json(result);
      }
      case "cancel":
        if (!id) break;
        await cancelAssignment(admin, orgId, by, id);
        return NextResponse.json({ ok: true });
      case "link":
        if (!id) break;
        return NextResponse.json({ url: await assignmentLinkUrl(admin, orgId, id) });
      case "file":
        if (!id) break;
        await audit(admin, orgId, by, { action: "assignment_view", entityType: "assignment", entityId: id });
        return NextResponse.json({ url: await assignmentFileUrl(admin, orgId, id) });
      case "rescore": {
        if (!id) break;
        const { data } = await admin.from("recruitment_assignments").update({ ai_status: "pending", ai_error: null }).eq("organization_id", orgId).eq("id", id).eq("status", "submitted").neq("ai_status", "scored").select("id");
        if (!(data ?? []).length) return NextResponse.json({ error: "Only a submitted assignment without a score can be scored again." }, { status: 409 });
        after(async () => {
          const { scoreAssignment } = await import("@/backend/lib/candidates/assignment-score");
          await scoreAssignment(admin, orgId, id);
        });
        return NextResponse.json({ ok: true });
      }
      case "request_documents": {
        if (typeof body.applicationId !== "string" || !UUID.test(body.applicationId)) return NextResponse.json({ error: "Pick the candidate." }, { status: 400 });
        const record = await getRecord(admin, orgId, body.applicationId);
        const positionId = typeof body.positionId === "string" && UUID.test(body.positionId) ? body.positionId : null;
        return NextResponse.json(await requestDocuments(admin, orgId, by, { candidateId: record.candidateId, applicationId: record.id, positionId }));
      }
      case "review_document": {
        if (!id) break;
        const review = await reviewDocument(admin, orgId, by, id, body.status, body.note, body.uploadedAt);
        if (body.status === "rejected") {
          try {
            return NextResponse.json(await requestDocuments(admin, orgId, by, { ...review, applicationId: null }));
          } catch (error) {
            return NextResponse.json({ sent: false, note: error instanceof CandidateActionError ? error.message : "The change request was saved. Share the candidate’s document link to notify them." });
          }
        }
        return NextResponse.json({ ok: true });
      }
      case "document_file":
        if (!id) break;
        await audit(admin, orgId, by, { action: "document_view", entityType: "document", entityId: id });
        return NextResponse.json({ url: await documentFileUrl(admin, orgId, id) });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ error: "Pick the item." }, { status: 400 });
  } catch (error) {
    return errorResponse(error, "Couldn't do that");
  }
}
