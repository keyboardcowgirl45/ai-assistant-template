const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Sanitize a user message into a clean search query.
 * Strips noise, truncates to reasonable length for Brave API.
 */
function sanitizeQuery(rawMessage) {
  // Take first 200 chars max
  let q = rawMessage.slice(0, 200);
  // Remove URLs
  q = q.replace(/https?:\/\/\S+/g, '');
  // Remove Discord mentions, emojis, special chars
  q = q.replace(/<[^>]+>/g, '').replace(/[^\w\s'-]/g, ' ');
  // Collapse whitespace
  q = q.replace(/\s+/g, ' ').trim();
  // If still too long, take first 120 chars at word boundary
  if (q.length > 120) {
    q = q.slice(0, 120).replace(/\s\S*$/, '');
  }
  return q;
}

/**
 * Search the web using Brave Search API.
 * Returns a formatted string of top results for injection into Claude's prompt.
 */
async function searchWeb(query, count = 5) {
  if (!BRAVE_API_KEY) {
    console.warn('[search] No BRAVE_SEARCH_API_KEY set');
    return null;
  }

  const cleanQuery = sanitizeQuery(query);
  if (cleanQuery.length < 3) {
    console.warn('[search] Query too short after sanitization, skipping');
    return null;
  }

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(cleanQuery)}&count=${count}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    });

    if (!response.ok) {
      console.error(`[search] Brave API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const results = [];

    // Include answer box if present
    if (data.query && data.query.altered) {
      results.push(`(Brave corrected query to: "${data.query.altered}")`);
    }

    // Include infobox if present (good for weather, quick facts)
    if (data.infobox && data.infobox.results && data.infobox.results.length > 0) {
      for (const info of data.infobox.results) {
        if (info.description) {
          results.push(`[Infobox] ${info.title || ''}: ${info.description}`);
        }
      }
    }

    // Web results
    if (data.web && data.web.results) {
      for (const r of data.web.results.slice(0, count)) {
        const snippet = r.description || r.extra_snippets?.[0] || '';
        results.push(`[${r.title}] ${snippet} (${r.url})`);
      }
    }

    if (results.length === 0) {
      return null;
    }

    return results.join('\n\n');
  } catch (err) {
    console.error(`[search] Error: ${err.message}`);
    return null;
  }
}

/**
 * Heuristic: does this message likely need a web search?
 * Tightened to reduce false positives — Janet has Claude tools for deeper research.
 */
function needsSearch(message) {
  const msg = message.toLowerCase();

  // Skip short conversational messages
  if (msg.length < 10) return false;

  // Skip search for calendar-related questions (handled by calendar module)
  const calendarPhrases = [
    'my schedule', 'my calendar', 'what do i have', 'what\'s on',
    'any meetings', 'any events', 'my agenda', 'am i free',
  ];
  if (calendarPhrases.some(p => msg.includes(p))) return false;

  // Skip search for bot/system tasks (Janet can do these herself)
  const selfTasks = [
    'install', 'update', 'restart', 'edit', 'create', 'delete', 'run',
    'write a', 'modify', 'change', 'fix', 'set up', 'configure',
    'remind me', 'add to', 'journal', 'remember',
  ];
  if (selfTasks.some(t => msg.includes(t))) return false;

  // Explicit search triggers — tightened list
  const triggers = [
    'weather', 'forecast', 'temperature',
    'news', 'latest news',
    'price of', 'how much does', 'how much is',
    'what time is it in', 'when is', 'when does',
    'who won', 'score', 'results of',
    'search for', 'look up', 'google', 'find out',
    'what happened', 'what is happening',
    'stock price', 'market',
    'flight', 'flight status',
    'review of', 'rating',
    'where is', 'directions to',
    'right now', 'at the moment',
    'can you find', 'can you check',
    'what do you know about',
  ];

  return triggers.some(t => msg.includes(t));
}

module.exports = { searchWeb, needsSearch, sanitizeQuery };
