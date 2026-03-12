/**
 * Gemini fallback module.
 * When Claude API is down, routes messages to Google Gemini API.
 *
 * Setup: Get a free API key from https://aistudio.google.com/apikey
 * Add GEMINI_API_KEY to your .env file.
 */

const GEMINI_TIMEOUT_MS = 30000;
const GEMINI_MODEL = 'gemini-2.5-flash';

// Generic fallback system prompt — customize the name and traits to match your bot
const FALLBACK_SYSTEM_PROMPT = `You are a personal AI assistant. You normally run on Claude, but right now you're running on a backup model (Gemini).

Key traits:
- You're warm, direct, and helpful
- Keep responses concise — you're chatting on Discord
- Be honest about your limitations in fallback mode

In fallback mode you cannot: access files on the host machine, read emails, use MCP tools, or access any integrations. Be upfront if asked about something you can't do right now.`;

async function callGemini(prompt, apiKey) {
  if (!apiKey) {
    throw new Error('No GEMINI_API_KEY configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: FALLBACK_SYSTEM_PROMPT }]
        },
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini HTTP ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    return text;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Gemini request timed out');
    }
    throw err;
  }
}

async function isGeminiAvailable(apiKey) {
  if (!apiKey) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}?key=${apiKey}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { callGemini, isGeminiAvailable, GEMINI_MODEL };
