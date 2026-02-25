/**
 * Gmail IMAP reader — scans inbox for recent emails.
 * Uses same app password as email.js (SMTP sending).
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');

function getImapConfig() {
  return {
    user: process.env.GMAIL_USER,
    password: process.env.GMAIL_APP_PASSWORD,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  };
}

/**
 * Fetch recent emails from inbox.
 * @param {number} days - How many days back to look (default 1)
 * @param {number} limit - Max emails to return (default 10)
 * @returns {Promise<Array<{from, subject, date, snippet}>>}
 */
function getRecentEmails(days = 1, limit = 10) {
  return new Promise((resolve, reject) => {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return resolve([]);
    }

    const imap = new Imap(getImapConfig());
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }

        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split('T')[0];

        imap.search([['SINCE', sinceStr]], (err, uids) => {
          if (err) { imap.end(); return reject(err); }
          if (!uids || uids.length === 0) { imap.end(); return resolve([]); }

          // Take only the most recent ones
          const recentUids = uids.slice(-limit);
          const fetch = imap.fetch(recentUids, { bodies: '', struct: true });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                const from = parsed.from?.text || 'Unknown';
                const subject = parsed.subject || '(No subject)';
                const date = parsed.date;
                // Get first 200 chars of plain text as snippet
                const text = parsed.text || '';
                const snippet = text.replace(/\s+/g, ' ').trim().substring(0, 200);
                emails.push({ from, subject, date, snippet });
              });
            });
          });

          fetch.once('end', () => {
            imap.end();
          });

          fetch.once('error', (err) => {
            console.error(`[gmail-reader] Fetch error: ${err.message}`);
            imap.end();
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`[gmail-reader] IMAP error: ${err.message}`);
      resolve([]); // Fail gracefully
    });

    imap.once('end', () => {
      // Sort by date descending
      emails.sort((a, b) => (b.date || 0) - (a.date || 0));
      resolve(emails);
    });

    imap.connect();
  });
}

function formatForPrompt(emails) {
  if (!emails || emails.length === 0) return '';

  const lines = [`KS's recent emails (${emails.length}):`];
  for (const e of emails) {
    const d = e.date ? new Date(e.date).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Unknown';
    lines.push(`- [${d}] From: ${e.from} | Subject: ${e.subject}`);
    if (e.snippet) lines.push(`  Preview: ${e.snippet}...`);
  }
  return lines.join('\n');
}

function needsEmail(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'email', 'inbox', 'mail', 'message from', 'any messages',
    'who emailed', 'who wrote', 'check my email', 'check email',
    'unread', 'new mail', 'new email',
  ];
  return triggers.some(t => msg.includes(t));
}

module.exports = { getRecentEmails, formatForPrompt, needsEmail };
