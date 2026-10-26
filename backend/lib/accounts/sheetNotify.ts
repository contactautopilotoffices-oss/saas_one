import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EmailService } from '@/backend/services/EmailService';
import { WhatsAppService } from '@/backend/services/WhatsAppService';

const inr = (n: number | string) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface NotifySheetInput {
    sheetId: string;
    organizationId: string;
    batchNumber: string;
    title: string;
    totalPos: number;
    totalAmount: number;
    submittedByName?: string;
    appUrl?: string;
}

export async function notifyApproversOnSheetSubmission(input: NotifySheetInput) {
    try {
        const { organizationId, batchNumber, title, totalPos, totalAmount, submittedByName } = input;

        // 1. Fetch organization name and settings
        const [orgRes, settingsRes] = await Promise.all([
            supabaseAdmin.from('organizations').select('name').eq('id', organizationId).single(),
            supabaseAdmin.from('payment_tracker_settings').select('*').eq('organization_id', organizationId).maybeSingle(),
        ]);

        const orgName = orgRes.data?.name || 'Organization';
        const settings = settingsRes.data;

        // Approver user IDs from settings or fallback to org admins
        let approverIds: string[] = settings?.approver_user_ids || [];
        if (!approverIds.length) {
            const { data: admins } = await supabaseAdmin
                .from('organization_memberships')
                .select('user_id')
                .eq('organization_id', organizationId)
                .in('role', ['org_super_admin', 'org_admin', 'master_admin'])
                .eq('is_active', true);
            approverIds = (admins || []).map((a: any) => a.user_id);
        }

        if (!approverIds.length) return;

        // 2. Fetch approver user details
        const { data: approvers } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email, phone')
            .in('id', approverIds);

        if (!approvers?.length) return;

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.autopilotoffices.com';
        const reviewUrl = `${baseUrl}/${organizationId}/accounts?tab=approvals&sheet=${input.sheetId}`;

        for (const approver of approvers) {
            // Email Notification
            if (settings?.notify_via_email !== false && approver.email) {
                const subject = `[Action Required] New Payment Sheet Submitted: ${batchNumber} (${inr(totalAmount)})`;
                const html = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.5;">
                        <div style="background-color: #587e85; padding: 20px; border-radius: 8px 8px 0 0; color: white;">
                            <h2 style="margin: 0; font-size: 20px;">Payment Sheet Awaiting Approval</h2>
                            <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 13px;">${orgName} · Payment Tracker</p>
                        </div>
                        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
                            <p>Hello <strong>${approver.full_name || 'Approver'}</strong>,</p>
                            <p>A new purchase order payment sheet has been compiled and submitted for your approval.</p>

                            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 6px; overflow: hidden;">
                                <tr>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Batch Number</td>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: bold;">${batchNumber}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Title / Description</td>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${title}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Total POs</td>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${totalPos}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Total Net Payable</td>
                                    <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: bold; color: #059669;">${inr(totalAmount)}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 14px; font-size: 13px; color: #64748b;">Submitted By</td>
                                    <td style="padding: 10px 14px; font-size: 13px;">${submittedByName || 'Procurement Team'}</td>
                                </tr>
                            </table>

                            <div style="text-align: center; margin: 28px 0;">
                                <a href="${reviewUrl}" style="background-color: #587e85; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
                                    Review & Approve Sheet
                                </a>
                            </div>

                            <p style="font-size: 12px; color: #64748b; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                                Accounts is pre-aligning these payments in parallel. Any lines you reject or remove will be automatically cancelled in the accounts disbursement queue.
                            </p>
                        </div>
                    </div>
                `;

                EmailService.sendEmail({
                    to: approver.email,
                    subject,
                    html,
                }).catch(err => console.error('[sheetNotify] email failed:', err));
            }

            // WhatsApp Notification
            if (settings?.notify_via_whatsapp !== false && approver.phone) {
                WhatsAppService.sendToUser(approver.id, {
                    message: `New Payment Sheet Submitted: ${batchNumber} with ${totalPos} POs totaling ${inr(totalAmount)} is ready for your review. Please click the link to approve: ${reviewUrl}`,
                    deepLink: reviewUrl,
                    moduleName: 'procurement',
                }).catch(err => console.error('[sheetNotify] whatsapp failed:', err));
            }
        }
    } catch (e) {
        console.error('[notifyApproversOnSheetSubmission] error:', e);
    }
}
