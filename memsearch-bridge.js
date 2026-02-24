const { execFile } = require('child_process');
const { writeFileSync, readFileSync } = require('fs');
const path = require('path');

const MEMSEARCH_BIN = '/Users/janet.bot/.local/bin/memsearch';
const MEMORY_DIR = path.join(__dirname, 'memory');
const MEMORY_MD = path.join(__dirname, 'MEMORY.md');
const SEARCH_TIMEOUT_MS = 5000;
const INDEX_TIMEOUT_MS = 15000;

/**
 * Search indexed memory for a query string.
 * Returns formatted text suitable for prompt injection, or empty string.
 */
function searchMemory(query, maxResults = 5) {
  return new Promise((resolve) => {
    const args = ['search', query, '--top-k', String(maxResults)];
    execFile(MEMSEARCH_BIN, args, { timeout: SEARCH_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[memsearch] Search failed: ${err.message}`);
        resolve('');
        return;
      }
      const output = stdout.trim();
      if (!output || output.includes('No results')) {
        resolve('');
        return;
      }
      resolve(output);
    });
  });
}

/**
 * Format search results for prompt injection.
 */
function formatForPrompt(searchResults) {
  if (!searchResults) return '';
  return `Relevant memories (retrieved by semantic search — use naturally, don't announce):\n${searchResults}`;
}

/**
 * Index a specific file or directory.
 */
function indexPath(filePath) {
  return new Promise((resolve) => {
    execFile(MEMSEARCH_BIN, ['index', filePath], { timeout: INDEX_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        console.warn(`[memsearch] Index failed for ${filePath}: ${err.message}`);
        resolve(false);
        return;
      }
      console.log(`[memsearch] ${stdout.trim()}`);
      resolve(true);
    });
  });
}

/**
 * Write today's journal entries as markdown and re-index.
 * Called after journal tags are processed.
 */
function syncJournalToMarkdown(date) {
  const jsonPath = path.join(__dirname, 'journals', `${date}.json`);
  const mdPath = path.join(MEMORY_DIR, `${date}.md`);

  try {
    const raw = readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.entries || data.entries.length === 0) return;

    // Group entries by category
    const groups = {};
    for (const entry of data.entries) {
      const cat = entry.category.charAt(0).toUpperCase() + entry.category.slice(1);
      const plural = cat === 'Idea' ? 'Ideas' : cat === 'Issue' ? 'Issues' : cat === 'Decision' ? 'Decisions' : cat === 'Followup' ? 'Followups' : cat === 'Health' ? 'Health' : cat + 's';
      if (!groups[plural]) groups[plural] = [];
      groups[plural].push(entry.text);
    }

    // Write markdown
    let md = `# ${date}\n`;
    for (const [heading, items] of Object.entries(groups)) {
      md += `\n## ${heading}\n`;
      for (const item of items) {
        md += `- ${item}\n`;
      }
    }

    writeFileSync(mdPath, md);
    console.log(`[memsearch] Synced journal ${date} to markdown`);

    // Re-index in background (don't await)
    indexPath(mdPath);
  } catch (err) {
    console.warn(`[memsearch] Journal sync failed for ${date}: ${err.message}`);
  }
}

/**
 * Re-index all memory files (MEMORY.md + daily logs directory).
 */
function reindexAll() {
  return new Promise((resolve) => {
    execFile(MEMSEARCH_BIN, ['index', MEMORY_MD, MEMORY_DIR, '--force'], { timeout: INDEX_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        console.warn(`[memsearch] Reindex all failed: ${err.message}`);
        resolve(false);
        return;
      }
      console.log(`[memsearch] ${stdout.trim()}`);
      resolve(true);
    });
  });
}

module.exports = { searchMemory, formatForPrompt, indexPath, syncJournalToMarkdown, reindexAll };
