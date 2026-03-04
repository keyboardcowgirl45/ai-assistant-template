# CLAUDE.md — Personal AI Assistant Bot

## What This Is

A personal AI assistant running on a dedicated machine, accessible 24/7 via Discord. Powered by Claude via Claude Code CLI.

## Tech Stack

- **Runtime:** Node.js
- **Entry point:** `bot.js`
- **Start command:** `npm start` (runs `node bot.js`)
- **Key dependencies:**
  - `discord.js` — Discord integration
  - `@anthropic-ai/claude-agent-sdk` — Claude AI backbone
  - `googleapis` — Google Calendar and Drive
  - `dotenv` — environment variable management

## Key Files

| File | Purpose |
|------|---------|
| `bot.js` | Main bot logic and Discord event handling |
| `claude-runner.js` | Handles Claude Code CLI process management |
| `claude-tracker.js` | Tracks Claude usage |
| `calendar.js` | Google Calendar integration |
| `drive.js` | Google Drive integration |
| `gmail-reader.js` | Gmail reading |
| `memory.js` | Short-term memory (last 20 turns) |
| `long-memory.js` | Persistent long-term memory |
| `memsearch-bridge.js` | Semantic memory search |
| `oura.js` | Oura Ring health data |
| `health-trends.js` | Health trend analysis |
| `reminders.js` | Reminder management |
| `deadlines.js` | Deadline tracking |
| `ideas.js` | Idea capture |
| `journal.js` | Journaling |
| `search.js` | Web search (Brave) |
| `weather.js` | Weather lookups |
| `crypto.js` | BTC/ETH price tracking |
| `imagen.js` | Image generation (Gemini) |
| `IDENTITY.md` | Bot's role and persona |
| `SOUL.md` | Bot's personality and values |
| `USER.md` | Owner's profile, preferences, context |
| `MEMORY.md` | Active curated memory |
| `system-prompt.txt` | System prompt fed to Claude |

## Setup

See `SETUP-GUIDE.md` for the full setup walkthrough, including API key configuration.

## Secrets (Never Commit)

The following are in `.gitignore` and must never be committed:
- `.env` — API keys and tokens
- `google-credentials.json` / `google-token.json` — OAuth credentials
- `memory.json` / `long-memory.json` — live memory state
- `node_modules/`

## Coding Conventions

- Plain JavaScript (no TypeScript)
- Keep modules single-purpose and small
- Prefer simple git-based rollback over parallel module complexity
- Stability wins — do not replace working things without clear reason
