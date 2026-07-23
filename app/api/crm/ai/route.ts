import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, readOrgId, scopeLeadsQuery } from '@/backend/lib/crm/access';

// POST /api/crm/ai - rule-based CRM insights over the caller's visible leads
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body?.query) return NextResponse.json({ error: 'Query is required' }, { status: 400 });

    const access = await resolveCrmAccess(request, readOrgId(request, body));
    if (isCrmAccessError(access)) return access;

    try {
        const { query } = body;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // Leads the caller can see (admins: whole org; reps: own + markets).
        let leadsQuery = supabaseAdmin
            .from('crm_leads')
            .select(`
                *,
                status_info:crm_lead_statuses(name, is_won, is_terminal),
                assigned_user:users!crm_leads_assigned_to_fkey(full_name)
            `)
            .eq('is_archived', false);
        leadsQuery = scopeLeadsQuery(leadsQuery, access);

        const eventsQuery = supabaseAdmin
            .from('crm_events')
            .select('*')
            .eq('organization_id', access.organizationId)
            .eq('user_id', access.user.id)
            .gte('start_datetime', startOfMonth);

        const [leadsRes, eventsRes] = await Promise.all([leadsQuery, eventsQuery]);
        const leads = leadsRes.data || [];
        const events = eventsRes.data || [];

        const wonStatus = leads.filter((l) => l.status_info?.is_won);
        const totalPipeline = leads
            .filter((l) => !l.status_info?.is_terminal)
            .reduce((sum, l) => sum + Number(l.deal_value || 0), 0);
        const revenueClosed = wonStatus.reduce((sum, l) => sum + Number(l.deal_value || 0), 0);

        const response = await processAIQuery(query, {
            leads,
            events,
            totalPipeline,
            revenueClosed,
            wonCount: wonStatus.length,
            totalLeads: leads.length,
        });

        return NextResponse.json({ response });
    } catch (error) {
        console.error('CRM AI error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

async function processAIQuery(query: string, data: any): Promise<string> {
    const lowerQuery = query.toLowerCase();
    const leads: any[] = data.leads || [];
    const events: any[] = data.events || [];

    // Leads not contacted for X days
    if (lowerQuery.includes('not contacted') || lowerQuery.includes('stale')) {
        const days = parseDays(lowerQuery) || 14;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const staleLeads = leads.filter(l => {
            if (!l.last_contacted) return true;
            return new Date(l.last_contacted) < cutoff;
        });

        if (staleLeads.length === 0) {
            return `Great news! All your leads have been contacted within the last ${days} days.`;
        }

        return `Found ${staleLeads.length} leads not contacted in ${days}+ days:\n\n` +
            staleLeads.slice(0, 10).map((l, i) =>
                `${i + 1}. ${l.company_name || l.contact_person || 'Unknown'}\n` +
                `   Last contacted: ${l.last_contacted ? formatDate(l.last_contacted) : 'Never'}\n` +
                `   Status: ${l.status_info?.name || 'Unknown'}`
            ).join('\n\n');
    }

    // High value opportunities
    if (lowerQuery.includes('high value') || lowerQuery.includes('lakh') || lowerQuery.includes('crore')) {
        const threshold = parseValueThreshold(lowerQuery);
        const highValue = leads
            .filter(l => l.deal_value >= threshold)
            .sort((a, b) => b.deal_value - a.deal_value);

        if (highValue.length === 0) {
            return `No leads found with deal value above ₹${formatCurrency(threshold)}.`;
        }

        return `Found ${highValue.length} high-value opportunities (₹${formatCurrencyCompact(threshold)}+):\n\n` +
            highValue.slice(0, 10).map((l, i) =>
                `${i + 1}. ${l.company_name || l.contact_person}\n` +
                `   Value: ${formatCurrency(l.deal_value)}\n` +
                `   Status: ${l.status_info?.name || 'Unknown'}`
            ).join('\n\n');
    }

    // Pipeline summary
    if (lowerQuery.includes('pipeline')) {
        const activeLeads = leads.filter(l => !l.status_info?.is_terminal);

        return `📊 Your Pipeline Summary:\n\n` +
            `• Total Leads: ${data.totalLeads}\n` +
            `• Active in Pipeline: ${activeLeads.length}\n` +
            `• Pipeline Value: ${formatCurrency(data.totalPipeline)}\n` +
            `• Won This Month: ${data.wonCount} (${formatCurrency(data.revenueClosed)})\n\n` +
            `Status Breakdown:\n` +
            Object.entries(getStatusBreakdown(leads)).map(([status, count]) =>
                `• ${status}: ${count}`
            ).join('\n');
    }

    // Monthly closures
    if (lowerQuery.includes('closure') || lowerQuery.includes('won') || lowerQuery.includes('month')) {
        return `🏆 This Month's Performance:\n\n` +
            `• Deals Won: ${data.wonCount}\n` +
            `• Revenue Closed: ${formatCurrency(data.revenueClosed)}\n` +
            `• Meetings Conducted: ${events.filter(e => e.event_type === 'meeting').length}\n` +
            `• Site Visits: ${events.filter(e => e.event_type === 'site_visit').length}\n\n` +
            (data.wonCount > 0
                ? `Average deal size: ${formatCurrency(data.revenueClosed / data.wonCount)}`
                : 'Keep pushing to close your first deal!');
    }

    // Overdue follow-ups
    if (lowerQuery.includes('overdue') || lowerQuery.includes('follow up')) {
        const today = new Date().toISOString().split('T')[0];
        const overdue = leads.filter(l =>
            l.next_followup_date && l.next_followup_date.split('T')[0] < today
        );

        if (overdue.length === 0) {
            return `✅ No overdue follow-ups! All your scheduled follow-ups are up to date.`;
        }

        return `⚠️ Found ${overdue.length} overdue follow-ups:\n\n` +
            overdue.slice(0, 10).map((l, i) =>
                `${i + 1}. ${l.company_name || l.contact_person}\n` +
                `   Due: ${formatDate(l.next_followup_date)}\n` +
                `   Status: ${l.status_info?.name || 'Unknown'}`
            ).join('\n\n');
    }

    // Summary request
    if (lowerQuery.includes('summary') || lowerQuery.includes('overview')) {
        return `📋 CRM Summary:\n\n` +
            `Leads Overview:\n` +
            `• Total Assigned: ${data.totalLeads}\n` +
            `• Active Pipeline: ${data.totalPipeline > 0 ? 'Yes' : 'No'}\n` +
            `• Pipeline Value: ${formatCurrency(data.totalPipeline)}\n\n` +
            `This Month:\n` +
            `• Won: ${data.wonCount} deals\n` +
            `• Revenue: ${formatCurrency(data.revenueClosed)}\n` +
            `• Meetings: ${events.filter(e => e.event_type === 'meeting').length}\n\n` +
            `Need attention:\n` +
            `• Overdue: ${leads.filter(l => l.next_followup_date && l.next_followup_date.split('T')[0] < new Date().toISOString().split('T')[0]).length} follow-ups\n` +
            `• Not contacted (14+ days): ${leads.filter(l => !l.last_contacted || new Date(l.last_contacted) < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)).length}`;
    }

    // Default response
    return `I can help you with:\n\n` +
        `• "Show leads not contacted for 14 days"\n` +
        `• "Show high-value opportunities above 50 lakhs"\n` +
        `• "Show pipeline summary"\n` +
        `• "Show this month's closures"\n` +
        `• "Show overdue follow-ups"\n` +
        `• "Give me a summary"`;
}

function parseDays(query: string): number {
    const match = query.match(/(\d+)\s*day/);
    return match ? parseInt(match[1]) : 14;
}

function parseValueThreshold(query: string): number {
    if (query.includes('crore') || query.includes('cr')) {
        const match = query.match(/(\d+)\s*(crore|cr)/);
        return match ? parseInt(match[1]) * 10000000 : 5000000;
    }
    if (query.includes('lakh') || query.includes('lk')) {
        const match = query.match(/(\d+)\s*(lakh|lk|lacs?)/);
        return match ? parseInt(match[1]) * 100000 : 5000000;
    }
    return 5000000;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(value);
}

function formatCurrencyCompact(value: number): string {
    if (value >= 10000000) {
        return `${(value / 10000000).toFixed(1)} Cr`;
    }
    if (value >= 100000) {
        return `${(value / 100000).toFixed(1)} L`;
    }
    return formatCurrency(value);
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function getStatusBreakdown(leads: any[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    leads.forEach(l => {
        const status = l.status_info?.name || 'Unknown';
        breakdown[status] = (breakdown[status] || 0) + 1;
    });
    return breakdown;
}