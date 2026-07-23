import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

/**
 * POST /api/internal/issue-logs
 * Capture errors/issues from frontend automatically
 * No auth required - called by frontend error tracking
 */
export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch (e) {
      // Allow empty bodies
    }
    const adminSupabase = createAdminClient();
    const {
      category,
      severity,
      source,
      error_message,
      error_code,
      stack_trace,
      request_url,
      request_method,
      request_body,
      page_url,
      page_route,
      component_name,
      user_agent,
      browser,
      os,
      device,
      screen_size,
      user_id,
      property_id,
      organization_id,
      user_description,
      user_screenshot_url,
      occurred_at,
    } = body;

    // Validate required fields
    if (!category || !error_message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check for duplicate errors (same error in last 5 minutes on same page)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existing } = await adminSupabase
      .from('issue_logs')
      .select('id, occurrence_count')
      .eq('error_message', error_message.slice(0, 500))
      .eq('page_route', page_route)
      .eq('category', category)
      .gte('occurred_at', fiveMinutesAgo)
      .maybeSingle();

    if (existing) {
      // Increment occurrence count
      await adminSupabase
        .from('issue_logs')
        .update({
          occurrence_count: existing.occurrence_count + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      return NextResponse.json({
        success: true,
        message: 'Issue count updated',
        id: existing.id,
      });
    }

    // Insert new issue
    const { data: issue, error: insertError } = await adminSupabase
      .from('issue_logs')
      .insert({
        category,
        severity: severity || 'medium',
        source: source || 'frontend',
        error_message: error_message.slice(0, 1000),
        error_code,
        stack_trace: stack_trace?.slice(0, 5000),
        request_url,
        request_method,
        request_body: request_body ? JSON.stringify(request_body).slice(0, 2000) : null,
        page_url,
        page_route,
        component_name,
        user_agent,
        browser,
        os,
        device,
        screen_size,
        user_id,
        property_id,
        organization_id,
        user_description,
        user_screenshot_url,
        occurred_at: occurred_at || new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Issue Logs] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to log issue' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: issue.id,
    });
  } catch (error) {
    console.error('[Issue Logs] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/internal/issue-logs
 * Fetch issues for Master Admin dashboard
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const severity = searchParams.get('severity');
    const propertyId = searchParams.get('propertyId');
    const organizationId = searchParams.get('organizationId');
    const period = searchParams.get('period'); // 'today', 'week', 'month'
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('issue_logs')
      .select(`
        *,
        user:users!user_id(id, full_name, email),
        property:properties!property_id(id, name, code),
        organization:organizations!organization_id(id, name, code),
        assignee:users!assigned_to(id, full_name, email)
      `, { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (severity && severity !== 'all') {
      query = query.eq('severity', severity);
    }
    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }
    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }
    if (period && period !== 'all') {
      const now = new Date();
      let fromDate: Date | undefined;
      if (period === 'today') {
        fromDate = new Date(now.setHours(0, 0, 0, 0));
      } else if (period === 'week') {
        fromDate = new Date(now.setDate(now.getDate() - 7));
      } else if (period === 'month') {
        fromDate = new Date(now.setDate(now.getDate() - 30));
      }
      if (fromDate) {
        query = query.gte('occurred_at', fromDate.toISOString());
      }
    }

    const { data: issues, error, count } = await query;

    if (error) {
      console.error('[Issue Logs] Fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch issues' },
        { status: 500 }
      );
    }

    // Get summary stats
    const { data: summary } = await supabase
      .from('issue_logs')
      .select('category, severity, status')
      .gte('occurred_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const summaryStats = {
      total: summary?.length || 0,
      byCategory: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      critical: summary?.filter(i => i.severity === 'critical').length || 0,
      high: summary?.filter(i => i.severity === 'high').length || 0,
    };

    summary?.forEach((issue: any) => {
      summaryStats.byCategory[issue.category] = (summaryStats.byCategory[issue.category] || 0) + 1;
      summaryStats.bySeverity[issue.severity] = (summaryStats.bySeverity[issue.severity] || 0) + 1;
      summaryStats.byStatus[issue.status] = (summaryStats.byStatus[issue.status] || 0) + 1;
    });

    return NextResponse.json({
      issues: issues || [],
      total: count || 0,
      summary: summaryStats,
    });
  } catch (error) {
    console.error('[Issue Logs] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
