require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Duplicate process guard (PID file + process scan) ---
const PID_FILE = path.join(__dirname, '.bot.pid');
try {
  // Kill by PID file first
  if (fs.existsSync(PID_FILE)) {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid, 'SIGTERM'); console.log(`[bot] Killed previous bot via PID file (PID ${oldPid})`); } catch {}
    }
  }
  // Also scan for any other bot.js processes we missed (belt + suspenders)
  try {
    const psOutput = execSync('pgrep -f "node.*bot\\.js"', { encoding: 'utf8', timeout: 3000 }).trim();
    const pids = psOutput.split('\n').map(p => parseInt(p.trim(), 10)).filter(p => p && p !== process.pid);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); console.log(`[bot] Killed stale bot process (PID ${pid})`); } catch {}
    }
  } catch {} // pgrep returns non-zero if no matches — that's fine
} catch {}
fs.writeFileSync(PID_FILE, String(process.pid));
// Clean up PID file on exit
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
const { loadRecent, append } = require('./memory.js');
const { runClaude, warmup, onRecycle, flushMemory } = require('./claude-runner.js');
const { searchWeb, needsSearch } = require('./search.js');
const { formatForPrompt: formatReminders, processResponse: processReminders, getDue } = require('./reminders.js');
const { getTodayEvents, getTomorrowEvents, getUpcomingEvents, createEvent, formatForPrompt: formatCalendar, isAvailable: calendarAvailable } = require('./calendar.js');
const { getLastNightSleep, formatForPrompt: formatOura } = require('./oura.js');
const { formatForPrompt: formatLongMemory } = require('./long-memory.js');
const { addEntry: journalAdd, formatForPrompt: formatJournal } = require('./journal.js');
const { getHealthTrends, formatForPrompt: formatHealthTrends } = require('./health-trends.js');
const { formatForPrompt: formatDeadlines, formatForHeartbeat: getHeartbeatDeadlines, markNudged, processResponse: processDeadlines } = require('./deadlines.js');
const { formatForPrompt: formatIdeas, processResponse: processIdeas } = require('./ideas.js');
const { sendEmail } = require('./email.js');
const { searchMemory, formatForPrompt: formatMemsearch, syncJournalToMarkdown } = require('./memsearch-bridge.js');
const { getWeather, formatForPrompt: formatWeather, needsWeather } = require('./weather.js');
const { getRecentEmails, formatForPrompt: formatGmail, needsEmail } = require('./gmail-reader.js');
const { getCryptoPrices, formatForPrompt: formatCrypto, needsCrypto } = require('./crypto.js');
const { getRecentFiles, searchFiles: searchDrive, getDocContent, formatForPrompt: formatDrive, needsDrive } = require('./drive.js');
const { checkForUpdates: checkClaudeUpdates, formatForPrompt: formatClaudeUpdates } = require('./claude-tracker.js');
// Granola: now handled via MCP tools directly — no context injection needed

// --- Context detection (only fetch expensive data when relevant) ---
function needsCalendar(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'schedule', 'calendar', 'meeting', 'event', 'agenda',
    'what do i have', 'what\'s on', 'am i free', 'any meetings',
    'today', 'tonight', 'this evening', 'this afternoon', 'this morning',
    'tomorrow', 'next week', 'what time', 'when is', 'when do',
    'block time', 'schedule', 'book', 'cancel', 'reschedule',
    'dinner', 'lunch', 'breakfast', 'appointment',
    'busy', 'available', 'free time', 'open slot',
  ];
  return triggers.some(t => msg.includes(t));
}

function needsOura(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'sleep', 'slept', 'oura', 'ring', 'rest', 'rested',
    'tired', 'exhausted', 'fatigue', 'energy',
    'health', 'recovery', 'readiness', 'heart rate',
    'how did i', 'how was my', 'last night',
    'deep sleep', 'rem', 'wake up', 'woke up',
    'bed', 'bedtime', 'nap',
    'wellness', 'fitness', 'workout',
  ];
  return triggers.some(t => msg.includes(t));
}

function needsHealthTrends(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'trend', 'pattern', 'week', 'weekly', 'this week',
    'last week', 'how have i been', 'how am i doing',
    'sleep history', 'sleep pattern', 'health trend',
    'readiness trend', 'over time', 'getting better',
    'getting worse', 'improving', 'declining',
    'consistently', 'lately', 'recently',
  ];
  return triggers.some(t => msg.includes(t));
}

// --- Config ---
const MEMORY_TURNS = 20;
const MAX_RESPONSE_CHARS = 1950;
const BOT_TRIGGER_ON_MENTION = true;
const BOT_TRIGGER_IN_DM = true;
const ALLOWED_CHANNEL_IDS = []; // Empty = all channels
const HEARTBEAT_DELAY_MS = 30 * 60 * 1000; // 30 minutes after last message
const KS_DISCORD_ID = process.env.KS_DISCORD_ID || '';
let _heartbeatTimer = null;
let _messageInFlight = false;
const _recentMessageIds = new Set(); // dedup guard
const _briefingsSentToday = new Set(); // track which scheduled briefings have fired today

// --- Personality files (SOUL.md architecture) ---
const PROMPT_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY_INSTRUCTIONS.md',
];

function loadFile(filename) {
  try {
    return fs.readFileSync(path.join(__dirname, filename), 'utf8').trim();
  } catch {
    console.warn(`[bot] Warning: could not read ${filename}`);
    return '';
  }
}

function loadPromptFiles() {
  return PROMPT_FILES.map(loadFile).filter(Boolean).join('\n\n');
}

/**
 * Truncate a context section to a max character limit, cutting at last newline.
 */
function truncateSection(text, maxChars = 3000) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + '\n... (truncated)';
}

/**
 * Build the full prompt with all context.
 */
function buildPrompt(personality, history, searchResults, reminders, calendarContext, username, userMessage, extra, ouraContext, healthTrendsContext, memsearchContext, weatherContext, gmailContext, cryptoContext, driveContext) {  const now = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  const bootTime = _botStartTime.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: true });
  const parts = [personality, `\nCurrent date and time: ${now} SGT\nBot last restarted: ${bootTime} SGT — all code changes before this time are live.`];
  if (reminders) {
    parts.push(`\n--- ACTIVE REMINDERS ---\n${reminders}\n--- END REMINDERS ---`);
  }
  if (calendarContext) {
    parts.push(`\n--- CALENDAR ---\n${calendarContext}\n--- END CALENDAR ---`);
  }
  if (ouraContext) {
    parts.push(`\n--- HEALTH DATA ---\n${ouraContext}\n--- END HEALTH DATA ---`);
  }
  if (healthTrendsContext) {
    parts.push(`\n--- HEALTH TRENDS ---\n${truncateSection(healthTrendsContext, 2000)}\n--- END HEALTH TRENDS ---`);
  }
  if (weatherContext) {
    parts.push(`\n--- WEATHER ---\n${weatherContext}\n--- END WEATHER ---`);
  }
  if (gmailContext) {
    parts.push(`\n--- RECENT EMAILS ---\n${truncateSection(gmailContext, 3000)}\n--- END EMAILS ---`);
  }
  if (cryptoContext) {
    parts.push(`\n--- CRYPTO PRICES ---\n${cryptoContext}\n--- END CRYPTO ---`);
  }
  if (driveContext) {
    parts.push(`\n--- GOOGLE DRIVE ---\n${truncateSection(driveContext, 2000)}\n--- END DRIVE ---`);
  }
  const deadlinesContext = formatDeadlines();
  if (deadlinesContext) {
    parts.push(`\n--- PROJECT DEADLINES ---\n${deadlinesContext}\n--- END DEADLINES ---`);
  }
  const ideasContext = formatIdeas();
  if (ideasContext) {
    parts.push(`\n--- PARKED IDEAS ---\n${ideasContext}\n--- END IDEAS ---`);
  }
  const longMemory = formatLongMemory();
  if (longMemory) {
    parts.push(`\n--- LONG-TERM NOTES ---\n${longMemory}\n--- END LONG-TERM NOTES ---`);
  }
  if (memsearchContext) {
    parts.push(`\n--- SEMANTIC MEMORY (relevant past context) ---\n${truncateSection(memsearchContext, 2000)}\n--- END SEMANTIC MEMORY ---`);
  }
  const journalContext = formatJournal();
  if (journalContext) {
    parts.push(`\n--- JOURNAL ---\n${journalContext}\n--- END JOURNAL ---`);
  }
  if (history) {
    parts.push(`\n--- CONVERSATION HISTORY ---\n${history}\n--- END HISTORY ---`);
  }
  if (searchResults) {
    parts.push(`\n--- WEB SEARCH RESULTS (searched just now) ---\n${truncateSection(searchResults, 3000)}\n--- END SEARCH RESULTS ---\nUse these search results to answer KS's question. Summarize naturally — do not list URLs or say "according to search results".`);
  }
  if (extra) {
    parts.push(extra);
  }
  parts.push(`\n${username}: ${userMessage}\nJanet:`);
  return parts.join('\n');
}

/**
 * Try Claude first, fall back to Ollama if Claude fails or times out.
 */
async function getAIResponse(fullPrompt, options = {}) {
  try {
    const response = await runClaude(fullPrompt, options);
    // Check for error-like responses from claude-runner
    if (response.includes('need to restart') || response.includes('trouble starting') || response.includes('dropped the connection')) {
      throw new Error('Claude unavailable');
    }
    return { text: response, source: 'claude' };
  } catch (err) {
    console.warn(`[bot] Claude failed: ${err.message}`);
    return { text: "Something went wrong on my end — give me a moment and try again.", source: 'none' };
  }
}

/**
 * Parse and execute [CALENDAR_EVENT: ...] tags from Claude's response.
 * Tag format: [CALENDAR_EVENT: summary | date: YYYY-MM-DD | start: HH:MM | end: HH:MM | location: text]
 * Only summary and date are required. start/end/location are optional.
 */
async function processCalendarTags(response) {
  const tagRegex = /\[CALENDAR_EVENT:\s*(.+?)\]/g;
  let cleaned = response;
  let match;

  while ((match = tagRegex.exec(response)) !== null) {
    const fullTag = match[0];
    const inner = match[1];

    // Parse fields from the tag
    const parts = inner.split('|').map(s => s.trim());
    const summary = parts[0]; // first part is always the summary

    let date = '', startTime = '', endTime = '', location = '', description = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('date:')) date = p.replace('date:', '').trim();
      else if (p.startsWith('start:')) startTime = p.replace('start:', '').trim();
      else if (p.startsWith('end:')) endTime = p.replace('end:', '').trim();
      else if (p.startsWith('location:')) location = p.replace('location:', '').trim();
      else if (p.startsWith('description:')) description = p.replace('description:', '').trim();
    }

    if (summary && date) {
      const result = await createEvent({ summary, date, startTime, endTime, location, description });
      if (result.success) {
        console.log(`[bot] Created calendar event: "${summary}" on ${result.when}`);
      } else {
        console.error(`[bot] Failed to create calendar event: ${result.error}`);
      }
    } else {
      console.warn(`[bot] Invalid CALENDAR_EVENT tag — missing summary or date: ${fullTag}`);
    }

    cleaned = cleaned.replace(fullTag, '');
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse and execute [JOURNAL: category | text] tags from Claude's response.
 * Tags are stripped from the message KS sees.
 */
function processJournalTags(response) {
  const tagRegex = /\[JOURNAL:\s*(.+?)\]/g;
  let cleaned = response;
  let match;
  let found = false;

  while ((match = tagRegex.exec(response)) !== null) {
    found = true;
    const fullTag = match[0];
    const inner = match[1];
    const parts = inner.split('|').map(s => s.trim());
    const category = (parts[0] || '').toLowerCase();
    const text = parts.slice(1).join('|').trim();

    if (category && text) {
      journalAdd(category, text);
    }

    cleaned = cleaned.replace(fullTag, '');
  }

  // Sync today's journal to markdown and re-index for semantic search
  if (found) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    syncJournalToMarkdown(today);
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse and execute [EMAIL: to | subject | body] tags from Claude's response.
 * Tags are stripped from the message KS sees.
 */
async function processEmailTags(response) {
  const tagRegex = /\[EMAIL:\s*(.+?)\]/gs;
  let cleaned = response;
  let match;

  while ((match = tagRegex.exec(response)) !== null) {
    const fullTag = match[0];
    const inner = match[1];
    const parts = inner.split('|').map(s => s.trim());
    const to = parts[0];
    const subject = parts[1] || '(no subject)';
    const body = parts.slice(2).join('|').trim() || '';

    if (to && body) {
      const result = await sendEmail(to, subject, body);
      if (result.success) {
        console.log(`[bot] Sent email to ${to}: "${subject}"`);
      } else {
        console.error(`[bot] Failed to send email to ${to}: ${result.error}`);
      }
    } else {
      console.warn(`[bot] Invalid EMAIL tag — missing to or body: ${fullTag}`);
    }

    cleaned = cleaned.replace(fullTag, '');
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

let _startupNotificationSent = false;
const _botStartTime = new Date();

client.once('ready', async () => {
  console.log(`[bot] Janet is online as ${client.user.tag}`);
  console.log(`[bot] Serving ${client.guilds.cache.size} server(s)`);
  initHeartbeat();
  // Notify KS that Janet is online (delay to avoid racing with dying old process)
  if (KS_DISCORD_ID && !_startupNotificationSent) {
    _startupNotificationSent = true;
    setTimeout(async () => {
      try {
        const ksUser = await client.users.fetch(KS_DISCORD_ID);
        const dmChannel = await ksUser.createDM();
        await dmChannel.send("Back online and ready.");
        console.log('[bot] Sent online notification to KS');
      } catch (err) {
        console.error(`[bot] Failed to send online notification: ${err.message}`);
      }
    }, 3000); // 3s delay — let old process fully disconnect
  }
});

// --- Discord WebSocket health monitoring ---
client.on('shardDisconnect', (event, shardId) => {
  console.error(`[bot] Discord WebSocket disconnected (shard ${shardId}, code ${event.code}). Will auto-reconnect.`);
});
client.on('shardReconnecting', (shardId) => {
  console.log(`[bot] Discord WebSocket reconnecting (shard ${shardId})...`);
});
client.on('shardResume', (shardId, replayedEvents) => {
  console.log(`[bot] Discord WebSocket resumed (shard ${shardId}, replayed ${replayedEvents} events)`);
});
client.on('shardError', (error, shardId) => {
  console.error(`[bot] Discord WebSocket error (shard ${shardId}): ${error.message}`);
});

// Periodic WebSocket liveness check — if ws is dead for 5+ min, exit and let launchd restart
let _lastWsCheck = Date.now();
setInterval(() => {
  const wsStatus = client.ws?.status;
  // discord.js ws status: 0 = READY, 1-4 = connecting states, 5+ = disconnected
  if (wsStatus !== 0) {
    const downFor = Date.now() - _lastWsCheck;
    console.warn(`[bot] Discord WS status: ${wsStatus} (not ready for ${Math.round(downFor / 1000)}s)`);
    if (downFor > 300000) { // 5 minutes
      console.error('[bot] Discord WS dead for 5+ minutes — exiting for launchd restart');
      process.exit(1);
    }
  } else {
    _lastWsCheck = Date.now();
  }
}, 60000); // check every 60s

// --- Message handler ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user);

  if (isDM && !BOT_TRIGGER_IN_DM) return;
  if (!isDM && !isMentioned) return;
  if (!isDM && ALLOWED_CHANNEL_IDS.length > 0 && !ALLOWED_CHANNEL_IDS.includes(message.channel.id)) return;

  let userMessage = message.content;
  if (isMentioned) {
    userMessage = userMessage.replace(/<@!?\d+>/g, '').trim();
  }
  if (!userMessage) return;

  // Dedup: skip if we've already processed this exact message
  if (_recentMessageIds.has(message.id)) return;
  _recentMessageIds.add(message.id);
  // Keep the set from growing forever — prune after 100 entries
  if (_recentMessageIds.size > 100) {
    const first = _recentMessageIds.values().next().value;
    _recentMessageIds.delete(first);
  }

  const userId = message.author.id;
  const username = message.author.displayName || message.author.username;

  console.log(`[bot] Message from ${username}: ${userMessage.substring(0, 80)}...`);
  _messageInFlight = true;
  resetHeartbeatTimer();

  try { await message.channel.sendTyping(); } catch {}
  const typingInterval = setInterval(() => {
    try { message.channel.sendTyping(); } catch {}
  }, 8000);

  try {
    // Synchronous context (instant)
    const personality = loadPromptFiles();
    const history = loadRecent(userId, MEMORY_TURNS);
    const reminders = formatReminders();

    // Async context — only fetch what's relevant, all in parallel
    const asyncFetches = [];

    // Calendar (only when message is about schedule/time) — fetches today + tomorrow
    if (calendarAvailable() && needsCalendar(userMessage)) {
      console.log('[bot] Calendar context requested');
      asyncFetches.push(
        Promise.all([getTodayEvents(), getTomorrowEvents()])
          .then(([today, tomorrow]) => {
            const parts = [formatCalendar(today)];
            if (tomorrow.length > 0) {
              parts.push(formatCalendar(tomorrow, "Tomorrow's schedule"));
            }
            return { type: 'calendar', value: parts.join('\n') };
          })
          .catch(err => { console.warn(`[bot] Calendar fetch failed: ${err.message}`); return { type: 'calendar', value: '' }; })
      );
    }

    // Oura sleep data (only when message is about health/sleep)
    if (needsOura(userMessage)) {
      console.log('[bot] Oura context requested');
      asyncFetches.push(
        getLastNightSleep()
          .then(data => ({ type: 'oura', value: formatOura(data) }))
          .catch(err => { console.warn(`[bot] Oura fetch failed: ${err.message}`); return { type: 'oura', value: '' }; })
      );
    }

    // Health trends (only when asking about patterns/weekly)
    if (needsHealthTrends(userMessage)) {
      console.log('[bot] Health trends context requested');
      asyncFetches.push(
        getHealthTrends(7)
          .then(data => ({ type: 'healthTrends', value: formatHealthTrends(data) }))
          .catch(err => { console.warn(`[bot] Health trends fetch failed: ${err.message}`); return { type: 'healthTrends', value: '' }; })
      );
    }

    // Granola: handled via MCP tools — Claude queries directly when needed

    // Weather (only when asking about weather/outdoor activities)
    if (needsWeather(userMessage)) {
      console.log('[bot] Weather context requested');
      asyncFetches.push(
        getWeather()
          .then(data => ({ type: 'weather', value: data ? formatWeather(data) : '' }))
          .catch(err => { console.warn(`[bot] Weather fetch failed: ${err.message}`); return { type: 'weather', value: '' }; })
      );
    }

    // Gmail inbox (only when asking about emails)
    if (needsEmail(userMessage)) {
      console.log('[bot] Gmail inbox context requested');
      asyncFetches.push(
        getRecentEmails(2, 10)
          .then(emails => ({ type: 'gmail', value: formatGmail(emails) }))
          .catch(err => { console.warn(`[bot] Gmail fetch failed: ${err.message}`); return { type: 'gmail', value: '' }; })
      );
    }

    // Crypto prices (only when asking about crypto/bitcoin/eth)
    if (needsCrypto(userMessage)) {
      console.log('[bot] Crypto context requested');
      asyncFetches.push(
        getCryptoPrices()
          .then(data => ({ type: 'crypto', value: data ? formatCrypto(data) : '' }))
          .catch(err => { console.warn(`[bot] Crypto fetch failed: ${err.message}`); return { type: 'crypto', value: '' }; })
      );
    }

    // Google Drive (only when asking about files/documents/drive)
    if (needsDrive(userMessage)) {
      console.log('[bot] Drive context requested');
      asyncFetches.push(
        getRecentFiles(10)
          .then(files => ({ type: 'drive', value: formatDrive(files) }))
          .catch(err => { console.warn(`[bot] Drive fetch failed: ${err.message}`); return { type: 'drive', value: '' }; })
      );
    }

    // Semantic memory search (always — lightweight, local)
    asyncFetches.push(
      searchMemory(userMessage, 5)
        .then(results => ({ type: 'memsearch', value: results }))
        .catch(err => { console.warn(`[bot] Memsearch failed: ${err.message}`); return { type: 'memsearch', value: '' }; })
    );

    // Web search (only if needed)
    if (needsSearch(userMessage)) {
      console.log(`[bot] Searching web for: ${userMessage.substring(0, 60)}...`);
      asyncFetches.push(
        searchWeb(userMessage)
          .then(results => { if (results) console.log(`[bot] Got search results (${results.length} chars)`); return { type: 'search', value: results }; })
          .catch(err => { console.warn(`[bot] Search failed: ${err.message}`); return { type: 'search', value: null }; })
      );
    }

    const results = await Promise.all(asyncFetches);
    let calendarContext = '';
    let ouraContext = '';
    let searchResults = null;
    let healthTrendsContext = '';
    let memsearchContext = '';
    let weatherContext = '';
    let gmailContext = '';
    let cryptoContext = '';
    let driveContext = '';
    for (const r of results) {
      if (r.type === 'calendar') calendarContext = r.value;
      else if (r.type === 'oura') ouraContext = r.value;
      else if (r.type === 'search') searchResults = r.value;
      else if (r.type === 'healthTrends') healthTrendsContext = r.value;
      else if (r.type === 'memsearch') memsearchContext = r.value;
      else if (r.type === 'weather') weatherContext = r.value;
      else if (r.type === 'gmail') gmailContext = r.value;
      else if (r.type === 'crypto') cryptoContext = r.value;
      else if (r.type === 'drive') driveContext = r.value;
    }

    // Reminder + calendar instructions for Claude
    const reminderInstructions = `\nIf KS asks you to remind her about something, or mentions a task/to-do, embed a tag in your response: [REMINDER: description | due: YYYY-MM-DD] (due date is optional). If she says something is done, embed: [DONE: partial match text]. These tags will be processed automatically and stripped from the message she sees.

If KS asks you to add something to her calendar, schedule an event, or block time, embed this tag in your response:
[CALENDAR_EVENT: Event Title | date: YYYY-MM-DD | start: HH:MM | end: HH:MM | location: Place]
- summary (first field) and date are required
- start/end are in 24-hour format and optional (omit both for an all-day event)
- end defaults to 1 hour after start if omitted
- location is optional
- The tag will be processed automatically, the event created on KS's Google Calendar, and the tag stripped from the message she sees.
- After embedding the tag, confirm to KS what you scheduled in natural language.
- KS is in Singapore (Asia/Singapore, UTC+8). All times are SGT unless she says otherwise.

When KS shares a thought, idea, issue, or decision during conversation, log it by embedding a tag:
[JOURNAL: category | description]
Categories: idea, issue, decision, followup
- Use "idea" for things to explore, brainstorms, product concepts
- Use "issue" for problems, bugs, things that need fixing
- Use "decision" for choices KS has made
- Use "followup" for things that need action later but not right now
- You can log multiple entries in one response if KS covers several topics
- Do NOT log casual chat or greetings — only substantive items worth tracking
- The tags are stripped from the message KS sees, so write your response naturally and add the tags at the end
- If KS asks for a "daily summary" or "what did we cover today", use the journal count shown in context and compile a grouped summary of the day's entries

When KS mentions a project deadline or something that needs to happen by a specific date, track it by embedding:
[DEADLINE: description | date: YYYY-MM-DD | company: name]
- description and date are required, company is optional (use: refinery, x3d, gengis, or personal)
- When she says a deadline is met or no longer relevant: [DEADLINE_DONE: partial match text]
- These are for implicit deadlines from conversation — different from explicit reminders
- Only create a deadline when KS mentions a specific date or timeframe for something

When KS says "park this", "save this idea", "come back to this later", or explicitly wants to capture an idea for later review, embed:
[PARK_IDEA: description | company: name]
- company is optional (use: refinery, x3d, gengis, or personal)
- When she reviews or dismisses an idea: [IDEA_REVIEWED: partial match text]
- Parked ideas are shown in context — reference them naturally when relevant
- If she asks to see her parked ideas, list them from the PARKED IDEAS section

When KS asks you to send an email, embed this tag in your response:
[EMAIL: recipient@email.com | Subject Line | Email body text here]
- First field is the recipient email address (required)
- Second field is the subject line (required)
- Third field is the email body in plain text (required)
- The email will be sent from janet.bot88@gmail.com (Janet's Gmail)
- The tag will be processed automatically, the email sent, and the tag stripped from the message KS sees
- After embedding the tag, confirm to KS what you sent and to whom
- NEVER send an email without KS explicitly asking you to. Always confirm what you're about to send before embedding the tag.
- If KS asks you to draft an email, show her the draft first and only send when she approves`;

    const fullPrompt = buildPrompt(personality, history, searchResults, reminders, calendarContext, username, userMessage, reminderInstructions, ouraContext, healthTrendsContext, memsearchContext, weatherContext, gmailContext, cryptoContext, driveContext);

    const startTime = Date.now();
    const { text: rawResponse, source } = await getAIResponse(fullPrompt);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[bot] Response via ${source} in ${elapsed}s (${rawResponse.length} chars)`);

    // Process reminder tags from response
    let response = processReminders(rawResponse);

    // Process calendar event tags from response
    response = await processCalendarTags(response);

    // Process journal tags from response: [JOURNAL: category | text]
    response = processJournalTags(response);

    // Process deadline tags from response: [DEADLINE: ...] [DEADLINE_DONE: ...]
    response = processDeadlines(response);

    // Process idea tags from response: [PARK_IDEA: ...] [IDEA_REVIEWED: ...]
    response = processIdeas(response);

    // Process email tags from response: [EMAIL: to | subject | body]
    response = await processEmailTags(response);

    // Trim to Discord limit
    if (response.length > MAX_RESPONSE_CHARS) {
      response = response.substring(0, MAX_RESPONSE_CHARS) + '...';
    }

    await message.reply(response);
    append(userId, username, userMessage, response);

  } catch (err) {
    console.error(`[bot] Error: ${err.message}`);
    try {
      await message.reply("Something went wrong. Give me a moment.");
    } catch {}
  } finally {
    clearInterval(typingInterval);
    _messageInFlight = false;
  }
});

// --- Heartbeat system (rolling timer) ---

function resetHeartbeatTimer() {
  if (!KS_DISCORD_ID) return;
  if (_heartbeatTimer) clearTimeout(_heartbeatTimer);
  _heartbeatTimer = setTimeout(() => runHeartbeat(), HEARTBEAT_DELAY_MS);
  console.log(`[heartbeat] Timer reset — next check in ${HEARTBEAT_DELAY_MS / 60000} minutes`);
}

function initHeartbeat() {  // Start a periodic heartbeat that runs every 30 min regardless of messages  setInterval(() => runHeartbeat(), HEARTBEAT_DELAY_MS);  // Also do a first check 2 minutes after boot  setTimeout(() => runHeartbeat(), 2 * 60 * 1000);
  if (!KS_DISCORD_ID) {
    console.log('[heartbeat] KS_DISCORD_ID not set in .env — heartbeat disabled');
    return;
  }
  console.log(`[heartbeat] Initialized — will fire ${HEARTBEAT_DELAY_MS / 60000} min after last message`);
}

async function runHeartbeat() {
  if (_messageInFlight) {
    console.log('[heartbeat] Skipped — message in-flight, resetting timer');
    resetHeartbeatTimer();
    return;
  }

  const heartbeatPrompt = loadFile('HEARTBEAT.md');
  if (!heartbeatPrompt) return;

  const personality = loadPromptFiles();
  const history = loadRecent(KS_DISCORD_ID, MEMORY_TURNS);
  const reminders = formatReminders();
  const dueReminders = getDue();

  // Fetch calendar for heartbeat context
  let calendarContext = '';
  if (calendarAvailable()) {
    try {
      const upcoming = await getUpcomingEvents(4); // next 4 hours
      calendarContext = formatCalendar(upcoming, 'Upcoming events (next 4 hours)');
    } catch (err) {
      console.warn(`[heartbeat] Calendar fetch failed: ${err.message}`);
    }
  }

  const now = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  const parts = [personality, `\nCurrent date and time: ${now} SGT`];
  if (reminders) {
    parts.push(`\n--- ACTIVE REMINDERS ---\n${reminders}\n--- END REMINDERS ---`);
  }
  if (calendarContext) {
    parts.push(`\n--- CALENDAR ---\n${calendarContext}\n--- END CALENDAR ---`);
  }
  if (dueReminders.length > 0) {
    const dueList = dueReminders.map(r => `- ${r.text} (due: ${r.due})`).join('\n');
    parts.push(`\n--- REMINDERS DUE TODAY ---\n${dueList}\n--- END DUE ---`);
  }
  // Project deadlines approaching
  const deadlineNudges = getHeartbeatDeadlines();
  if (deadlineNudges.length > 0) {
    const deadlineList = deadlineNudges.map(d => {
      const company = d.company ? ` [${d.company}]` : '';
      const daysInfo = d.daysLeft != null ? ` — ${d.daysLeft} day(s) left` : ' — OVERDUE';
      return `- ${d.text}${company}${daysInfo} (deadline: ${d.deadline})`;
    }).join('\n');
    parts.push(`\n--- APPROACHING DEADLINES ---\n${deadlineList}\n--- END DEADLINES ---`);
  }
  if (history) {
    parts.push(`\n--- RECENT CONVERSATION HISTORY WITH KS ---\n${history}\n--- END HISTORY ---`);
  }
  parts.push(`\n--- HEARTBEAT CHECK ---\n${heartbeatPrompt}\n\nBased on the conversation history, active reminders, calendar, approaching deadlines, and what you know about KS, decide if you should reach out. If nothing needs attention, respond with exactly: HEARTBEAT_OK`);

  const fullPrompt = parts.join('\n');

  console.log('[heartbeat] Running heartbeat check...');
  const startTime = Date.now();

  try {
    const { text: response, source } = await getAIResponse(fullPrompt, { countExchange: false });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const trimmed = response.replace(/HEARTBEAT_OK/gi, '').trim();
    if (response.includes('HEARTBEAT_OK') || trimmed.length === 0) {
      console.log(`[heartbeat] OK — nothing to report (${elapsed}s via ${source})`);
    } else {
      // Process any reminder tags in heartbeat response
      const cleaned = processReminders(response);
      console.log(`[heartbeat] Janet wants to reach out (${elapsed}s): ${cleaned.substring(0, 80)}...`);
      try {
        const ksUser = await client.users.fetch(KS_DISCORD_ID);
        const dmChannel = await ksUser.createDM();
        await dmChannel.send(cleaned.substring(0, MAX_RESPONSE_CHARS));
        console.log('[heartbeat] Sent DM to KS');
      } catch (err) {
        console.error(`[heartbeat] Failed to DM KS: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[heartbeat] Error: ${err.message}`);
  }

  resetHeartbeatTimer();
}

// --- Scheduled briefings (time-based, separate from heartbeat) ---

function getSGTHour() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore", hour: "numeric", hour12: false });
}

function getSGTMinute() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore", minute: "numeric" });
}

function getSGTDateKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }); // YYYY-MM-DD
}

function checkScheduledBriefings() {
  if (!KS_DISCORD_ID || !client.isReady()) return;

  const hour = parseInt(getSGTHour(), 10);
  const minute = parseInt(getSGTMinute(), 10);
  const dateKey = getSGTDateKey();

  // Reset briefings tracker at midnight
  if (hour === 0 && minute < 5) {
    _briefingsSentToday.clear();
  }

  // Midnight — auto git commit & push
  if (hour === 0 && minute >= 0 && minute <= 5) {
    const gitKey = `${dateKey}-git-push`;
    if (!_briefingsSentToday.has(gitKey)) {
      _briefingsSentToday.add(gitKey);
      try {
        const botDir = path.join(__dirname);
        const status = execSync('git status --porcelain', { cwd: botDir, encoding: 'utf8' }).trim();
        if (status) {
          execSync('git add --ignore-errors *.js *.md *.json .gitignore journals/ memory/ store/', { cwd: botDir });
          const dateStr = new Date().toISOString().split('T')[0];
          execSync(`git commit -m "auto: nightly backup ${dateStr}"`, { cwd: botDir });
          execSync('git push', { cwd: botDir });
          console.log(`[git] Nightly push completed: ${dateStr}`);
        } else {
          console.log('[git] Nightly push skipped — no changes');
        }
      } catch (err) {
        console.error(`[git] Nightly push failed: ${err.message}`);
      }
    }
  }

  // 7:30am — Sleep briefing
  if (hour === 7 && minute >= 25 && minute <= 35) {
    const key = `${dateKey}-sleep`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runScheduledBriefing('sleep').catch(err =>
        console.error(`[briefing] Sleep briefing error: ${err.message}`)
      );
    }
  }

  // 8:30am — Granola meeting debrief + today's calendar prep
  if (hour === 8 && minute >= 25 && minute <= 35) {
    const key = `${dateKey}-granola`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runScheduledBriefing('granola-debrief').catch(err =>
        console.error(`[briefing] Granola debrief error: ${err.message}`)
      );
    }
  }

  // 10am — Claude/Anthropic announcement check
  if (hour === 10 && minute >= 0 && minute <= 10) {
    const key = `${dateKey}-claude-tracker`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runScheduledBriefing('claude-tracker').catch(err =>
        console.error(`[briefing] Claude tracker error: ${err.message}`)
      );
    }
  }

  // 9pm — Daily usage report
  if (hour === 21 && minute >= 0 && minute <= 10) {
    const key = `${dateKey}-usage`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runScheduledBriefing('usage-report').catch(err =>
        console.error(`[briefing] Usage report error: ${err.message}`)
      );
    }
  }

  // Sunday 6pm — Weekly Mounjaro check-in
  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Singapore", weekday: "long" });
  if (dayOfWeek === 'Sunday' && hour === 18 && minute >= 0 && minute <= 10) {
    const key = `${dateKey}-mounjaro`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runScheduledBriefing('mounjaro-checkin').catch(err =>
        console.error(`[briefing] Mounjaro check-in error: ${err.message}`)
      );
    }
  }

  // Sunday 8pm — Weekly memory curation
  if (dayOfWeek === 'Sunday' && hour === 20 && minute >= 0 && minute <= 10) {
    const key = `${dateKey}-memory-curation`;
    if (!_briefingsSentToday.has(key)) {
      _briefingsSentToday.add(key);
      runMemoryCuration().catch(err =>
        console.error(`[briefing] Memory curation error: ${err.message}`)
      );
    }
  }
}

async function runScheduledBriefing(type) {
  if (_messageInFlight) {
    console.log(`[briefing] Skipped ${type} — message in-flight`);
    return;
  }

  const personality = loadPromptFiles();
  const history = loadRecent(KS_DISCORD_ID, MEMORY_TURNS);
  const now = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

  const parts = [personality, `\nCurrent date and time: ${now} SGT`];

  let briefingInstructions = '';

  if (type === 'sleep') {
    // Pre-fetch Oura sleep data, crypto prices, and today's calendar for morning briefing
    let ouraContext = '';
    let cryptoContext = '';
    let calendarContext = '';
    try {
      const [sleepData, prices, todayEvents, tomorrowEvents] = await Promise.all([
        getLastNightSleep().catch(err => { console.warn(`[briefing] Oura fetch failed: ${err.message}`); return null; }),
        getCryptoPrices().catch(err => { console.warn(`[briefing] Crypto fetch failed: ${err.message}`); return null; }),
        calendarAvailable() ? getTodayEvents().catch(err => { console.warn(`[briefing] Calendar fetch failed: ${err.message}`); return []; }) : [],
        calendarAvailable() ? getTomorrowEvents().catch(err => { console.warn(`[briefing] Tomorrow calendar fetch failed: ${err.message}`); return []; }) : [],
      ]);
      ouraContext = formatOura(sleepData);
      if (prices) cryptoContext = formatCrypto(prices);
      const calParts = [formatCalendar(todayEvents)];
      if (tomorrowEvents.length > 0) calParts.push(formatCalendar(tomorrowEvents, "Tomorrow's schedule"));
      calendarContext = calParts.join('\n');
    } catch (err) {
      console.warn(`[briefing] Pre-fetch failed: ${err.message}`);
    }
    if (ouraContext) {
      parts.push(`\n--- OURA SLEEP DATA ---\n${ouraContext}\n--- END OURA ---`);
    }
    if (cryptoContext) {
      parts.push(`\n--- CRYPTO PRICES ---\n${cryptoContext}\n--- END CRYPTO ---`);
    }
    if (calendarContext) {
      parts.push(`\n--- CALENDAR ---\n${calendarContext}\n--- END CALENDAR ---`);
    }

    briefingInstructions = `
--- SCHEDULED BRIEFING: MORNING SLEEP + MARKETS ---
This is KS's 7:30am morning briefing. Cover two things:

1. **Sleep:** KS's Oura sleep data from last night is provided above. Give a brief, natural summary. Include:
   - Overall readiness and sleep score and how they compare to recent nights
   - Any standout metrics (great deep sleep, poor latency, low HRV, etc.)
   - A brief note if you notice a pattern (e.g., declining sleep quality this week)
   - Do NOT call the Oura MCP tool — the data is already in your context above.

2. **Crypto:** If crypto prices are provided above, include BTC and ETH prices with 24h change. One line each, natural tone. If prices aren't available, skip this section.

3. **Today's schedule:** If calendar data is provided above, mention what's on today (and tomorrow if shown). One line — just the highlights. If the calendar is clear, skip this.

Keep the whole briefing to 5-6 sentences max. Warm but concise — she just woke up.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
--- END BRIEFING INSTRUCTIONS ---`;
  } else if (type === 'granola-debrief') {
    // Fetch today's + tomorrow's calendar for the debrief
    let calendarContext = '';
    if (calendarAvailable()) {
      try {
        const [today, tomorrow] = await Promise.all([getTodayEvents(), getTomorrowEvents()]);
        const parts = [formatCalendar(today)];
        if (tomorrow.length > 0) parts.push(formatCalendar(tomorrow, "Tomorrow's schedule"));
        calendarContext = parts.join('\n');
      } catch (err) {
        console.warn(`[briefing] Calendar fetch failed: ${err.message}`);
      }
    }
    if (calendarContext) {
      parts.push(`\n--- TODAY'S CALENDAR ---\n${calendarContext}\n--- END CALENDAR ---`);
    }

    // Fetch AI + virtual production news for X3D
    let vpNewsContext = '';
    try {
      const vpNews = await searchWeb('AI virtual production LED volume real-time rendering Unreal Engine 2026', 5);
      if (vpNews) {
        vpNewsContext = vpNews;
      }
    } catch (err) {
      console.warn(`[briefing] VP news search failed: ${err.message}`);
    }
    if (vpNewsContext) {
      parts.push(`\n--- AI + VIRTUAL PRODUCTION NEWS ---\n${vpNewsContext}\n--- END VP NEWS ---`);
    }

    briefingInstructions = `
--- SCHEDULED BRIEFING: MORNING GRANOLA DEBRIEF ---
This is KS's 8:30am workday kickoff. Do the following:

1. **Yesterday's meetings:** Use the Granola MCP tools (query_granola_meetings or list_meetings) to pull yesterday's meetings. Surface:
   - Key decisions made
   - Action items and follow-ups assigned to KS
   - Anything left unresolved

2. **Today's prep:** Look at today's calendar (provided above). If any of today's meetings involve people or topics from recent Granola notes, flag relevant context — "Last time you met with X, you discussed Y and agreed to Z."

3. **Overdue items:** If there are action items from meetings more than 24 hours ago that haven't been addressed, flag them.

4. **AI + Virtual Production news:** If VP news results are provided above, pick the top 3 most relevant stories for X3D Studio's business (AI in virtual production, LED volumes, real-time rendering, Unreal Engine workflows). Summarize each in one sentence. If no results were found, skip this section.

Keep the debrief focused and scannable. Use bullet points for action items. Don't pad it — if yesterday was meeting-free, just say so and focus on today's prep.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
--- END BRIEFING INSTRUCTIONS ---`;
  }

  if (type === 'mounjaro-checkin') {
    briefingInstructions = `
--- SCHEDULED BRIEFING: WEEKLY MOUNJARO CHECK-IN ---
This is KS's Sunday evening Mounjaro check-in. She started Mounjaro on Tuesday Feb 17, 2026.

Ask her briefly how she's feeling this week on the medication:
- Any nausea, appetite changes, or energy shifts?
- How was her weight this week (if she wants to share)?
- Any side effects during exercise?

Keep it casual and caring — 2-3 sentences. Don't be clinical. She had nausea during polo this morning, so reference that if it's relevant.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
--- END BRIEFING INSTRUCTIONS ---`;
  }

  if (type === 'usage-report') {
    // Fetch claude-monitor usage data via Python script (not the TUI)
    let usageData = '';
    try {
      const { execSync: execSyncLocal } = require('child_process');
      const raw = execSyncLocal('/usr/bin/python3 /Users/janet.bot/discord-bot/usage-check.py max5', {
        encoding: 'utf8',
        timeout: 30000
      });
      const usage = JSON.parse(raw.trim());
      usageData = `Plan: ${usage.plan}\nTokens: ${usage.tokens.pct}% used (${usage.tokens.used.toLocaleString()} / ${usage.tokens.limit.toLocaleString()})\nCost: ${usage.cost.pct}% used ($${usage.cost.used} / $${usage.cost.limit})\nMessages: ${usage.messages.pct}% used (${usage.messages.used} / ${usage.messages.limit})`;
    } catch (err) {
      usageData = `Could not fetch usage data: ${err.message}`;
    }

    briefingInstructions = `
--- SCHEDULED BRIEFING: DAILY USAGE REPORT ---
This is KS's 9pm usage report. Summarize Claude Max subscription usage for today.

Here is the usage data:
${usageData}

Give a brief summary:
- Usage percentage (KS prefers percentage, NOT dollar amounts)
- How much of the daily allocation has been used
- If usage is high (over 70%), mention it so KS can pace accordingly

Keep it to 2-3 sentences. Casual evening tone.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
--- END BRIEFING INSTRUCTIONS ---`;
  }

  if (type === 'claude-tracker') {
    // Check for new Claude/Anthropic announcements
    let trackerContext = '';
    try {
      const updates = await checkClaudeUpdates();
      if (updates) {
        trackerContext = formatClaudeUpdates(updates);
      }
    } catch (err) {
      console.warn(`[briefing] Claude tracker check failed: ${err.message}`);
    }

    if (!trackerContext) {
      console.log('[briefing] Claude tracker: no new announcements — skipping briefing');
      return; // Don't send a message if nothing new
    }

    parts.push(`\n--- CLAUDE/ANTHROPIC UPDATES ---\n${trackerContext}\n--- END UPDATES ---`);

    briefingInstructions = `
--- SCHEDULED BRIEFING: CLAUDE/ANTHROPIC UPDATE ALERT ---
New Claude or Anthropic announcements were detected. For each item:

1. Summarize what was announced in 1-2 sentences
2. Assess relevance to our setup: Janet (Discord bot on Mac Mini, Claude Code CLI subprocess, Max subscription), KS's direct coding in Antigravity IDE, or the broader AI production pipeline
3. If something is directly useful, say so clearly. If not relevant, say so briefly.

Keep it scannable — bullet points are fine. Only include items that are genuinely new.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that only sends when there are updates.
--- END BRIEFING INSTRUCTIONS ---`;
  }

  if (history) {
    parts.push(`\n--- RECENT CONVERSATION HISTORY WITH KS ---\n${history}\n--- END HISTORY ---`);
  }
  parts.push(briefingInstructions);

  const fullPrompt = parts.join('\n');

  console.log(`[briefing] Running ${type} briefing...`);
  const startTime = Date.now();

  try {
    const { text: response, source } = await getAIResponse(fullPrompt);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[briefing] ${type} complete (${elapsed}s via ${source}): ${response.substring(0, 80)}...`);

    const ksUser = await client.users.fetch(KS_DISCORD_ID);
    const dmChannel = await ksUser.createDM();
    await dmChannel.send(response.substring(0, MAX_RESPONSE_CHARS));
    console.log(`[briefing] Sent ${type} DM to KS`);
  } catch (err) {
    console.error(`[briefing] ${type} error: ${err.message}`);
  }
}

// --- Weekly memory curation ---
async function runMemoryCuration() {
  if (_messageInFlight) {
    console.log('[curation] Skipped — message in-flight');
    return;
  }

  console.log('[curation] Running weekly memory curation...');

  // Read this week's daily logs
  const today = new Date();
  const weekLogs = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const logPath = path.join(__dirname, 'memory', `${dateStr}.md`);
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      weekLogs.push({ date: dateStr, content });
    } catch {
      // No log for this day
    }
  }

  if (weekLogs.length === 0) {
    console.log('[curation] No daily logs this week — skipping');
    return;
  }

  // Read current MEMORY.md
  const memoryMdPath = path.join(__dirname, 'MEMORY.md');
  let currentMemory = '';
  try {
    currentMemory = fs.readFileSync(memoryMdPath, 'utf8');
  } catch {
    console.warn('[curation] Could not read MEMORY.md');
  }

  const logsText = weekLogs.map(l => `### ${l.date}\n${l.content}`).join('\n\n');

  const curationPrompt = `SYSTEM: Weekly memory curation task. Review this week's daily logs and the current curated MEMORY.md. Identify important recurring patterns, decisions, preferences, or facts that should be promoted to long-term memory.

--- CURRENT MEMORY.md ---
${currentMemory}
--- END MEMORY.md ---

--- THIS WEEK'S DAILY LOGS ---
${logsText}
--- END DAILY LOGS ---

Rules:
- Only promote information that is DURABLE — preferences, decisions, recurring patterns, important facts
- Do NOT promote one-time events, session-specific issues, or things already in MEMORY.md
- Output each addition as: [MEMORY_ADD: Section Name | bullet text]
- Use existing section names from MEMORY.md where possible (e.g., "KS Health", "KS Preferences", "Architecture Decisions", "Communication Rules")
- Create new sections only if truly needed
- If nothing new deserves promotion, respond with exactly: Nothing to curate.
- Be selective — quality over quantity. 3 good entries beat 10 mediocre ones.`;

  try {
    const { text: response, source } = await getAIResponse(curationPrompt);
    console.log(`[curation] Response via ${source}: ${response.substring(0, 100)}...`);

    if (response.includes('Nothing to curate')) {
      console.log('[curation] Nothing to promote this week');
      return;
    }

    // Parse [MEMORY_ADD: section | text] tags
    const tagRegex = /\[MEMORY_ADD:\s*(.+?)\s*\|\s*(.+?)\s*\]/g;
    const additions = {};
    let match;
    while ((match = tagRegex.exec(response)) !== null) {
      const section = match[1].trim();
      const bullet = match[2].trim();
      if (!additions[section]) additions[section] = [];
      additions[section].push(bullet);
    }

    if (Object.keys(additions).length === 0) {
      console.log('[curation] No valid MEMORY_ADD tags found');
      return;
    }

    // Append to MEMORY.md
    let memoryContent = currentMemory;
    const addedItems = [];
    for (const [section, bullets] of Object.entries(additions)) {
      const sectionHeader = `## ${section}`;
      const bulletText = bullets.map(b => `- ${b}`).join('\n');

      if (memoryContent.includes(sectionHeader)) {
        // Find the end of this section (next ## or end of file)
        const sectionIdx = memoryContent.indexOf(sectionHeader);
        const nextSectionIdx = memoryContent.indexOf('\n## ', sectionIdx + sectionHeader.length);
        const insertAt = nextSectionIdx !== -1 ? nextSectionIdx : memoryContent.length;
        memoryContent = memoryContent.slice(0, insertAt) + '\n' + bulletText + '\n' + memoryContent.slice(insertAt);
      } else {
        // New section
        memoryContent += `\n\n${sectionHeader}\n${bulletText}\n`;
      }
      addedItems.push(...bullets.map(b => `**${section}:** ${b}`));
    }

    fs.writeFileSync(memoryMdPath, memoryContent);
    console.log(`[curation] Updated MEMORY.md with ${addedItems.length} new entries`);

    // Re-index
    const { indexPath } = require('./memsearch-bridge.js');
    await indexPath(memoryMdPath);

    // Notify KS
    if (KS_DISCORD_ID && client.isReady()) {
      const summary = addedItems.length <= 5
        ? addedItems.map(i => `- ${i}`).join('\n')
        : `${addedItems.length} items across ${Object.keys(additions).length} categories`;

      const ksUser = await client.users.fetch(KS_DISCORD_ID);
      const dmChannel = await ksUser.createDM();
      await dmChannel.send(`Weekly memory curation done — promoted ${addedItems.length} items to long-term memory:\n${summary}`.substring(0, MAX_RESPONSE_CHARS));
      console.log('[curation] Sent curation summary to KS');
    }
  } catch (err) {
    console.error(`[curation] Error: ${err.message}`);
  }
}

// Check scheduled briefings every 5 minutes
setInterval(checkScheduledBriefings, 5 * 60 * 1000);
// Also check 30s after boot (in case we restart right at briefing time)
setTimeout(checkScheduledBriefings, 30 * 1000);

// --- Graceful shutdown: flush memory before exit ---
let _shutdownInProgress = false;
async function gracefulShutdown(signal) {
  if (_shutdownInProgress) return;
  _shutdownInProgress = true;
  console.log(`[bot] ${signal} received — flushing memory before shutdown...`);

  try {
    const flushResponse = await flushMemory();
    if (flushResponse && !flushResponse.includes('Nothing to flush')) {
      console.log('[bot] Processing shutdown memory flush...');
      let flushed = processJournalTags(flushResponse);
      flushed = processDeadlines(flushed);
      flushed = processIdeas(flushed);
      console.log('[bot] Shutdown memory flush complete');
    } else {
      console.log('[bot] Nothing to flush on shutdown');
    }
  } catch (err) {
    console.warn(`[bot] Shutdown flush failed: ${err.message}`);
  }

  console.log('[bot] Shutting down...');
  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Start ---
console.log('[bot] Starting Janet...');
warmup();

// Notify KS when Claude process auto-recycles (not on full bot restart)
// flushResponse contains any memory flush output from the dying session
onRecycle(async (flushResponse) => {
  // Process memory flush tags if we got a response
  if (flushResponse && !flushResponse.includes('Nothing to flush')) {
    console.log('[bot] Processing memory flush tags from recycled session...');
    let flushed = processJournalTags(flushResponse);
    flushed = processDeadlines(flushed);
    flushed = processIdeas(flushed);
    // Don't process reminders, calendar, or email tags from flush — those need KS's intent
    console.log('[bot] Memory flush complete');
  }

  if (!KS_DISCORD_ID || !client.isReady()) return;
  // Don't send recycle notification within the first 30s of bot startup —
  // the startup notification already covers that case
  const uptimeMs = process.uptime() * 1000;
  if (uptimeMs < 30000) {
    console.log('[bot] Skipping recycle notification — too close to startup');
    return;
  }
  try {
    const ksUser = await client.users.fetch(KS_DISCORD_ID);
    const dmChannel = await ksUser.createDM();
    await dmChannel.send("Quick context refresh — back online and ready.");
    console.log('[bot] Sent recycle notification to KS');
  } catch (err) {
    console.error(`[bot] Failed to send recycle notification: ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
