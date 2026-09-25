import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { NotificationService } from '@/backend/services/NotificationService';
import { computeAssetHealth } from '@/backend/lib/assets/performance';

/**
 * GET /api/cron/asset-alerts
 * Daily sweep: assets whose warranty just expired, and assets that need an
 * AMC to be processed — either the AMC itself expires in 30/15/7 days, or the
 * asset requires AMC and has none active (P3 asset with no cover). Alerts
 * property admins for their property; org admins get nothing they didn't
 * already get from the AMC contract cron — this one is asset-level detail.
 * Auth: Bearer CRON_SECRET. vercel.json: 15 3 * * * (after ppm/amc crons).
 */
export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        nowIST.setHours(0, 0, 0, 0);
        const todayStr = nowIST.toISOString().slice(0, 10);

        const { data: assets, error } = await supabaseAdmin
            .from('assets')
            .select(`
                id, organization_id, property_id, asset_code, name, installation_date, lifecycle_years,
                warranty_end, amc_required, status,
                category:asset_categories(default_lifecycle_years),
                amc:amc_contracts(contract_end_date, status)
            `)
            .is('deleted_at', null)
            .in('status', ['active', 'under_repair']);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        let warrantyExpired = 0;
        let amcNeeded = 0;
        let alertsSent = 0;
        const perPropertyAlerts = new Map<string, { orgId: string; propertyId: string; warranty: string[]; amc: string[] }>();

        for (const a of assets || []) {
            const amc = Array.isArray((a as any).amc) ? (a as any).amc[0] : (a as any).amc;
            const category = Array.isArray((a as any).category) ? (a as any).category[0] : (a as any).category;

            // Warranty expired exactly today — the one-time "just lapsed" alert (AMC contract
            // expiry itself is already covered day-by-day by /api/cron/amc-expiry-alerts).
            const warrantyJustExpired = a.warranty_end === todayStr;
            const health = computeAssetHealth({
                installation_date: a.installation_date,
                lifecycle_years: a.lifecycle_years,
                category_lifecycle_years: category?.default_lifecycle_years ?? null,
                warranty_end: a.warranty_end,
                amc_required: a.amc_required,
                amc: amc ? { contract_end_date: amc.contract_end_date, status: amc.status } : null,
                open_tickets: 0,
                overdue_ppm: 0,
                status: a.status,
            }, nowIST);

            const needsAmc = a.amc_required && health.amc_pending;

            if (warrantyJustExpired) warrantyExpired++;
            if (needsAmc) amcNeeded++;
            if (!warrantyJustExpired && !needsAmc) continue;

            if (!perPropertyAlerts.has(a.property_id)) {
                perPropertyAlerts.set(a.property_id, { orgId: a.organization_id, propertyId: a.property_id, warranty: [], amc: [] });
            }
            const bucket = perPropertyAlerts.get(a.property_id)!;
            if (warrantyJustExpired) bucket.warranty.push(`${a.name} (${a.asset_code})`);
            if (needsAmc) bucket.amc.push(`${a.name} (${a.asset_code})`);
        }

        for (const [propertyId, bucket] of perPropertyAlerts) {
            const { data: propAdmins } = await supabaseAdmin
                .from('property_memberships')
                .select('user_id')
                .eq('property_id', propertyId)
                .eq('role', 'property_admin')
                .eq('is_active', true);
            const recipientIds = (propAdmins || []).map((m: { user_id: string }) => m.user_id);
            if (recipientIds.length === 0) continue;

            const lines = [
                `🔧 *Asset Alerts*`,
                ``,
                ...(bucket.warranty.length ? [`⚠️ Warranty expired today (${bucket.warranty.length}):`, ...bucket.warranty.slice(0, 10).map((s) => `• ${s}`), ''] : []),
                ...(bucket.amc.length ? [`📋 AMC needs to be processed (${bucket.amc.length}):`, ...bucket.amc.slice(0, 10).map((s) => `• ${s}`), ''] : []),
                `Open Asset Management to review.`,
            ].filter((l) => l !== undefined);

            await WhatsAppQueueService.enqueue({ ticketId: '', userIds: recipientIds, message: lines.join('\n'), eventType: 'ASSET_ALERT' });
            await NotificationService.sendToMany(recipientIds, {
                propertyId,
                organizationId: bucket.orgId,
                type: 'ASSET_ALERT',
                title: `🔧 ${bucket.warranty.length + bucket.amc.length} asset alert${bucket.warranty.length + bucket.amc.length === 1 ? '' : 's'}`,
                message: [
                    bucket.warranty.length ? `${bucket.warranty.length} warranty expired today` : null,
                    bucket.amc.length ? `${bucket.amc.length} need AMC` : null,
                ].filter(Boolean).join(' · '),
                deepLink: '/assets',
                priority: 'NORMAL',
            }).catch((err) => console.error('[asset-alerts] FCM push error:', err));

            alertsSent += recipientIds.length;
        }

        return NextResponse.json({
            outcome: `${warrantyExpired} warranty expiring today, ${amcNeeded} assets need AMC, ${alertsSent} recipients alerted across ${perPropertyAlerts.size} properties`,
            warranty_expired_today: warrantyExpired,
            amc_needed: amcNeeded,
            properties_alerted: perPropertyAlerts.size,
        });
    } catch (err: any) {
        console.error('[asset-alerts] cron error:', err);
        return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
    }
}
