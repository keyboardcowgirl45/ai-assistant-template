const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:14b';

/**
 * Call Ollama as a fallback when Claude CLI is unavailable.
 * Uses the Qwen 3 model already running on the Mac Mini.
 */
async function callOllama(prompt) {
  console.log(`[ollama] Falling back to ${OLLAMA_MODEL}...`);
  const startTime = Date.now();

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.7, num_ctx: 4096 },
        think: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      console.error(`[ollama] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const text = data.message?.content?.trim() || '';

    console.log(`[ollama] Response in ${elapsed}s (${text.length} chars)`);
    return text || null;
  } catch (err) {
    console.error(`[ollama] Error: ${err.message}`);
    return null;
  }
}

/**
 * Check if Ollama is available.
 */
async function isOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { callOllama, isOllamaAvailable };
