const fs = require('fs');
const path = require('path');

const PROJECT_DIR = __dirname;
const SESSION_FILE = path.join(PROJECT_DIR, 'store', 'session.json');
const TIMEOUT_MS = 180000;

let _queryFn = null;
let _onRecycle = null;

/**
 * Lazy-load the ESM-only Agent SDK via dynamic import.
 * This lets us keep claude-runner.js as CommonJS while using the SDK.
 */
async function getQueryFn() {
  if (!_queryFn) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    _queryFn = sdk.query;
    console.log('[claude-runner] Agent SDK loaded');
  }
  return _queryFn;
}

// --- Session persistence ---

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn(`[claude-runner] Failed to load session: ${err.message}`);
  }
  return {};
}

function saveSession(sessionId) {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId, updatedAt: Date.now() }));
  console.log(`[claude-runner] Session saved: ${sessionId.substring(0, 8)}...`);
}

/**
 * Run a single query against Claude Code via the Agent SDK.
 * Sessions are persisted in store/session.json so context carries
 * across messages and bot restarts.
 */
async function runClaude(fullPrompt) {
  const query = await getQueryFn();

  const session = loadSession();

  const options = {
    cwd: PROJECT_DIR,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['project', 'user'],
  };

  if (session.sessionId) {
    options.resume = session.sessionId;
  }

  // AbortController for timeout
  const controller = new AbortController();
  options.abortController = controller;
  const timer = setTimeout(() => {
    console.warn('[claude-runner] Response timed out — aborting');
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const q = query({ prompt: fullPrompt, options });

    let resultText = null;
    let newSessionId = null;

    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        newSessionId = msg.session_id;
      }

      if (msg.type === 'result') {
        if (!msg.is_error) {
          resultText = msg.result || '';
        } else {
          console.error(`[claude-runner] Result error: ${msg.subtype}`, msg.errors);
          resultText = msg.result || msg.errors?.join('\n') || 'Something went wrong.';
        }
      }
    }

    clearTimeout(timer);

    // Persist session ID for next message
    if (newSessionId) {
      saveSession(newSessionId);
    }

    // Strip ANSI escape codes
    const clean = (resultText || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    return clean || "...I got nothing. That's a first.";

  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError' || controller.signal.aborted) {
      console.warn('[claude-runner] Query aborted (timeout)');
      return "Sorry, I took too long thinking about that. Try again?";
    }

    // If resume failed (stale/invalid session), retry without it
    if (session.sessionId && err.message && err.message.includes('session')) {
      console.warn('[claude-runner] Session resume failed, starting fresh');
      try {
        fs.unlinkSync(SESSION_FILE);
      } catch {}
      return runClaude(fullPrompt);
    }

    console.error(`[claude-runner] Error: ${err.message}`);
    return "Something went wrong — try again in a moment.";
  }
}

/**
 * Pre-warm: with the SDK approach, we pre-load the module so the first
 * real message doesn't pay the import cost.
 */
function warmup() {
  console.log('[claude-runner] SDK mode — pre-loading module...');
  getQueryFn().catch(err => {
    console.error(`[claude-runner] Warmup failed: ${err.message}`);
  });
}

function onRecycle(callback) {
  _onRecycle = callback;
  // No process recycling with SDK — sessions persist automatically
}

async function flushMemory() {
  // Session persistence means context survives across calls.
  // No need to flush before process death — there is no persistent process.
  console.log('[claude-runner] SDK mode — sessions persist automatically, no flush needed');
  return null;
}

module.exports = { runClaude, warmup, onRecycle, flushMemory };
