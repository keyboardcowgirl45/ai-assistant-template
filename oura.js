const OURA_API_TOKEN = process.env.OURA_API_TOKEN || '';
const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function ouraFetch(endpoint, params) {
  if (!OURA_API_TOKEN) return null;
  const qs = new URLSearchParams(params).toString();
  const url = `${OURA_API_BASE}/${endpoint}?${qs}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${OURA_API_TOKEN}` },
  });
  if (!response.ok) {
    console.warn(`[oura] ${endpoint} API error: ${response.status}`);
    return null;
  }
  const data = await response.json();
  return (data.data && data.data.length > 0) ? data.data : null;
}

/**
 * Fetch last night's sleep data from Oura API.
 * Returns formatted string for prompt injection, or null if unavailable.
 */
async function getLastNightSleep() {
  if (!OURA_API_TOKEN) return null;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  try {
    // Fetch all three endpoints in parallel
    const [dailySleep, readiness, sleepSessions] = await Promise.all([
      ouraFetch('daily_sleep', { start_date: yesterday, end_date: today }),
      ouraFetch('daily_readiness', { start_date: yesterday, end_date: today }),
      ouraFetch('sleep', { start_date: yesterday, end_date: today }),
    ]);

    // Get today's daily sleep score (Oura tags by wake-up date)
    // Only use today's data — never fall back to yesterday's stale scores
    const sleepDay = dailySleep?.find(d => d.day === today) || null;
    const readinessDay = readiness?.find(d => d.day === today) || null;

    // Find the main overnight sleep session (longest, tagged today)
    const mainSession = sleepSessions
      ?.filter(s => s.day === today && s.type !== 'rest')
      ?.sort((a, b) => (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0))?.[0];

    if (!sleepDay && !readinessDay && !mainSession) {
      return 'Oura is still processing last night\'s sleep data — not ready yet.';
    }

    const lines = [];

    if (readinessDay) {
      lines.push(`Readiness: ${readinessDay.score}/100 (${readinessDay.day})`);
    }
    if (sleepDay) {
      const c = sleepDay.contributors || {};
      lines.push(`Sleep Score: ${sleepDay.score}/100`);
      lines.push(`  Contributors — Deep: ${c.deep_sleep || '?'} | REM: ${c.rem_sleep || '?'} | Efficiency: ${c.efficiency || '?'} | Latency: ${c.latency || '?'} | Total: ${c.total_sleep || '?'}`);
    }
    if (mainSession) {
      lines.push(`Session: ${mainSession.bedtime_start?.slice(11, 16) || '?'} → ${mainSession.bedtime_end?.slice(11, 16) || '?'}`);
      lines.push(`  Total sleep: ${fmtDuration(mainSession.total_sleep_duration)} | Deep: ${fmtDuration(mainSession.deep_sleep_duration)} | REM: ${fmtDuration(mainSession.rem_sleep_duration)} | Light: ${fmtDuration(mainSession.light_sleep_duration)}`);
      if (mainSession.average_hrv || mainSession.average_heart_rate || mainSession.lowest_heart_rate) {
        lines.push(`  HRV: ${mainSession.average_hrv || '?'} | Avg HR: ${mainSession.average_heart_rate || '?'} | Lowest HR: ${mainSession.lowest_heart_rate || '?'}`);
      }
    }

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
