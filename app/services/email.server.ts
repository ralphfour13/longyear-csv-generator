import { Resend } from 'resend';
import { promises as fs } from 'fs';
import { getExportPath } from './storage.server';

/**
 * Email Service using Resend
 *
 * Sends export notifications with file attachments
 */

const RESEND_API_KEY = process.env.RESEND_API_SECRET;

if (!RESEND_API_KEY) {
  console.warn('⚠️ RESEND_API_SECRET not configured. Email notifications will be disabled.');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface ExportEmailData {
  shop: string;
  exportDate: string;
  files: Array<{
    filename: string;
    type: string;
    rowCount?: number;
  }>;
  orderCount: number;
  captureCount: number;
  warnings?: string[];
}

/**
 * Send export notification email with attachments
 */
export async function sendExportEmail(
  recipients: string[],
  data: ExportEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!resend) {
    return {
      success: false,
      error: 'Resend API key not configured (RESEND_API_SECRET)',
    };
  }

  if (!recipients || recipients.length === 0) {
    return {
      success: false,
      error: 'No recipients specified',
    };
  }

  try {
    // Read files and prepare attachments
    const attachments = await Promise.all(
      data.files.map(async (file) => {
        const filePath = getExportPath(data.shop, file.filename);
        const content = await fs.readFile(filePath);

        return {
          filename: file.filename,
          content: content,
        };
      })
    );

    // Generate email HTML
    const htmlBody = generateEmailHTML(data);
    const textBody = generateEmailText(data);

    // Send email
    const result = await resend.emails.send({
      from: 'Sage 50 Journal Sync <noreply@four13.dev>',
      to: recipients,
      subject: `Journal Entry Export - ${data.exportDate} (${data.shop})`,
      html: htmlBody,
      text: textBody,
      attachments: attachments,
    });

    if (result.error) {
      console.error('Resend API error:', result.error);
      return {
        success: false,
        error: `Failed to send email: ${result.error.message || String(result.error)}`,
      };
    }

    console.log(`✅ Email sent successfully to ${recipients.join(', ')} - Message ID: ${result.data?.id}`);

    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error) {
    console.error('Failed to send export email:', error);
    return {
      success: false,
      error: `Email send failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test email connection
 */
export async function testEmailConnection(
  testRecipient: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!resend) {
    return {
      success: false,
      error: 'Resend API key not configured (RESEND_API_SECRET)',
    };
  }

  try {
    const result = await resend.emails.send({
      from: 'Sage 50 Journal Sync <noreply@four13.dev>',
      to: testRecipient,
      subject: 'Test Email - Sage 50 Journal Sync',
      html: '<h1>Test Successful!</h1><p>Your email configuration is working correctly.</p>',
      text: 'Test Successful! Your email configuration is working correctly.',
    });

    if (result.error) {
      return {
        success: false,
        error: `Failed to send test email: ${result.error.message || String(result.error)}`,
      };
    }

    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: `Email test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate HTML email body
 */
function generateEmailHTML(data: ExportEmailData): string {
  const warningsHTML = data.warnings && data.warnings.length > 0
    ? `
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 16px 0;">
        <strong>⚠️ Warnings:</strong>
        <ul style="margin: 8px 0; padding-left: 20px;">
          ${data.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
    <h1 style="margin: 0 0 16px 0; font-size: 24px; color: #1a1a1a;">Journal Entry Export Ready</h1>
    <p style="margin: 0; font-size: 14px; color: #666;">Export Date: <strong>${data.exportDate}</strong></p>
    <p style="margin: 4px 0 0 0; font-size: 14px; color: #666;">Shop: <strong>${data.shop}</strong></p>
  </div>

  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 18px; margin: 0 0 12px 0;">Summary</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">Orders Processed:</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;"><strong>${data.orderCount}</strong></td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">Payment Captures:</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;"><strong>${data.captureCount}</strong></td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">Files Generated:</td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;"><strong>${data.files.length}</strong></td>
      </tr>
    </table>
  </div>

  ${warningsHTML}

  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 18px; margin: 0 0 12px 0;">Attached Files</h2>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${data.files.map(file => `
        <li style="padding: 12px; background-color: #f8f9fa; border-radius: 4px; margin-bottom: 8px;">
          <strong>${escapeHtml(file.filename)}</strong>
          <br>
          <span style="font-size: 13px; color: #666;">
            ${file.type}${file.rowCount ? ` • ${file.rowCount} rows` : ''}
          </span>
        </li>
      `).join('')}
    </ul>
  </div>

  <div style="background-color: #e8f4f8; border-left: 4px solid #0ea5e9; padding: 12px; margin: 16px 0;">
    <p style="margin: 0; font-size: 14px;">
      💡 <strong>Import Instructions:</strong> Open Sage 50, go to Tasks → Import/Export → Import, select Journal Entries, and choose the attached CSV file.
    </p>
  </div>

  <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">

  <p style="font-size: 12px; color: #999; text-align: center;">
    This is an automated message from Sage 50 Journal Entry Sync.
    <br>
    Do not reply to this email.
  </p>
</body>
</html>
  `;
}

/**
 * Generate plain text email body
 */
function generateEmailText(data: ExportEmailData): string {
  const warningsText = data.warnings && data.warnings.length > 0
    ? `\n\nWARNINGS:\n${data.warnings.map(w => `- ${w}`).join('\n')}\n`
    : '';

  return `
Journal Entry Export Ready

Export Date: ${data.exportDate}
Shop: ${data.shop}

SUMMARY
-------
Orders Processed: ${data.orderCount}
Payment Captures: ${data.captureCount}
Files Generated: ${data.files.length}
${warningsText}
ATTACHED FILES
--------------
${data.files.map(file => `- ${file.filename} (${file.type}${file.rowCount ? ` • ${file.rowCount} rows` : ''})`).join('\n')}

IMPORT INSTRUCTIONS
-------------------
Open Sage 50, go to Tasks → Import/Export → Import, select Journal Entries, and choose the attached CSV file.

---
This is an automated message from Sage 50 Journal Entry Sync.
Do not reply to this email.
  `.trim();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
