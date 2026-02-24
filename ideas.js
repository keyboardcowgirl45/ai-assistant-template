/**
 * Idea Parking Lot — persistent storage for ideas KS wants to revisit.
 * Unlike journal entries (daily, auto-tagged), these are explicit "park this"
 * captures that persist until KS reviews or dismisses them.
 *
 * Structure:
 * [
 *   {
 *     id: "abc123",
 *     text: "AI-driven shot list generation from script",
 *     company: "refinery",
 *     created: "2026-02-21T10:00:00.000Z",
 *     reviewed: false,
 *     reviewedAt: null
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');

const IDEAS_FILE = path.join(__dirname, 'ideas.json');

function ensureFile() {
  if (!fs.existsSync(IDEAS_FILE)) {
    fs.writeFileSync(IDEAS_FILE, JSON.stringify([], null, 2));
  }
}

function loadAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(ideas) {
  fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideas, null, 2));
}

/**
 * Park a new idea.
 * @param {string} text - The idea
 * @param {string} company - Optional company attribution
 */
function parkIdea(text, company = '') {
  const ideas = loadAll();
  const entry = {
    id: Date.now().toString(36),
    text,
    company: company.toLowerCase(),
    created: new Date().toISOString(),
    reviewed: false,
    reviewedAt: null,
  };
  ideas.push(entry);
  save(ideas);
  console.log(`[ideas] Parked: "${text}" (company: ${company || 'general'})`);
  return entry;
}

/**
 * Mark an idea as reviewed/dismissed.
 */
function reviewIdea(searchText) {
  const ideas = loadAll();
  const lower = searchText.toLowerCase();
  const found = ideas.find(i => !i.reviewed && i.text.toLowerCase().includes(lower));
  if (found) {
    found.reviewed = true;
    found.reviewedAt = new Date().toISOString();
    save(ideas);
    console.log(`[ideas] Reviewed: "${found.text}"`);
    return found;
  }
  return null;
}

/**
 * Get all unreviewed ideas.
 */
function getUnreviewed() {
  return loadAll().filter(i => !i.reviewed);
}

/**
 * Format unreviewed ideas for prompt injection.
 * Only included when there are parked ideas.
 */
function formatForPrompt() {
  const ideas = getUnreviewed();
  if (ideas.length === 0) return '';

  const lines = ideas.map(i => {
    const company = i.company ? ` [${i.company}]` : '';
    const date = i.created.split('T')[0];
    return `- ${i.text}${company} (parked: ${date})`;
  });

  return `Parked ideas (${ideas.length}):\n${lines.join('\n')}`;
}

/**
 * Process Claude's response for idea tags.
 * [PARK_IDEA: description | company: name]
 * [IDEA_REVIEWED: search text]
 */
function processResponse(response) {
  let cleaned = response;

  // Park ideas
  const parkPattern = /\[PARK_IDEA:\s*(.+?)(?:\s*\|\s*company:\s*(.+?))?\s*\]/gi;
  let match;
  while ((match = parkPattern.exec(response)) !== null) {
    parkIdea(match[1], match[2] || '');
    cleaned = cleaned.replace(match[0], '');
  }

  // Review/dismiss ideas
  const reviewPattern = /\[IDEA_REVIEWED:\s*(.+?)\s*\]/gi;
  while ((match = reviewPattern.exec(response)) !== null) {
    reviewIdea(match[1]);
    cleaned = cleaned.replace(match[0], '');
  }

  return cleaned.trim();
}

module.exports = { parkIdea, reviewIdea, getUnreviewed, formatForPrompt, processResponse };
