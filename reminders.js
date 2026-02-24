const fs = require('fs');
const path = require('path');

const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

function ensureFile() {
  if (!fs.existsSync(REMINDERS_FILE)) {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify([], null, 2));
  }
}

function loadAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

/**
 * Add a reminder.
 * @param {string} text - What to remind about
 * @param {string|null} dueDate - ISO date string or null for "no specific time"
 */
function addReminder(text, dueDate = null) {
  const reminders = loadAll();
  const reminder = {
    id: Date.now().toString(36),
    text,
    created: new Date().toISOString(),
    due: dueDate,
    done: false,
  };
  reminders.push(reminder);
  save(reminders);
  console.log(`[reminders] Added: "${text}" (due: ${dueDate || 'no date'})`);
  return reminder;
}

/**
 * Mark a reminder as done by partial text match.
 */
function completeReminder(searchText) {
  const reminders = loadAll();
  const lower = searchText.toLowerCase();
  const found = reminders.find(r => !r.done && r.text.toLowerCase().includes(lower));
  if (found) {
    found.done = true;
    found.completedAt = new Date().toISOString();
    save(reminders);
    console.log(`[reminders] Completed: "${found.text}"`);
    return found;
  }
  return null;
}

/**
 * Get all pending (not done) reminders.
 */
function getPending() {
  return loadAll().filter(r => !r.done);
}

/**
 * Get reminders that are due (due date is today or past).
 */
function getDue() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  return loadAll().filter(r => !r.done && r.due && r.due <= todayStr);
}

/**
 * Format reminders for injection into a prompt.
 */
function formatForPrompt() {
  const pending = getPending();
  if (pending.length === 0) return '';

  const lines = pending.map(r => {
    const due = r.due ? ` (due: ${r.due})` : '';
    return `- ${r.text}${due}`;
  });

  return `KS's current reminders/to-dos:\n${lines.join('\n')}`;
}

/**
 * Parse Claude's response for reminder actions.
 * Claude can embed these tags in responses (they get stripped before sending to Discord):
 *   [REMINDER: text | due: YYYY-MM-DD]
 *   [DONE: search text]
 */
function processResponse(response) {
  let cleaned = response;

  // Add reminders
  const addPattern = /\[REMINDER:\s*(.+?)\s*(?:\|\s*due:\s*(\d{4}-\d{2}-\d{2}))?\s*\]/gi;
  let match;
  while ((match = addPattern.exec(response)) !== null) {
    addReminder(match[1], match[2] || null);
    cleaned = cleaned.replace(match[0], '');
  }

  // Complete reminders
  const donePattern = /\[DONE:\s*(.+?)\s*\]/gi;
  while ((match = donePattern.exec(response)) !== null) {
    completeReminder(match[1]);
    cleaned = cleaned.replace(match[0], '');
  }

  return cleaned.trim();
}

module.exports = { addReminder, completeReminder, getPending, getDue, formatForPrompt, processResponse };
