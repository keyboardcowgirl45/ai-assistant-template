const fs = require('fs');
const path = require('path');

const JOURNAL_DIR = path.join(__dirname, 'journals');

// Ensure journal directory exists
if (!fs.existsSync(JOURNAL_DIR)) {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
}

function todaySGT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function journalPath(date) {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function loadDay(date) {
  const fp = journalPath(date || todaySGT());
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { date: date || todaySGT(), entries: [] };
  }
}

function saveDay(data) {
  fs.writeFileSync(journalPath(data.date), JSON.stringify(data, null, 2));
}

/**
 * Add a journal entry for today.
 * Categories: idea, issue, decision, followup
 */
function addEntry(category, text) {
  const date = todaySGT();
  const data = loadDay(date);
  const time = new Date().toLocaleTimeString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  data.entries.push({ time, category, text });
  saveDay(data);
  console.log(`[journal] Logged ${category}: ${text.substring(0, 60)}...`);
}

/**
 * Get today's journal summary grouped by category.
 */
function getTodaySummary() {
  const data = loadDay(todaySGT());
  if (data.entries.length === 0) return null;

  const groups = {};
  for (const entry of data.entries) {
    if (!groups[entry.category]) groups[entry.category] = [];
    groups[entry.category].push(entry);
  }

  const labels = {
    idea: 'Ideas',
    issue: 'Issues',
    decision: 'Decisions',
    followup: 'Follow-ups'
  };

  const lines = [];
  for (const [cat, entries] of Object.entries(groups)) {
    const label = labels[cat] || cat;
    lines.push(`**${label}:**`);
    for (const e of entries) {
      lines.push(`- [${e.time}] ${e.text}`);
    }
  }

  return { count: data.entries.length, summary: lines.join('\n') };
}

/**
 * Get pending count for nudge purposes.
 */
function getPendingCount() {
  const data = loadDay(todaySGT());
  return data.entries.length;
}

/**
 * Format for prompt injection — tells Claude about pending journal items.
 */
function formatForPrompt() {
  const count = getPendingCount();
  if (count === 0) return '';
  return `KS has ${count} journal entries logged today. She can ask for a summary anytime (e.g., "what did we cover today?" or "daily summary").`;
}

module.exports = { addEntry, getTodaySummary, getPendingCount, formatForPrompt };
