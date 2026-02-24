const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_FILE = path.join(__dirname, 'google-credentials.json');
const TOKEN_FILE = path.join(__dirname, 'google-token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let _auth = null;

/**
 * Get an authenticated OAuth2 client.
 * Returns null if credentials or tokens are missing.
 */
function getAuth() {
  if (_auth) return _auth;

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.warn('[calendar] No google-credentials.json found — calendar disabled');
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
    if (!client_id || !client_secret) {
      console.warn('[calendar] Invalid credentials file');
      return null;
    }

    const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || 'http://localhost:3000/oauth2callback');

    if (!fs.existsSync(TOKEN_FILE)) {
      console.warn('[calendar] No google-token.json — run "node calendar-auth.js" to authorize');
      return null;
    }

    const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    oauth2.setCredentials(token);

    // Auto-save refreshed tokens
    oauth2.on('tokens', (tokens) => {
      const existing = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      const updated = { ...existing, ...tokens };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2));
      console.log('[calendar] Token refreshed and saved');
    });

    _auth = oauth2;
    console.log('[calendar] Google Calendar authenticated');
    return _auth;
  } catch (err) {
    console.error(`[calendar] Auth error: ${err.message}`);
    return null;
  }
}

/**
 * Get today's events from the primary calendar.
 * Returns an array of { summary, start, end, location, description }.
 */
async function getTodayEvents() {
  const auth = getAuth();
  if (!auth) return [];

  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(formatEvent);
  } catch (err) {
    console.error(`[calendar] Error fetching today: ${err.message}`);
    return [];
  }
}

/**
 * Get upcoming events (next N hours, default 24).
 */
async function getUpcomingEvents(hours = 24) {
  const auth = getAuth();
  if (!auth) return [];

  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: until.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(formatEvent);
  } catch (err) {
    console.error(`[calendar] Error fetching upcoming: ${err.message}`);
    return [];
  }
}

/**
 * Get tomorrow's events.
 */
async function getTomorrowEvents() {
  const auth = getAuth();
  if (!auth) return [];

  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfTomorrow = new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfTomorrow.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(formatEvent);
  } catch (err) {
    console.error(`[calendar] Error fetching tomorrow: ${err.message}`);
    return [];
  }
}

/**
 * Format a Google Calendar event for display.
 */
function formatEvent(event) {
  const start = event.start?.dateTime || event.start?.date || '';
  const end = event.end?.dateTime || event.end?.date || '';

  let startStr = '';
  let endStr = '';

  if (start.includes('T')) {
    const d = new Date(start);
    startStr = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
  } else {
    startStr = 'All day';
  }

  if (end.includes('T')) {
    const d = new Date(end);
    endStr = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  return {
    summary: event.summary || '(No title)',
    start: startStr,
    end: endStr,
    location: event.location || '',
    description: event.description || '',
    allDay: !start.includes('T'),
  };
}

/**
 * Format events as text for injection into a prompt.
 */
function formatForPrompt(events, label = "Today's schedule") {
  if (!events || events.length === 0) {
    return `${label}: No events scheduled. KS's calendar is clear.`;
  }

  const lines = events.map(e => {
    let line = e.allDay ? `- ${e.summary} (all day)` : `- ${e.start}–${e.end}: ${e.summary}`;
    if (e.location) line += ` @ ${e.location}`;
    return line;
  });

  return `${label}:\n${lines.join('\n')}`;
}

/**
 * Create a new calendar event.
 * @param {object} opts - { summary, date, startTime, endTime, location, description }
 *   - summary: event title (required)
 *   - date: YYYY-MM-DD (required)
 *   - startTime: HH:MM in 24h format (optional — if omitted, creates all-day event)
 *   - endTime: HH:MM in 24h format (optional — defaults to startTime + 1 hour)
 *   - location: string (optional)
 *   - description: string (optional)
 * @returns {{ success: boolean, summary: string, when: string, error?: string }}
 */
async function createEvent({ summary, date, startTime, endTime, location, description, recurrence }) {
  const auth = getAuth();
  if (!auth) return { success: false, summary, when: '', error: 'Calendar not configured' };

  const calendar = google.calendar({ version: 'v3', auth });

  try {
    let event;

    if (!startTime) {
      // All-day event
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const endDate = nextDay.toISOString().split('T')[0];

      event = {
        summary,
        start: { date },
        end: { date: endDate },
      };
    } else {
      // Timed event
      const startDT = new Date(`${date}T${startTime}:00+08:00`); // SGT
      let endDT;
      if (endTime) {
        endDT = new Date(`${date}T${endTime}:00+08:00`);
      } else {
        endDT = new Date(startDT.getTime() + 60 * 60 * 1000); // +1 hour
      }

      event = {
        summary,
        start: { dateTime: startDT.toISOString(), timeZone: 'Asia/Singapore' },
        end: { dateTime: endDT.toISOString(), timeZone: 'Asia/Singapore' },
      };
    }

    if (location) event.location = location;
    if (description) event.description = description;
    if (recurrence) event.recurrence = recurrence;

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    const when = startTime ? `${date} ${startTime}${endTime ? '–' + endTime : ''}` : `${date} (all day)`;
    console.log(`[calendar] Created event: "${summary}" on ${when}`);
    return { success: true, summary, when };
  } catch (err) {
    console.error(`[calendar] Error creating event: ${err.message}`);
    return { success: false, summary, when: '', error: err.message };
  }
}

/**
 * Check if calendar is configured and ready.
 */
function isAvailable() {
  return getAuth() !== null;
}

module.exports = { getTodayEvents, getUpcomingEvents, getTomorrowEvents, createEvent, formatForPrompt, isAvailable };
