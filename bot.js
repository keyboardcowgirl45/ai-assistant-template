require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Duplicate process guard ---
// Kill any other node bot.js processes before we start
try {
  const myPid = process.pid;
  const psOutput = execSync("ps aux | grep 'node.*bot\\.js' | grep -v grep", { encoding: 'utf8' });
  const lines = psOutput.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[1], 10);
    if (pid && pid !== myPid) {
      console.log(`[bot] Killing duplicate bot process (PID ${pid})`);
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
} catch {
  // No other processes found — good
}
const { loadRecent, append } = require('./memory.js');
const { runClaude, warmup, onRecycle, flushMemory } = require('./claude-runner.js');
const { searchWeb, needsSearch } = require('./search.js');
const { formatForPrompt: formatReminders, processResponse: processReminders, getDue } = require('./reminders.js');
const { callOllama } = require('./ollama-fallback.js');
const { getTodayEvents, getUpcomingEvents, createEvent, formatForPrompt: formatCalendar, isAvailable: calendarAvailable } = require('./calendar.js');
const { getLastNightSleep, formatForPrompt: formatOura } = require('./oura.js');
const { formatForPrompt: formatLongMemory } = require('./long-memory.js');
const { addEntry: journalAdd, formatForPrompt: formatJournal } = require('./journal.js');
const { getHealthTrends, formatForPrompt: formatHealthTrends } = require('./health-trends.js');
const { formatForPrompt: formatDeadlines, formatForHeartbeat: getHeartbeatDeadlines, markNudged, processResponse: processDeadlines } = require('./deadlines.js');
const { formatForPrompt: formatIdeas, processResponse: processIdeas } = require('./ideas.js');
const { sendEmail } = require('./email.js');
const { searchMemory, formatForPrompt: formatMemsearch, syncJournalToMarkdown } = require('./memsearch-bridge.js');
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
 * Build the full prompt with all context.
 */
function buildPrompt(personality, history, searchResults, reminders, calendarContext, username, userMessage, extra, ouraContext, healthTrendsContext, memsearchContext) {  const now = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  const parts = [personality, `\nCurrent date and time: ${now} SGT`];
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
    parts.push(`\n--- HEALTH TRENDS ---\n${healthTrendsContext}\n--- END HEALTH TRENDS ---`);
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
    parts.push(`\n--- SEMANTIC MEMORY (relevant past context) ---\n${memsearchContext}\n--- END SEMANTIC MEMORY ---`);
  }
  const journalContext = formatJournal();
  if (journalContext) {
    parts.push(`\n--- JOURNAL ---\n${journalContext}\n--- END JOURNAL ---`);
  }
  if (history) {
    parts.push(`\n--- CONVERSATION HISTORY ---\n${history}\n--- END HISTORY ---`);
  }
  if (searchResults) {
    parts.push(`\n--- WEB SEARCH RESULTS (searched just now) ---\n${searchResults}\n--- END SEARCH RESULTS ---\nUse these search results to answer KS's question. Summarize naturally — do not list URLs or say "according to search results".`);
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
async function getAIResponse(fullPrompt) {
  try {
    const response = await runClaude(fullPrompt);
    // Check for error-like responses from claude-runner
    if (response.includes('need to restart') || response.includes('trouble starting') || response.includes('dropped the connection')) {
      throw new Error('Claude unavailable');
    }
    return { text: response, source: 'claude' };
  } catch (err) {
    console.warn(`[bot] Claude failed: ${err.message}, trying Ollama...`);
    const ollamaResponse = await callOllama(fullPrompt);
    if (ollamaResponse) {
      return { text: ollamaResponse, source: 'ollama' };
    }
    return { text: "Both my brain and my backup brain are down. Give me a minute to reboot.", source: 'none' };
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

    // Calendar (only when message is about schedule/time)
    if (calendarAvailable() && needsCalendar(userMessage)) {
      console.log('[bot] Calendar context requested');
      asyncFetches.push(
        getTodayEvents()
          .then(events => ({ type: 'calendar', value: formatCalendar(events) }))
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
    for (const r of results) {
      if (r.type === 'calendar') calendarContext = r.value;
      else if (r.type === 'oura') ouraContext = r.value;
      else if (r.type === 'search') searchResults = r.value;
      else if (r.type === 'healthTrends') healthTrendsContext = r.value;
      else if (r.type === 'memsearch') memsearchContext = r.value;
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

    const fullPrompt = buildPrompt(personality, history, searchResults, reminders, calendarContext, username, userMessage, reminderInstructions, ouraContext, healthTrendsContext, memsearchContext);

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
    const { text: response, source } = await getAIResponse(fullPrompt);
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
          execSync('git add -A', { cwd: botDir });
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
    briefingInstructions = `
--- SCHEDULED BRIEFING: MORNING SLEEP ---
This is KS's 7:30am sleep briefing. Pull her Oura sleep data from last night and give a brief, natural summary. Include:
- Overall sleep score and how it compares to recent nights
- Any standout metrics (great deep sleep, poor latency, etc.)
- A brief note if you notice a pattern (e.g., declining sleep quality this week)

Keep it to 3-4 sentences max. Warm but concise — she just woke up.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
--- END BRIEFING INSTRUCTIONS ---`;
  } else if (type === 'granola-debrief') {
    // Fetch today's calendar for the debrief
    let calendarContext = '';
    if (calendarAvailable()) {
      try {
        const events = await getTodayEvents();
        calendarContext = formatCalendar(events);
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
    // Fetch claude-monitor usage data by running it briefly and capturing output
    let usageData = '';
    try {
      const { execSync: execSyncLocal } = require('child_process');
      // Run monitor and capture its TUI output (10s Node.js timeout as safety net)
      const raw = execSyncLocal('/Users/janet.bot/.local/pipx/venvs/claude-monitor/bin/claude-monitor --plan max5 2>&1 || true', {
        encoding: 'utf8',
        timeout: 10000
      });
      // Strip ANSI codes and TUI control sequences
      usageData = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n]/g, '').trim();
      // Keep just the first frame (before any screen clears)
      const lines = usageData.split('\n').filter(l => l.trim());
      usageData = lines.slice(0, 30).join('\n');
    } catch (err) {
      usageData = `Could not fetch usage data: ${err.message}`;
    }

    briefingInstructions = `
--- SCHEDULED BRIEFING: DAILY USAGE REPORT ---
This is KS's 9pm usage report. Summarize Claude Max subscription usage for today.

Here is the raw output from claude-monitor:
${usageData}

Give a brief summary:
- Usage percentage (KS prefers percentage, NOT dollar amounts)
- How much of the daily allocation has been used
- If usage is high (over 70%), mention it so KS can pace accordingly

Keep it to 2-3 sentences. Casual evening tone.
Do NOT say HEARTBEAT_OK. This is a scheduled briefing that always sends.
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
