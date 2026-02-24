const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * Send an email from janet.bot88@gmail.com
 * @param {string} to - recipient email address
 * @param {string} subject - email subject
 * @param {string} body - email body (plain text)
 * @param {object} [options] - optional: { html, cc, bcc, replyTo }
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail(to, subject, body, options = {}) {
  try {
    const mailOptions = {
      from: `Janet <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: body,
    };
    if (options.html) mailOptions.html = options.html;
    if (options.cc) mailOptions.cc = options.cc;
    if (options.bcc) mailOptions.bcc = options.bcc;
    if (options.replyTo) mailOptions.replyTo = options.replyTo;

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail };
