import { NextRequest, NextResponse } from 'next/server';
import { requireTaskManagerAdmin } from '@/app/api/task-manager/_shared/adminGuard';
import { activatePrompt, approveReview, deletePrompt, deleteReview, ignoreReview, labelReview, listDeveloperItems, listPromptVersions, listReviewItems, rejectPrompt, reviewSchemaV2, rollbackPrompt, saveAlertAdmins, setDevState, summarizeReview, undoReview } from '@/task-manager/BotLearningService';
import { readBotHealth } from '@/task-manager/BotHealthRuntime';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';

export async function GET(request: NextRequest) {
  const guard = await requireTaskManagerAdmin(request.nextUrl.searchParams.get('orgId') || ''); if (!guard.ok) return guard.response;
  try { const [reviews, prompts, health, config, developerItems, reviewUpgrade] = await Promise.all([listReviewItems(Number(request.nextUrl.searchParams.get('limit') || 30), request.nextUrl.searchParams.get('before')), listPromptVersions(), readBotHealth(), TaskDatabaseService.getTestingConfig(), listDeveloperItems(), reviewSchemaV2()]); return NextResponse.json({ success: true, reviews, prompts, health, alertAdmins: config.botAlertAdmins || [], developerItems, reviewUpgrade }); }
  catch (e) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Failed to load bot learning data' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const guard = await requireTaskManagerAdmin(request.nextUrl.searchParams.get('orgId') || ''); if (!guard.ok) return guard.response;
  try {
    const b = await request.json();
    if (b.action === 'label') await labelReview(String(b.id), b.label, guard.label);
    else if (b.action === 'ignore') await ignoreReview(String(b.id), guard.label);
    else if (b.action === 'delete_review') await deleteReview(String(b.id), guard.label);
    else if (b.action === 'delete_prompt') await deletePrompt(String(b.id), guard.label);
    else if (b.action === 'summarize') return NextResponse.json({ success: true, summary: await summarizeReview(String(b.id), guard.label, typeof b.note === 'string' ? b.note : null) });
    else if (b.action === 'approve') await approveReview(String(b.id), b.owner, guard.label);
    else if (b.action === 'undo') await undoReview(String(b.id), guard.label);
    else if (b.action === 'set_dev_state') return NextResponse.json({ success: true, ...(await setDevState(String(b.id), b.state, guard.label)) });
    else if (b.action === 'activate') await activatePrompt(String(b.id), guard.label);
    else if (b.action === 'reject') await rejectPrompt(String(b.id), guard.label);
    else if (b.action === 'rollback') await rollbackPrompt(guard.label);
    else if (b.action === 'save_alert_admins') await saveAlertAdmins(b.admins, guard.label);
    else return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Action failed' }, { status: 400 }); }
}
