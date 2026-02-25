const { spawn } = require('child_process');

const CLAUDE_PATH = '/opt/homebrew/bin/claude';
const TIMEOUT_MS = 180000;
const FLUSH_TIMEOUT_MS = 30000; // 30s timeout for memory flush
const MAX_EXCHANGES = 20; // auto-restart process after this many exchanges

const FLUSH_PROMPT = `SYSTEM: This session is about to end. Review the conversation and identify any important context that has NOT already been captured in journal tags or long-term notes during this session. Look for:
- Decisions KS made that weren't journaled
- Operational state changes (restarts, deployments, config changes)
- Preferences expressed but not noted
- Action items or followups mentioned but not tracked
- Health updates not yet recorded

Output each item as a tag:
[JOURNAL: category | description]

Categories: idea, issue, decision, followup

If everything important was already captured during the conversation, respond with exactly: Nothing to flush.

Be brief — only capture what would genuinely be lost.`;

let _proc = null;
let _buffer = '';
let _waiting = null; // { resolve, timer, lines }
let _queue = []; // queue for messages that arrive while one is in-flight
let _exchangeCount = 0;
let _onRecycle = null; // callback when process is recycled

/**
 * Spawn a persistent Claude Code CLI process using stream-json mode.
 * The process stays alive between messages — only the first call is slow.
 *
 * No tools enabled — web search is handled externally via Brave Search API
 * and injected into the prompt before sending to Claude.
 */
function ensureProcess() {
  if (_proc && !_proc.killed) return;

  console.log('[claude-runner] Spawning persistent Claude process...');
  _proc = spawn(CLAUDE_PATH, [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--allowedTools', 'mcp__claude_ai_Granola__*,mcp__oura__*',
  ], {
    env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  _proc.stdout.on('data', (chunk) => {
    _buffer += chunk.toString();
    processBuffer();
  });

  _proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.log(`[claude-runner] stderr: ${msg}`);
  });

  _proc.on('close', (code) => {
    console.log(`[claude-runner] Process exited with code ${code}`);
    _proc = null;
    // Resolve any waiting request
    if (_waiting) {
      clearTimeout(_waiting.timer);
      _waiting.resolve("Something went wrong — I need to restart. Try again in a moment.");
      _waiting = null;
    }
    // Reject anything in the queue
    for (const queued of _queue) {
      queued.resolve("I had to restart. Try again?");
    }
    _queue = [];
  });

  _proc.on('error', (err) => {
    console.error(`[claude-runner] Process error: ${err.message}`);
    _proc = null;
  });
}

function processBuffer() {
  const lines = _buffer.split('\n');
  _buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    if (!_waiting) continue;

    try {
      const msg = JSON.parse(line);
      _waiting.lines.push(msg);

      if (msg.type === 'result') {
        clearTimeout(_waiting.timer);
        const result = msg.result || '';
        const clean = result.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        _waiting.resolve(clean || "...I got nothing. That's a first.");
        _waiting = null;
        // Process next in queue
        processQueue();
      }
    } catch {
      // Not valid JSON, skip
    }
  }
}

/**
 * Process the next queued message if nothing is in-flight.
 */
function processQueue() {
  if (_waiting || _queue.length === 0) return;

  const next = _queue.shift();
  sendMessage(next.prompt, next.resolve, next.timeout);
}

/**
 * Actually send a message to the Claude process.
 */
function sendMessage(fullPrompt, resolve, timeoutMs) {
  const timer = setTimeout(() => {
    console.warn('[claude-runner] Response timed out');
    _waiting = null;
    resolve("Sorry, I took too long thinking about that. Try again?");
    processQueue();
  }, timeoutMs || TIMEOUT_MS);

  _waiting = { resolve, timer, lines: [] };

  const msg = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: fullPrompt }],
    },
  });

  try {
    _proc.stdin.write(msg + '\n');
  } catch (err) {
    clearTimeout(timer);
    _waiting = null;
    console.error(`[claude-runner] Write error: ${err.message}`);
    _proc = null;
    resolve("I dropped the connection. Try again?");
  }
}

/**
 * Promise-based wrapper around sendMessage for internal use.
 */
function sendAndWait(prompt, timeoutMs) {
  return new Promise((resolve) => {
    sendMessage(prompt, resolve, timeoutMs || TIMEOUT_MS);
  });
}

/**
 * Send a memory flush prompt to the current process before recycling.
 * Returns the flush response (which may contain journal tags to process).
 */
async function flushMemory() {
  if (!_proc || _proc.killed || _waiting) return null;

  console.log('[claude-runner] Sending memory flush before recycle...');
  try {
    const response = await sendAndWait(FLUSH_PROMPT, FLUSH_TIMEOUT_MS);
    console.log(`[claude-runner] Memory flush response: ${response.substring(0, 100)}...`);
    return response;
  } catch (err) {
    console.warn(`[claude-runner] Memory flush failed: ${err.message}`);
    return null;
  }
}

/**
 * Send a prompt to the persistent Claude process and await the response.
 * If a message is already in-flight, this queues up and waits its turn.
 */
async function runClaude(fullPrompt) {
  // Auto-recycle: if we've hit the exchange limit, flush memory then kill and respawn
  if (_proc && !_proc.killed && _exchangeCount >= MAX_EXCHANGES && !_waiting) {
    console.log(`[claude-runner] Auto-recycling after ${_exchangeCount} exchanges`);

    // Memory flush: ask Claude to dump un-persisted context before we kill the process
    const flushResponse = await flushMemory();

    _proc.kill();
    _proc = null;
    _exchangeCount = 0;
    if (_onRecycle) _onRecycle(flushResponse);
  }

  return new Promise((resolve) => {
    ensureProcess();

    if (!_proc || _proc.killed) {
      resolve("I'm having trouble starting up. Give me a moment.");
      return;
    }

    // If something is already in-flight, queue this message
    if (_waiting) {
      console.log('[claude-runner] Message queued (another in-flight)');
      _queue.push({ prompt: fullPrompt, resolve, timeout: TIMEOUT_MS });
      return;
    }

    _exchangeCount++;
    console.log(`[claude-runner] Exchange ${_exchangeCount}/${MAX_EXCHANGES}`);
    sendMessage(fullPrompt, resolve);
  });
}

/**
 * Pre-warm: spawn the process immediately so the first real message is fast.
 */
function warmup() {
  console.log('[claude-runner] Pre-warming Claude process...');
  ensureProcess();
}

function onRecycle(callback) {
  _onRecycle = callback;
}

module.exports = { runClaude, warmup, onRecycle, flushMemory };
