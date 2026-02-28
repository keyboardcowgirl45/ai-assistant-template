# CLAUDE.md — JanetBot

## What This Is

Janet is KS's (Karen Seah's) personal AI assistant, running on a Mac Mini (`janet.bot`) and accessible 24/7 via Discord. This repo is the bot's codebase.

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
| `claude-runner.js` | Handles Claude API calls |
| `claude-tracker.js` | Tracks Claude usage |
| `calendar.js` | Google Calendar integration |
| `drive.js` | Google Drive integration |
| `gmail-reader.js` | Gmail reading |
| `memory.js` | Short-term memory |
| `long-memory.js` | Persistent long-term memory |
| `memsearch-bridge.js` | Memory search |
| `oura.js` | Oura Ring health data |
| `granola.js` | Granola meeting notes |
| `health-trends.js` | Health trend analysis |
| `reminders.js` | Reminder management |
| `deadlines.js` | Deadline tracking |
| `ideas.js` | Idea capture |
| `journal.js` | Journaling |
| `search.js` | Web search |
| `weather.js` | Weather lookups |
| `crypto.js` | BTC/ETH price tracking |
| `imagen.js` | Image generation |
| `ollama-fallback.js` | Ollama local model fallback |
| `IDENTITY.md` | Janet's role and persona |
| `SOUL.md` | Janet's personality and values |
| `USER.md` | KS's profile, preferences, context |
| `MEMORY.md` | Janet's active memory |
| `system-prompt.txt` | System prompt fed to Claude |

## Secrets (Never Commit)

The following are in `.gitignore` and must never be committed:
- `.env` — API keys and tokens
- `google-credentials.json` / `google-token.json` — OAuth credentials
- `memory.json` — live memory state
- `node_modules/`

## Deployment Workflow

- **Development** happens on the MacBook (`ks`) in this cloned repo (`~/Desktop/JanetClone`)
- **Changes** are pushed to GitHub (`keyboardcowgirl45/janet-discord-bot`)
- **Janet (Mac Mini)** pulls from GitHub and restarts the bot
- Do NOT edit files directly on Janet — always go through GitHub

## Who KS Is

- Serial entrepreneur: Refinery Media, X3D Studio, Gengis AI
- Location: Singapore
- Not a coding expert — learning as she goes. Explain, don't assume knowledge.
- Direct communication style: no fluff, no throat-clearing
- Discuss before building — talk through approach before implementing
- Always present tradeoffs, not just features
- Prefers stability over bleeding edge
- Confirm task completion — don't go silent after finishing

## Coding Conventions

- Plain JavaScript (no TypeScript)
- Keep modules single-purpose and small
- Prefer simple git-based rollback over parallel module complexity
- No automatic behaviours unless KS explicitly requested them
- Stability wins — do not replace working things without clear reason
