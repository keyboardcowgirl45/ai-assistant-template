/**
 * Deadline Tracker — tracks project deadlines mentioned in conversation.
 * These are separate from reminders — they're implicit deadlines Janet picks up
 * from context, with company/project attribution.
 *
 * Structure:
 * [
 *   {
 *     id: "abc123",
 *     text: "Refinery shoot schedule needs to be locked",
 *     company: "refinery",
 *     deadline: "2026-02-28",
 *     created: "2026-02-21T10:00:00.000Z",
 *     done: false,
 *     nudgedAt: null
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');

const DEADLINES_FILE = path.join(__dirname, 'deadlines.json');

function ensureFile() {
  if (!fs.existsSync(DEADLINES_FILE)) {
    fs.writeFileSync(DEADLINES_FILE, JSON.stringify([], null, 2));
  }
}

function loadAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DEADLINES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(deadlines) {
  fs.writeFileSync(DEADLINES_FILE, JSON.stringify(deadlines, null, 2));
}

/**
 * Add a deadline.
 * @param {string} text - What needs to happen
 * @param {string} deadline - ISO date (YYYY-MM-DD)
 * @param {string} company - Company name (refinery, x3d, gengis, personal)
 */
function addDeadline(text, deadline, company = '') {
  const deadlines = loadAll();
  const entry = {
    id: Date.now().toString(36),
    text,
    company: company.toLowerCase(),
    deadline,
    created: new Date().toISOString(),
    done: false,
    nudgedAt: null,
  };
  deadlines.push(entry);
  save(deadlines);
  console.log(`[deadlines] Added: "${text}" (deadline: ${deadline}, company: ${company})`);
  return entry;
}

/**
 * Mark a deadline as done by partial text match.
 */
function completeDeadline(searchText) {
  const deadlines = loadAll();
  const lower = searchText.toLowerCase();
  const found = deadlines.find(d => !d.done && d.text.toLowerCase().includes(lower));
  if (found) {
    found.done = true;
    found.completedAt = new Date().toISOString();
    save(deadlines);
    console.log(`[deadlines] Completed: "${found.text}"`);
    return found;
  }
  return null;
}

/**
 * Get deadlines approaching within N days.
 * @param {number} withinDays - How many days ahead to look
 * @returns {Array} Approaching deadlines with days remaining
 */
function getApproaching(withinDays = 7) {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const cutoff = new Date(now.getTime() + withinDays * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  return loadAll()
    .filter(d => !d.done && d.deadline >= todayStr && d.deadline <= cutoff)
    .map(d => {
      const deadlineDate = new Date(d.deadline + 'T00:00:00+08:00');
      const todayDate = new Date(todayStr + 'T00:00:00+08:00');
      const daysLeft = Math.ceil((deadlineDate - todayDate) / 86400000);
      return { ...d, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Get overdue deadlines.
 */
function getOverdue() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  return loadAll().filter(d => !d.done && d.deadline < todayStr);
}

/**
 * Get all pending deadlines.
 */
function getPending() {
  return loadAll().filter(d => !d.done);
}

/**
 * Mark a deadline as nudged (so we don't spam about it).
 */
function markNudged(id) {
  const deadlines = loadAll();
  const found = deadlines.find(d => d.id === id);
  if (found) {
    found.nudgedAt = new Date().toISOString();
    save(deadlines);
  }
}

/**
 * Format approaching deadlines for prompt injection.
 * Only included when there are upcoming deadlines.
 */
function formatForPrompt() {
  const approaching = getApproaching(7);
  const overdue = getOverdue();

  if (approaching.length === 0 && overdue.length === 0) return '';

  const lines = [];

  if (overdue.length > 0) {
    lines.push('OVERDUE:');
    for (const d of overdue) {
      const company = d.company ? ` [${d.company}]` : '';
      lines.push(`- ${d.text}${company} — was due ${d.deadline}`);
    }
  }

  if (approaching.length > 0) {
    lines.push('Coming up:');
    for (const d of approaching) {
      const company = d.company ? ` [${d.company}]` : '';
      const urgency = d.daysLeft <= 2 ? ' ⚠️' : '';
      lines.push(`- ${d.text}${company} — ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} left (${d.deadline})${urgency}`);
    }
  }

  return `Project deadlines:\n${lines.join('\n')}`;
}

/**
 * Format for heartbeat — includes nudge-worthy items.
 * Returns items that haven't been nudged today.
 */
function formatForHeartbeat() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const approaching = getApproaching(3); // tighter window for proactive nudges
  const overdue = getOverdue();

  const nudgeWorthy = [...overdue, ...approaching].filter(d => {
    if (!d.nudgedAt) return true;
    return !d.nudgedAt.startsWith(todayStr);
  });

  return nudgeWorthy;
}

/**
 * Process Claude's response for deadline tags.
 * Tag format: [DEADLINE: text | date: YYYY-MM-DD | company: name]
 * Or: [DEADLINE_DONE: search text]
 */
function processResponse(response) {
  let cleaned = response;

  // Add deadlines
  const addPattern = /\[DEADLINE:\s*(.+?)\s*\|\s*date:\s*(\d{4}-\d{2}-\d{2})(?:\s*\|\s*company:\s*(.+?))?\s*\]/gi;
  let match;
  while ((match = addPattern.exec(response)) !== null) {
    addDeadline(match[1], match[2], match[3] || '');
    cleaned = cleaned.replace(match[0], '');
  }

  // Complete deadlines
  const donePattern = /\[DEADLINE_DONE:\s*(.+?)\s*\]/gi;
  while ((match = donePattern.exec(response)) !== null) {
    completeDeadline(match[1]);
    cleaned = cleaned.replace(match[0], '');
  }

  return cleaned.trim();
}

module.exports = {
  addDeadline, completeDeadline, getApproaching, getOverdue,
  getPending, markNudged, formatForPrompt, formatForHeartbeat, processResponse,
};
