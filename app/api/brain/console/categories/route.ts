import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { acceptMerge, categoriesView, dismissSuggestion, saveCategory, setCategoryOn, suggestCategories, type SaveResult } from '@/backend/lib/ticketing/categoryConfig';
import { consoleGuard, fail } from '../_lib';

export const runtime = 'nodejs';
/** "Suggest categories" makes one model call while the person waits. */
export const maxDuration = 120;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Brain → Categories & SLAs (owner 2026-11-19), Tech team only (consoleGuard), one organisation per call.
 * GET   the organisation's categories (team, usual priority, SLA, what belongs here, where it is on), the AI's waiting
 *       suggestions and the latest changes.
 * POST  { action: 'save', ...CategoryInput }        add or edit a category for all or selected properties
 *       { action: 'switch_off' | 'switch_on', code } never deletes; old tickets keep their category
 *       { action: 'suggest' }                        the AI suggests categories (only on this button)
 *       { action: 'dismiss' | 'merge', id }          a suggestion dismissed / a merge accepted
 * Code: backend/lib/ticketing/categoryConfig.ts.
 */
export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    try {
        return NextResponse.json({ success: true, data: await categoriesView(supabaseAdmin, guard.orgId) }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] categories GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The categories could not be loaded.');
    }
}

export async function POST(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return fail(400, 'Nothing to save.');
    try {
        const { orgId, userId } = guard;
        const done: SaveResult = body.action === 'save' ? await saveCategory(supabaseAdmin, orgId, userId, body)
            : body.action === 'switch_off' ? await setCategoryOn(supabaseAdmin, orgId, userId, body.code, false)
            : body.action === 'switch_on' ? await setCategoryOn(supabaseAdmin, orgId, userId, body.code, true)
            : body.action === 'suggest' ? await suggestCategories(supabaseAdmin, orgId, userId)
            : body.action === 'dismiss' ? await dismissSuggestion(supabaseAdmin, orgId, userId, body.id)
            : body.action === 'merge' ? await acceptMerge(supabaseAdmin, orgId, userId, body.id)
            : { ok: false, status: 400, error: 'Unknown action.' };
        if (!done.ok) return fail(done.status, done.error);
        return NextResponse.json({ success: true, data: await categoriesView(supabaseAdmin, orgId), message: done.message }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] categories POST failed:', err instanceof Error ? err.message : err);
        return fail(500, 'That could not be saved.');
    }
}
