/**
 * One-time Google Calendar authorization script.
 * Run this on the Mac Mini: node calendar-auth.js
 * It will open a browser for you to authorize, then save the token.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const CREDENTIALS_FILE = path.join(__dirname, 'google-credentials.json');
const TOKEN_FILE = path.join(__dirname, 'google-token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
];
const PORT = 3000;

async function authorize() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error('Missing google-credentials.json!');
    console.error('Download it from Google Cloud Console → APIs & Services → Credentials');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};

  const oauth2 = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${PORT}/oauth2callback`
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');

  // Start a temporary local server to receive the OAuth callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') return;

      const code = url.searchParams.get('code');
      if (!code) {
        res.end('No authorization code received.');
        reject(new Error('No code'));
        return;
      }

      try {
        const { tokens } = await oauth2.getToken(code);
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        console.log('Token saved to google-token.json');
        res.end('Authorization successful! You can close this tab.');
        server.close();
        resolve();
      } catch (err) {
        console.error('Error exchanging code:', err.message);
        res.end('Authorization failed.');
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT} for callback...`);
      // Try to open browser automatically
      const { exec } = require('child_process');
      exec(`open "${authUrl}"`);
    });
  });
}

authorize()
  .then(() => {
    console.log('\nGoogle Calendar + Drive authorized! Restart the bot to enable new features.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Authorization failed:', err.message);
    process.exit(1);
  });
