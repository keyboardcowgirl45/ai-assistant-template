const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_FILE = path.join(__dirname, 'google-credentials.json');
const TOKEN_FILE = path.join(__dirname, 'google-token.json');

let _auth = null;
let _drive = null;

/**
 * Get authenticated Drive client, reusing calendar's OAuth token.
 */
function getDrive() {
  if (_drive) return _drive;

  if (!fs.existsSync(CREDENTIALS_FILE) || !fs.existsSync(TOKEN_FILE)) {
    console.warn('[drive] Credentials or token missing — Drive disabled');
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
    if (!client_id || !client_secret) return null;

    const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || 'http://localhost:3000/oauth2callback');
    const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    oauth2.setCredentials(token);

    oauth2.on('tokens', (tokens) => {
      const existing = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      const updated = { ...existing, ...tokens };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2));
      console.log('[drive] Token refreshed and saved');
    });

    _auth = oauth2;
    _drive = google.drive({ version: 'v3', auth: oauth2 });
    console.log('[drive] Google Drive authenticated');
    return _drive;
  } catch (err) {
    console.error(`[drive] Auth error: ${err.message}`);
    return null;
  }
}

/**
 * List files, optionally filtered by query.
 * @param {object} opts
 *   - query: search string (searches file names)
 *   - folderId: restrict to a specific folder
 *   - mimeType: filter by MIME type (e.g. 'application/pdf')
 *   - maxResults: number of files to return (default 10)
 * @returns {Array<{ id, name, mimeType, modifiedTime, size, webViewLink }>}
 */
async function listFiles({ query, folderId, mimeType, maxResults = 10 } = {}) {
  const drive = getDrive();
  if (!drive) return [];

  const qParts = ['trashed = false'];
  if (query) qParts.push(`name contains '${query.replace(/'/g, "\\'")}'`);
  if (folderId) qParts.push(`'${folderId}' in parents`);
  if (mimeType) qParts.push(`mimeType = '${mimeType}'`);

  try {
    const res = await drive.files.list({
      q: qParts.join(' and '),
      pageSize: maxResults,
      fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
      orderBy: 'modifiedTime desc',
    });
    return res.data.files || [];
  } catch (err) {
    console.error(`[drive] Error listing files: ${err.message}`);
    return [];
  }
}

/**
 * Get the text content of a Google Doc.
 * @param {string} fileId
 * @returns {string|null} plain text content
 */
async function getDocContent(fileId) {
  const drive = getDrive();
  if (!drive) return null;

  try {
    const res = await drive.files.export({
      fileId,
      mimeType: 'text/plain',
    });
    return res.data;
  } catch (err) {
    console.error(`[drive] Error reading doc ${fileId}: ${err.message}`);
    return null;
  }
}

/**
 * Download a file's content as text (for non-Google-native files like .txt, .md, .csv).
 * @param {string} fileId
 * @returns {string|null}
 */
async function getFileContent(fileId) {
  const drive = getDrive();
  if (!drive) return null;

  try {
    const res = await drive.files.get({
      fileId,
      alt: 'media',
    }, { responseType: 'text' });
    return res.data;
  } catch (err) {
    console.error(`[drive] Error downloading file ${fileId}: ${err.message}`);
    return null;
  }
}

/**
 * Search for files by name and return formatted results.
 * @param {string} query - search term
 * @returns {string} formatted text for prompt injection
 */
async function searchFiles(query) {
  const files = await listFiles({ query, maxResults: 10 });
  if (files.length === 0) return `No files found matching "${query}".`;

  return files.map(f => {
    const modified = new Date(f.modifiedTime).toLocaleDateString('en-SG');
    const type = simplifyMimeType(f.mimeType);
    return `- ${f.name} (${type}, modified ${modified})`;
  }).join('\n');
}

/**
 * Simplify MIME types for display.
 */
function simplifyMimeType(mimeType) {
  const map = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'application/pdf': 'PDF',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'video/mp4': 'MP4',
  };
  return map[mimeType] || mimeType.split('/').pop();
}

/**
 * Get recent files for context injection.
 * @param {number} max - number of files (default 10)
 * @returns {Array}
 */
async function getRecentFiles(max = 10) {
  return listFiles({ maxResults: max });
}

/**
 * Format Drive file list for prompt injection.
 * @param {Array} files - array of file objects from listFiles
 * @returns {string}
 */
function formatForPrompt(files) {
  if (!files || files.length === 0) return '';

  const lines = files.map(f => {
    const modified = new Date(f.modifiedTime).toLocaleDateString('en-SG');
    const type = simplifyMimeType(f.mimeType);
    return `- ${f.name} (${type}, modified ${modified}) [id: ${f.id}]`;
  });

  return `KS's recent Google Drive files:\n${lines.join('\n')}\n\nYou can reference these files. For Google Docs, you can read their content using the file ID.`;
}

/**
 * Check if Drive is configured and ready.
 */
function isAvailable() {
  return getDrive() !== null;
}

/**
 * Detect if a message likely needs Drive access.
 */
function needsDrive(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'drive', 'google drive', 'find file', 'find document',
    'search drive', 'my files', 'my documents',
    'shared drive', 'in my drive', 'on drive',
    'google doc', 'google sheet', 'spreadsheet',
    'upload', 'download file',
  ];
  return triggers.some(t => msg.includes(t));
}

module.exports = { listFiles, getDocContent, getFileContent, searchFiles, getRecentFiles, formatForPrompt, isAvailable, needsDrive };
