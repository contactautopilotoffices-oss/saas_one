import { NextRequest, NextResponse } from 'next/server';
import { EmailService } from '@/backend/services/EmailService';

/**
 * POST /api/internal/security-alert
 * Trigger security email notification when failed login threshold is reached
 */
export async function POST(request: NextRequest) {
  try {
    const { email, userAgent, ip } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ea2d49; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #ea2d49; color: #ffffff; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">🚨 Security Alert: Multiple Failed Login Attempts</h2>
        </div>
        <div style="padding: 24px; color: #333333; line-height: 1.6;">
          <p>Hello,</p>
          <p>We detected <strong>5 consecutive failed login attempts</strong> for your account (<strong>${email}</strong>) on <strong>${now} IST</strong>.</p>
          
          <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Location / Details:</strong></p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563;">
              <li><strong>Time:</strong> ${now}</li>
              <li><strong>IP Address:</strong> ${ip || 'Unknown'}</li>
              <li><strong>Browser/Device:</strong> ${userAgent || 'Unknown'}</li>
            </ul>
          </div>

          <p style="color: #dc2626; font-weight: bold;">If this was NOT you:</p>
          <p style="margin-top: 4px;">Someone may be attempting to guess your password. We strongly recommend resetting your password immediately to secure your account.</p>

          <p style="color: #4b5563; font-size: 14px; margin-top: 20px;">If this was you, you can safely ignore this email. Your login form has been temporarily locked for 2 minutes as a safety measure.</p>
        </div>
        <div style="background-color: #f3f4f6; text-align: center; padding: 12px; font-size: 12px; color: #6b7280;">
          Autopilot FMS Security Team
        </div>
      </div>
    `;

    // Send email using existing Nodemailer transporter
    await EmailService.sendGenericNotificationEmail({
      emailTo: email,
      subject: '🚨 Security Alert: Multiple Failed Login Attempts on your account',
      title: 'Security Alert: Failed Login Attempts',
      htmlBody,
    });

    return NextResponse.json({ success: true, message: 'Security alert sent' });
  } catch (error: any) {
    console.error('[SecurityAlert API] Failed:', error);
    return NextResponse.json({ error: 'Failed to send security alert' }, { status: 500 });
  }
}
