/**
 * Claude/Anthropic announcement tracker.
 * Checks GitHub release feeds + Brave Search for new announcements.
 * Only alerts when something new is found.
 */

const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { searchWeb } = require('./search.js');

const STATE_FILE = path.join(__dirname, 'store', 'claude-tracker-state.json');

const FEEDS = [
  {
    name: 'Claude Code Releases',
    url: 'https://github.com/anthropics/claude-code/releases.atom',
    type: 'github',
  },
  {
    name: 'Anthropic SDK Releases',
    url: 'https://github.com/anthropics/anthropic-sdk-python/releases.atom',
    type: 'github',
  },
  {
    name: 'Claude Status',
    url: 'https://status.anthropic.com/history.rss',
    type: 'status',
  },
];

/**
 * Load tracker state (last-seen item IDs per feed + last search results).
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn(`[claude-tracker] Error loading state: ${err.message}`);
  }
  return { feeds: {}, lastSearchHashes: [], lastCheck: null };
}

/**
 * Save tracker state.
 */
function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[claude-tracker] Error saving state: ${err.message}`);
  }
}

/**
 * Simple hash for deduplicating search results.
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Check all feeds for new items since last check.
 * Returns array of { source, title, link, date, summary }.
 */
async function checkFeeds(state) {
  const parser = new Parser({ timeout: 10000 });
  const newItems = [];

  for (const feed of FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      const lastSeenId = state.feeds[feed.name]?.lastId;
      const lastSeenDate = state.feeds[feed.name]?.lastDate;

      const items = (result.items || []).slice(0, 5); // Only check recent items

      let foundNew = false;
      for (const item of items) {
        const itemId = item.id || item.guid || item.link;
        const itemDate = item.isoDate || item.pubDate;

        // Skip if we've seen this item before
        if (lastSeenId && itemId === lastSeenId) break;
        if (lastSeenDate && itemDate && new Date(itemDate) <= new Date(lastSeenDate)) break;

        newItems.push({
          source: feed.name,
          title: item.title || 'Untitled',
          link: item.link || '',
          date: itemDate || new Date().toISOString(),
          summary: (item.contentSnippet || item.content || '').slice(0, 300),
        });
        foundNew = true;
      }

      // Update state with latest item
      if (items.length > 0) {
        const latest = items[0];
        state.feeds[feed.name] = {
          lastId: latest.id || latest.guid || latest.link,
          lastDate: latest.isoDate || latest.pubDate || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn(`[claude-tracker] Feed error (${feed.name}): ${err.message}`);
    }
  }

  return newItems;
}

/**
 * Run a Brave Search sweep for recent Anthropic announcements.
 * Returns new results not seen before.
 */
async function checkBraveSearch(state) {
  const newItems = [];

  try {
    const query = 'Anthropic Claude announcement OR release OR update 2026';
    const results = await searchWeb(query, 5);

    if (!results) return newItems;

    // Parse search results (they come as formatted text from search.js)
    const lines = results.split('\n').filter(l => l.trim());
    const currentHashes = [];

    for (const line of lines) {
      const hash = simpleHash(line);
      currentHashes.push(hash);

      if (!state.lastSearchHashes.includes(hash)) {
        // Extract title from the search result line
        const titleMatch = line.match(/^[\d.]*\s*(.+?)(?:\s*[-—|]|$)/);
        newItems.push({
          source: 'Brave Search',
          title: titleMatch ? titleMatch[1].trim() : line.slice(0, 100),
          link: '',
          date: new Date().toISOString(),
          summary: line.slice(0, 300),
        });
      }
    }

    state.lastSearchHashes = currentHashes;
  } catch (err) {
    console.warn(`[claude-tracker] Brave Search error: ${err.message}`);
  }

  return newItems;
}

/**
 * Main check function. Returns new announcements or null if nothing new.
 * Call this from scheduled briefings.
 */
async function checkForUpdates() {
  const state = loadState();
  const isFirstRun = !state.lastCheck;

  const feedItems = await checkFeeds(state);
  const searchItems = await checkBraveSearch(state);

  state.lastCheck = new Date().toISOString();
  saveState(state);

  // On first run, just seed the state — don't flood KS with old items
  if (isFirstRun) {
    console.log(`[claude-tracker] First run — seeded state with ${Object.keys(state.feeds).length} feeds, ${state.lastSearchHashes.length} search results`);
    return null;
  }

  const allNew = [...feedItems, ...searchItems];
  if (allNew.length === 0) return null;

  return allNew;
}

/**
 * Format new announcements for briefing prompt injection.
 */
function formatForBriefing(items) {
  if (!items || items.length === 0) return '';

  const lines = ['New Claude/Anthropic updates detected:'];
  for (const item of items) {
    const date = new Date(item.date).toLocaleDateString('en-SG');
    lines.push(`- [${item.source}] ${item.title} (${date})`);
    if (item.summary) {
      lines.push(`  ${item.summary.slice(0, 150)}`);
    }
  }
  lines.push('');
  lines.push('Assess each item for relevance to our setup (Janet on Mac Mini, Discord bot, Claude Code CLI, Max subscription).');

  return lines.join('\n');
}

/**
 * Format for prompt injection into scheduled briefings.
 */
function formatForPrompt(items) {
  return formatForBriefing(items);
}

module.exports = { checkForUpdates, formatForBriefing, formatForPrompt };
