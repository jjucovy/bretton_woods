// server/email.js - Email notification system

const nodemailer = require('nodemailer');
const { queryDatabase } = require('./database');

const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
};

let emailTransporter = null;
if (EMAIL_CONFIG.auth.user && EMAIL_CONFIG.auth.pass) {
  emailTransporter = nodemailer.createTransport(EMAIL_CONFIG);
  console.log('📧 Email notifications enabled');
} else {
  console.log('📧 Email notifications disabled (SMTP_USER and SMTP_PASS not configured)');
}

/**
 * Send email notification to superadmin users.
 * @param {string} subject
 * @param {string} message
 * @param {string|null} gameCode
 */
async function sendAdminNotification(subject, message, gameCode = null) {
  if (!emailTransporter) {
    console.log('📧 Email skipped - transporter not configured');
    return false;
  }

  try {
    const dbUsers = await queryDatabase('getAllUsers', {});
    if (!dbUsers || !Array.isArray(dbUsers)) {
      console.error('📧 Could not fetch users for email notification');
      return false;
    }

    const superadmins = dbUsers.filter(u => u.is_teacher === '1' || u.is_teacher === 1);
    if (superadmins.length === 0) {
      console.log('📧 No superadmins found to notify');
      return false;
    }

    const adminEmails = superadmins
      .map(u => u.email || u.username)
      .filter(email => email && email.includes('@'));

    if (adminEmails.length === 0) {
      console.log('📧 No valid superadmin email addresses found');
      return false;
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">🌍 Bretton Woods 1944</h1>
          <p style="color: #cbd5e1; margin: 8px 0 0 0;">Game Notification</p>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1e293b; margin-top: 0;">${subject}</h2>
          <p style="color: #475569; line-height: 1.6;">${message}</p>
          ${gameCode ? `<p style="color: #64748b; font-size: 0.875rem;">Game Code: <strong>${gameCode}</strong></p>` : ''}
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 0.75rem; margin: 0;">
            This is an automated notification from the Bretton Woods simulation.
          </p>
        </div>
      </div>
    `;

    const info = await emailTransporter.sendMail({
      from: `"Bretton Woods Game" <${EMAIL_CONFIG.auth.user}>`,
      to: adminEmails.join(', '),
      subject: `[Bretton Woods] ${subject}`,
      html: htmlContent
    });

    console.log(`📧 Email sent to ${adminEmails.join(', ')}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('📧 Failed to send email:', error.message);
    return false;
  }
}

module.exports = { sendAdminNotification, EMAIL_CONFIG };
