import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getHrAccess } from "@/backend/lib/hr-assistant";
import { HrDocumentManager } from "@/frontend/components/hr-assistant/HrDocumentManager";
import { createClient } from "@/frontend/utils/supabase/server";

export const metadata: Metadata = {
  title: "HR Policy Documents",
};

/** Upload, version and restore the policies the HR assistant answers from. HR admins only. */
export default async function HrDocumentsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { isAdmin } = await getHrAccess(user.id);
  if (!isAdmin) notFound();

  return <HrDocumentManager orgId={orgId} />;
}
