const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'long-memory.json');

/**
 * Long-term pattern memory for Janet.
 * Stores key observations, decisions, health trends, and open threads
 * that persist beyond the 20-turn conversation window.
 *
 * Structure:
 * {
 *   entries: [
 *     { date: "2026-02-21", category: "health", text: "...", },
 *     { date: "2026-02-21", category: "decision", text: "...", },
 *   ]
 * }
 *
 * Categories: health, decision, preference, project, followup
 */

function load() {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { entries: [] };
  }
}

function save(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

/**
 * Add a new long-term memory entry.
 */
function addEntry(category, text) {
  const data = load();
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  data.entries.push({ date, category, text });

  // Keep max 100 entries, trim oldest if needed
  if (data.entries.length > 100) {
    data.entries = data.entries.slice(-100);
  }

  save(data);
  console.log(`[long-memory] Added ${category}: ${text.substring(0, 60)}...`);
}

/**
 * Get recent entries for prompt injection.
 * Returns the last N entries formatted as text.
 */
function getRecent(count = 20) {
  const data = load();
  const recent = data.entries.slice(-count);
  if (recent.length === 0) return '';

  return recent.map(e => `[${e.date}] (${e.category}) ${e.text}`).join('\n');
}

/**
 * Format for prompt injection.
 */
function formatForPrompt() {
  const recent = getRecent(20);
  if (!recent) return '';
  return `Janet's long-term observations about KS (use naturally, don't announce):\n${recent}`;
}

module.exports = { addEntry, getRecent, formatForPrompt };
