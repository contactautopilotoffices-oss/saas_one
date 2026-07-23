import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * PATCH /api/internal/issue-logs/[id]
 * Update issue status (resolve, ignore, assign)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: issueId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is master admin
    const { data: userData } = await supabase
      .from('users')
      .select('is_master_admin')
      .eq('id', user.id)
      .single();

    if (!userData?.is_master_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { status, assigned_to, resolution_notes } = body;

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      updateData.status = status;
      if (status === 'resolved') {
        updateData.is_resolved = true;
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user.id;
      }
    }

    if (assigned_to !== undefined) {
      updateData.assigned_to = assigned_to;
    }

    if (resolution_notes) {
      updateData.resolution_notes = resolution_notes;
    }

    const { data: issue, error } = await supabase
      .from('issue_logs')
      .update(updateData)
      .eq('id', issueId)
      .select()
      .single();

    if (error) {
      console.error('[Issue Logs] Update error:', error);
      return NextResponse.json(
        { error: 'Failed to update issue' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[Issue Logs] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/internal/issue-logs/[id]
 * Get single issue details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: issueId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is master admin
    const { data: userData } = await supabase
      .from('users')
      .select('is_master_admin')
      .eq('id', user.id)
      .single();

    if (!userData?.is_master_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: issue, error } = await supabase
      .from('issue_logs')
      .select(`
        *,
        user:users!user_id(id, full_name, email, user_photo_url),
        property:properties!property_id(id, name, code),
        organization:organizations!organization_id(id, name, code),
        assignee:users!assigned_to(id, full_name, email),
        resolver:users!resolved_by(id, full_name, email)
      `)
      .eq('id', issueId)
      .single();

    if (error || !issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    return NextResponse.json({ issue });
  } catch (error) {
    console.error('[Issue Logs] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
