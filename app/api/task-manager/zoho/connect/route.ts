/**
 * CONNECT ZOHO TASKS — step 1 of 2. Send the signed-in person to Zoho to consent.
 * -----------------------------------------------------------------------------
 * Reuses the ONE Zoho server-based application the mailbox connection already uses
 * (ZOHO_MAIL_APP_CLIENT_ID / _SECRET). One-time operator step: add
 *   <app>/api/task-manager/zoho/callback
 * as an extra Authorized Redirect URI on that application.
 *
 * Scope is ZohoMail.tasks.READ only — this connection can list tasks and nothing else.
 * `state` is single-use and bound to the signed-in user, so a consent cannot be replayed
 * or redeemed for someone else.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskManagerAuth } from '../../_shared/adminGuard';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { ZOHO_TASK_SCOPES, zohoTaskCallbackUrl } from '@/task-manager/ZohoTaskSync';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Imported tasks land in the person's own list, so they must be on the Task Manager roster.
    const employee = await TaskDatabaseService.getEmployeeById(user.id);
    if (!employee) return NextResponse.json({ error: 'You are not on the Task Manager roster, so there is no list to import into.' }, { status: 403 });

    const clientId = process.env.ZOHO_MAIL_APP_CLIENT_ID;
    if (!clientId || !process.env.ZOHO_MAIL_APP_CLIENT_SECRET) {
        return NextResponse.json({ error: 'No Zoho application is configured on this deployment (ZOHO_MAIL_APP_CLIENT_ID / _SECRET).' }, { status: 503 });
    }
    const redirectUri = zohoTaskCallbackUrl(request.url);
    if (!redirectUri.startsWith('http')) {
        return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set, so the Zoho redirect cannot be built.' }, { status: 503 });
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const { error } = await supabaseAdmin.from('task_zoho_oauth_state').insert({ state, user_id: user.id });
    if (error) {
        return NextResponse.json({
            error: `Could not start the connection: ${error.message}`,
            hint: 'If this mentions a missing relation, apply supabase/migrations/20261029200001_task_manager_zoho_tasks.sql.',
        }, { status: 500 });
    }

    const dc = (process.env.ZOHO_MAIL_APP_DC || process.env.ZOHO_MAIL_DC || 'com').trim();
    const url = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', ZOHO_TASK_SCOPES);
    url.searchParams.set('redirect_uri', redirectUri);
    // offline + consent, or Zoho returns no refresh token and the connection lasts one hour.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return NextResponse.redirect(url.toString());
}
