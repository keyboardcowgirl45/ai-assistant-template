/**
 * Granola Meeting Notes Integration.
 * Fetches meeting notes, action items, and decisions from Granola API.
 *
 * Requires GRANOLA_API_KEY in .env (Bearer token from Granola app).
 * To find it: Granola app > View > Toggle Developer Tools > Network tab >
 * any request > Authorization header > copy token after "Bearer ".
 *
 * API: https://api.granola.ai
 */

const GRANOLA_API_KEY = process.env.GRANOLA_API_KEY || '';
const GRANOLA_API_BASE = 'https://api.granola.ai';
const GRANOLA_HEADERS = {
  'Authorization': `Bearer ${GRANOLA_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'User-Agent': 'Granola/5.354.0',
  'X-Client-Version': '5.354.0',
};

/**
 * Check if Granola integration is available.
 */
function isAvailable() {
  return !!GRANOLA_API_KEY;
}

/**
 * Fetch recent meeting documents from Granola.
 * @param {number} limit - Max documents to fetch
 * @returns {Array} Meeting documents
 */
async function fetchRecentMeetings(limit = 10) {
  if (!GRANOLA_API_KEY) return [];

  try {
    const response = await fetch(`${GRANOLA_API_BASE}/v2/get-documents`, {
      method: 'POST',
      headers: GRANOLA_HEADERS,
      body: JSON.stringify({
        limit,
        offset: 0,
        include_last_viewed_panel: true,
      }),
    });

    if (!response.ok) {
      console.warn(`[granola] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.docs || [];
  } catch (err) {
    console.warn(`[granola] Error fetching meetings: ${err.message}`);
    return [];
  }
}

/**
 * Get a specific meeting document with full content.
 * @param {string} documentId - Granola document ID
 * @returns {Object|null} Document data
 */
async function getMeetingById(documentId) {
  if (!GRANOLA_API_KEY) return null;

  try {
    const response = await fetch(`${GRANOLA_API_BASE}/v1/get-documents-batch`, {
      method: 'POST',
      headers: GRANOLA_HEADERS,
      body: JSON.stringify({
        document_ids: [documentId],
        include_last_viewed_panel: true,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const docs = data.documents || data.docs || [];
    return docs[0] || null;
  } catch (err) {
    console.warn(`[granola] Error fetching meeting: ${err.message}`);
    return null;
  }
}

/**
 * Get meeting transcript.
 * @param {string} documentId - Granola document ID
 * @returns {Array} Transcript entries
 */
async function getMeetingTranscript(documentId) {
  if (!GRANOLA_API_KEY) return [];

  try {
    const response = await fetch(`${GRANOLA_API_BASE}/v1/get-document-transcript`, {
      method: 'POST',
      headers: GRANOLA_HEADERS,
      body: JSON.stringify({ document_id: documentId }),
    });

    if (!response.ok) return [];
    return await response.json();
  } catch (err) {
    console.warn(`[granola] Error fetching transcript: ${err.message}`);
    return [];
  }
}

/**
 * Format recent meetings for prompt injection.
 * Extracts titles, dates, and key content from recent meetings.
 * @param {Array} meetings - Array of Granola document objects
 * @returns {string} Formatted meeting context
 */
function formatForPrompt(meetings) {
  if (!meetings || meetings.length === 0) return '';

  const lines = [];
  for (const m of meetings) {
    const title = m.title || 'Untitled Meeting';
    const date = m.created_at ? m.created_at.split('T')[0] : 'unknown date';
    const attendees = (m.people || []).map(p => p.name || p.email).filter(Boolean).join(', ');

    let line = `- ${title} (${date})`;
    if (attendees) line += ` — with ${attendees}`;

    // Include markdown content summary if available (first 200 chars)
    if (m.markdown) {
      const summary = m.markdown.substring(0, 200).replace(/\n/g, ' ').trim();
      line += `\n  Notes: ${summary}${m.markdown.length > 200 ? '...' : ''}`;
    }

    lines.push(line);
  }

  return `KS's recent Granola meetings:\n${lines.join('\n')}`;
}

module.exports = { isAvailable, fetchRecentMeetings, getMeetingById, getMeetingTranscript, formatForPrompt };
