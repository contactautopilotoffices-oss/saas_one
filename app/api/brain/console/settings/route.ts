import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { consoleStatus, saveSettings, settingsView } from '@/backend/lib/aiLayer/brain/console/server';
import { NO_STORE, consoleGuard, fail } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Brain Console → Switches (Tech team only).
 *   GET ?orgId=   the organisation's brain settings, which Claude keys are set (names only, never a value), the model
 *                 order, the change log, and the people who can be chosen for the pilot (name and role only).
 *   PUT ?orgId=   { settings, updatedAt }  saves the whole settings object.
 * The server validates everything again, refuses a write skill going from off straight to live, refuses people who are
 * not members of this organisation, and refuses a save based on a copy someone else has since changed (HTTP 409).
 * A setting can only narrow what a person may do: the app's own access rules still run inside every skill.
 */
export async function GET(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    try {
        const [{ status }, data] = await Promise.all([consoleStatus(supabaseAdmin, guard.orgId), settingsView(supabaseAdmin, guard.orgId)]);
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] settings GET failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The settings could not be loaded.');
    }
}

export async function PUT(request: NextRequest) {
    const guard = await consoleGuard(request);
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => null) as { settings?: unknown; updatedAt?: unknown } | null;
    if (!body || typeof body !== 'object') return fail(400, 'Nothing to save.');
    try {
        const saved = await saveSettings(supabaseAdmin, guard.orgId, guard.userId, body);
        if (!saved.ok) return fail(saved.status, saved.error);
        const [{ status }, data] = await Promise.all([consoleStatus(supabaseAdmin, guard.orgId), settingsView(supabaseAdmin, guard.orgId)]);
        return NextResponse.json({ success: true, status, data }, { headers: NO_STORE });
    } catch (err) {
        console.error('[BrainConsole] settings PUT failed:', err instanceof Error ? err.message : err);
        return fail(500, 'The settings could not be saved. Nothing was changed.');
    }
}
