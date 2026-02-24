const OURA_API_TOKEN = process.env.OURA_API_TOKEN || '';
const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';

/**
 * Fetch last night's sleep data from Oura API.
 * Returns formatted string for prompt injection, or null if unavailable.
 */
async function getLastNightSleep() {
  if (!OURA_API_TOKEN) return null;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  try {
    const url = `${OURA_API_BASE}/daily_sleep?start_date=${yesterday}&end_date=${today}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${OURA_API_TOKEN}` },
    });

    if (!response.ok) {
      console.warn(`[oura] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.data || data.data.length === 0) return null;

    // Get the most recent entry
    const latest = data.data[data.data.length - 1];
    const c = latest.contributors || {};

    const lines = [
      `Sleep Score: ${latest.score}/100 (${latest.day})`,
      `  Deep sleep: ${c.deep_sleep || '?'} | REM: ${c.rem_sleep || '?'} | Efficiency: ${c.efficiency || '?'}`,
      `  Latency: ${c.latency || '?'} | Restfulness: ${c.restfulness || '?'} | Total sleep: ${c.total_sleep || '?'}`,
    ];

    return lines.join('\n');
  } catch (err) {
    console.warn(`[oura] Error fetching sleep data: ${err.message}`);
    return null;
  }
}

/**
 * Format Oura data for prompt injection.
 */
function formatForPrompt(sleepData) {
  if (!sleepData) return '';
  return `KS's last night sleep (from Oura Ring):\n${sleepData}`;
}

module.exports = { getLastNightSleep, formatForPrompt };
