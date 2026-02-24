/**
 * Health Trends — analyzes Oura Ring data over time for pattern detection.
 * Fetches multiple days of sleep data and produces trend insights.
 * Correlates sleep scores with journal entries (late meals, stress, exercise, Mounjaro).
 */

const fs = require('fs');
const path = require('path');

const OURA_API_TOKEN = process.env.OURA_API_TOKEN || '';
const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';
const JOURNAL_DIR = path.join(__dirname, 'journals');

/**
 * Fetch sleep data for a date range from Oura API.
 * @param {number} days - Number of days to look back
 * @returns {Array} Array of daily sleep entries
 */
async function fetchSleepRange(days = 7) {
  if (!OURA_API_TOKEN) return [];

  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const start = new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  try {
    const url = `${OURA_API_BASE}/daily_sleep?start_date=${start}&end_date=${end}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${OURA_API_TOKEN}` },
    });

    if (!response.ok) {
      console.warn(`[health-trends] Oura API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.warn(`[health-trends] Error fetching sleep range: ${err.message}`);
    return [];
  }
}

/**
 * Fetch readiness data for a date range from Oura API.
 * @param {number} days - Number of days to look back
 * @returns {Array} Array of daily readiness entries
 */
async function fetchReadinessRange(days = 7) {
  if (!OURA_API_TOKEN) return [];

  const end = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const start = new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  try {
    const url = `${OURA_API_BASE}/daily_readiness?start_date=${start}&end_date=${end}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${OURA_API_TOKEN}` },
    });

    if (!response.ok) {
      console.warn(`[health-trends] Readiness API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (err) {
    console.warn(`[health-trends] Error fetching readiness: ${err.message}`);
    return [];
  }
}

/**
 * Analyze sleep data and produce trend insights.
 * @param {Array} sleepData - Array of daily sleep entries from Oura
 * @returns {Object} Trend analysis
 */
function analyzeSleepTrends(sleepData) {
  if (!sleepData || sleepData.length < 2) return null;

  const scores = sleepData.map(d => ({ day: d.day, score: d.score, contributors: d.contributors || {} }));
  const avgScore = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);

  // Find poor nights (score < 70)
  const poorNights = scores.filter(s => s.score < 70);
  // Find great nights (score >= 85)
  const greatNights = scores.filter(s => s.score >= 85);

  // Check trend direction (last 3 vs first 3, if enough data)
  let trend = 'stable';
  if (scores.length >= 5) {
    const recentAvg = scores.slice(-3).reduce((sum, s) => sum + s.score, 0) / 3;
    const earlierAvg = scores.slice(0, 3).reduce((sum, s) => sum + s.score, 0) / 3;
    const diff = recentAvg - earlierAvg;
    if (diff > 5) trend = 'improving';
    else if (diff < -5) trend = 'declining';
  }

  // Find weakest contributor across the period
  const contributorKeys = ['deep_sleep', 'rem_sleep', 'efficiency', 'latency', 'restfulness', 'total_sleep'];
  const contributorAvgs = {};
  for (const key of contributorKeys) {
    const vals = scores.map(s => s.contributors[key]).filter(v => v != null);
    if (vals.length > 0) {
      contributorAvgs[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  const weakest = Object.entries(contributorAvgs).sort((a, b) => a[1] - b[1])[0];
  const strongest = Object.entries(contributorAvgs).sort((a, b) => b[1] - a[1])[0];

  return {
    days: scores.length,
    avgScore,
    trend,
    poorNights: poorNights.length,
    greatNights: greatNights.length,
    scores: scores.map(s => ({ day: s.day, score: s.score })),
    weakest: weakest ? { name: formatContributorName(weakest[0]), avg: weakest[1] } : null,
    strongest: strongest ? { name: formatContributorName(strongest[0]), avg: strongest[1] } : null,
    contributorAvgs,
  };
}

/**
 * Format contributor key into readable name.
 */
function formatContributorName(key) {
  const names = {
    deep_sleep: 'deep sleep',
    rem_sleep: 'REM sleep',
    efficiency: 'sleep efficiency',
    latency: 'sleep latency',
    restfulness: 'restfulness',
    total_sleep: 'total sleep time',
  };
  return names[key] || key;
}

/**
 * Health signal keywords to scan for in journal entries.
 * Each signal maps a day's events to the NEXT night's sleep score.
 */
const HEALTH_SIGNALS = {
  late_meal: {
    label: 'late meal',
    patterns: [/late\s+(meal|dinner|eat|food|supper)/i, /ate\s+late/i, /eating?\s+late/i, /late\s+night\s+(eat|meal|food)/i],
  },
  stress: {
    label: 'stress',
    patterns: [/stress(ed|ful)?/i, /anxious/i, /wired/i, /couldn'?t\s+(relax|wind\s+down)/i],
  },
  polo: {
    label: 'polo',
    patterns: [/polo/i],
  },
  workout: {
    label: 'workout',
    patterns: [/work\s*out/i, /exercise[ds]?/i, /gym/i, /training/i, /fitness/i],
  },
  alcohol: {
    label: 'alcohol',
    patterns: [/alcohol/i, /drink(s|ing)?/i, /wine/i, /beer/i, /cocktail/i],
  },
  mounjaro: {
    label: 'Mounjaro',
    patterns: [/mounjaro/i, /monjaro/i, /tirzepatide/i],
  },
  nausea: {
    label: 'nausea',
    patterns: [/nause(a|ous)/i, /sick\s+to/i, /queasy/i],
  },
};

/**
 * Load journal entries for a specific date.
 */
function loadJournalDay(date) {
  const fp = path.join(JOURNAL_DIR, `${date}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return { date, entries: [] };
  }
}

/**
 * Scan a day's journal entries for health signals.
 * @param {string} date - YYYY-MM-DD
 * @returns {string[]} Array of detected signal labels
 */
function detectSignals(date) {
  const journal = loadJournalDay(date);
  const detected = new Set();

  for (const entry of journal.entries) {
    const text = entry.text || '';
    for (const [key, signal] of Object.entries(HEALTH_SIGNALS)) {
      if (signal.patterns.some(p => p.test(text))) {
        detected.add(key);
      }
    }
  }

  return [...detected];
}

/**
 * Correlate journal signals with sleep scores.
 * Maps each day's signals to that night's sleep score (next day's Oura data).
 * @param {Array} sleepData - Oura sleep entries
 * @param {number} days - Number of days to look back
 * @returns {Object} Correlation results
 */
function correlateSignalsWithSleep(sleepData, days = 7) {
  if (!sleepData || sleepData.length < 2) return null;

  const scoreByDate = {};
  for (const d of sleepData) {
    scoreByDate[d.day] = d.score;
  }

  // For each day in the range, detect signals and pair with that night's sleep
  const daySignals = [];
  for (let i = days; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    // Next day's sleep score reflects this night's sleep
    const nextDate = new Date(Date.now() - (i - 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const signals = detectSignals(date);
    const sleepScore = scoreByDate[nextDate];

    if (sleepScore != null) {
      daySignals.push({ date, signals, sleepScore });
    }
  }

  if (daySignals.length === 0) return null;

  // Calculate average sleep score for days WITH vs WITHOUT each signal
  const signalStats = {};
  const allScores = daySignals.map(d => d.sleepScore);
  const overallAvg = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

  for (const key of Object.keys(HEALTH_SIGNALS)) {
    const withSignal = daySignals.filter(d => d.signals.includes(key));
    const withoutSignal = daySignals.filter(d => !d.signals.includes(key));

    if (withSignal.length > 0 && withoutSignal.length > 0) {
      const avgWith = Math.round(withSignal.reduce((sum, d) => sum + d.sleepScore, 0) / withSignal.length);
      const avgWithout = Math.round(withoutSignal.reduce((sum, d) => sum + d.sleepScore, 0) / withoutSignal.length);
      const diff = avgWith - avgWithout;

      signalStats[key] = {
        label: HEALTH_SIGNALS[key].label,
        count: withSignal.length,
        avgWith,
        avgWithout,
        diff,
        dates: withSignal.map(d => d.date),
      };
    } else if (withSignal.length > 0) {
      // Signal present but no comparison days — still worth noting
      const avgWith = Math.round(withSignal.reduce((sum, d) => sum + d.sleepScore, 0) / withSignal.length);
      signalStats[key] = {
        label: HEALTH_SIGNALS[key].label,
        count: withSignal.length,
        avgWith,
        avgWithout: null,
        diff: null,
        dates: withSignal.map(d => d.date),
      };
    }
  }

  return {
    daySignals,
    signalStats,
    overallAvg,
    totalDays: daySignals.length,
  };
}

/**
 * Format correlation insights as readable text.
 */
function formatCorrelations(correlations) {
  if (!correlations) return '';

  const lines = [];
  const { signalStats, overallAvg, totalDays } = correlations;

  const meaningful = Object.values(signalStats)
    .filter(s => s.diff != null && Math.abs(s.diff) >= 3)
    .sort((a, b) => a.diff - b.diff); // worst impact first

  if (meaningful.length === 0 && Object.keys(signalStats).length === 0) return '';

  lines.push(`\nCorrelations (${totalDays} days analyzed, avg sleep: ${overallAvg}):`);

  for (const stat of meaningful) {
    const direction = stat.diff > 0 ? '+' : '';
    const emoji = stat.diff < -5 ? '!!' : stat.diff < 0 ? '!' : '';
    lines.push(`  ${stat.label} (${stat.count}x): sleep ${direction}${stat.diff} pts vs days without ${emoji}`);
  }

  // Note signals detected but not enough data to compare
  const noCompare = Object.values(signalStats).filter(s => s.diff == null);
  if (noCompare.length > 0) {
    const labels = noCompare.map(s => `${s.label} (${s.count}x, avg sleep ${s.avgWith})`);
    lines.push(`  Noted but too few data points: ${labels.join(', ')}`);
  }

  if (totalDays < 14) {
    lines.push(`  (Early data — patterns become reliable after 2-3 weeks)`);
  }

  return lines.join('\n');
}

/**
 * Generate a complete health trend report.
 * @param {number} days - Number of days to analyze
 * @returns {string|null} Formatted trend report for prompt injection
 */
async function getHealthTrends(days = 7) {
  const [sleepData, readinessData] = await Promise.all([
    fetchSleepRange(days),
    fetchReadinessRange(days),
  ]);

  if (sleepData.length === 0 && readinessData.length === 0) return null;

  const lines = [];

  // Sleep trends
  const sleepTrends = analyzeSleepTrends(sleepData);
  if (sleepTrends) {
    lines.push(`Sleep (last ${sleepTrends.days} days):`);
    lines.push(`  Average score: ${sleepTrends.avgScore}/100 | Trend: ${sleepTrends.trend}`);

    if (sleepTrends.poorNights > 0) {
      lines.push(`  Poor nights (<70): ${sleepTrends.poorNights} of ${sleepTrends.days}`);
    }
    if (sleepTrends.greatNights > 0) {
      lines.push(`  Great nights (85+): ${sleepTrends.greatNights} of ${sleepTrends.days}`);
    }

    // Daily scores
    const scoreList = sleepTrends.scores.map(s => `${s.day}: ${s.score}`).join(', ');
    lines.push(`  Daily: ${scoreList}`);

    if (sleepTrends.weakest) {
      lines.push(`  Weakest area: ${sleepTrends.weakest.name} (avg ${sleepTrends.weakest.avg})`);
    }
    if (sleepTrends.strongest) {
      lines.push(`  Strongest area: ${sleepTrends.strongest.name} (avg ${sleepTrends.strongest.avg})`);
    }
  }

  // Journal-sleep correlations
  if (sleepData.length > 0) {
    const correlations = correlateSignalsWithSleep(sleepData, days);
    const correlationText = formatCorrelations(correlations);
    if (correlationText) {
      lines.push(correlationText);
    }
  }

  // Readiness trends
  if (readinessData.length > 0) {
    const readinessScores = readinessData.map(d => ({ day: d.day, score: d.score }));
    const avgReadiness = Math.round(readinessScores.reduce((sum, s) => sum + s.score, 0) / readinessScores.length);

    lines.push('');
    lines.push(`Readiness (last ${readinessScores.length} days):`);
    lines.push(`  Average score: ${avgReadiness}/100`);
    const readinessList = readinessScores.map(s => `${s.day}: ${s.score}`).join(', ');
    lines.push(`  Daily: ${readinessList}`);
  }

  return lines.join('\n');
}

/**
 * Format health trends for prompt injection.
 */
function formatForPrompt(trendsData) {
  if (!trendsData) return '';
  return `KS's health trends (from Oura Ring):\n${trendsData}`;
}

module.exports = { getHealthTrends, formatForPrompt };
