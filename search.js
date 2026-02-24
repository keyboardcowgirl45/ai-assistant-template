const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Search the web using Brave Search API.
 * Returns a formatted string of top results for injection into Claude's prompt.
 */
async function searchWeb(query, count = 5) {
  if (!BRAVE_API_KEY) {
    console.warn('[search] No BRAVE_SEARCH_API_KEY set');
    return null;
  }

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${count}`;

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
 * Simple heuristic: does this message likely need a web search?
 */
function needsSearch(message) {
  const msg = message.toLowerCase();

  // Explicit search triggers
  const triggers = [
    'weather', 'forecast', 'temperature',
    'news', 'latest', 'recent', 'today', 'tomorrow', 'yesterday',
    'price', 'cost', 'how much',
    'what time', 'when is', 'when does',
    'who won', 'score', 'results',
    'search for', 'look up', 'google', 'find out',
    'what happened', 'what is happening',
    'stock', 'market',
    'flight', 'schedule',
    'review', 'rating',
    'where is', 'address', 'directions',
    'current', 'right now', 'at the moment',
    'research', 'compare', 'contrast', 'investigate',
    'can you find', 'can you check', 'check on',
    'what do you know about', 'tell me about',
    'how does', 'how do', 'how to',
    'is there', 'are there',
    'recommend', 'suggestion', 'alternative',
    'github', 'mcp', 'api',
    'porsche', 'polo',
  ];

  // Skip search for calendar-related questions (handled by calendar module)
  const calendarPhrases = [
    'my schedule', 'my calendar', 'what do i have', 'what\'s on',
    'any meetings', 'any events', 'my agenda', 'am i free',
  ];
  if (calendarPhrases.some(p => msg.includes(p))) return false;

  return triggers.some(t => msg.includes(t));
}

module.exports = { searchWeb, needsSearch };
