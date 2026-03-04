# AI Personal Assistant (Discord Bot)

A full-featured personal AI assistant that runs on Discord, powered by Claude via Claude Code CLI. It remembers your conversations, manages your calendar, tracks your health, sends emails, and learns your preferences over time.

## What You Get

- **24/7 Discord assistant** — message your bot anytime, get intelligent responses
- **Conversation memory** — short-term (last 20 turns) and persistent long-term memory
- **Google Calendar** — read your schedule and create events via chat
- **Health tracking** — Oura Ring sleep and readiness data (optional)
- **Web search** — real-time answers via Brave Search (optional)
- **Email** — send emails through Gmail (optional)
- **Google Drive** — access and reference your files (optional)
- **Reminders & deadlines** — track tasks and get nudged when things are due
- **Daily journal** — automatic conversation logging with semantic search
- **Proactive check-ins** — heartbeat system that reaches out when something needs attention
- **Image generation** — create images via Google Gemini (optional)

## Quick Start

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your keys
3. Customise the personality files (`SOUL.md`, `USER.md`, `IDENTITY.md`)
4. Run `npm install` then `npm start`

**Full setup walkthrough:** [SETUP-GUIDE.md](SETUP-GUIDE.md)

## Prerequisites

- A Mac, Linux machine, or server that can stay on
- Node.js 18+
- A [Claude Max or Team subscription](https://claude.ai) with Claude Code CLI installed
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

## File Overview

| File | What it does |
|------|-------------|
| `SETUP-GUIDE.md` | Complete setup instructions — start here |
| `.env.example` | Environment variable template |
| `SOUL.md` | Bot personality and values (customise this) |
| `IDENTITY.md` | Bot role definition (customise this) |
| `USER.md` | Owner profile and preferences (customise this) |
| `system-prompt.txt` | System prompt sent to Claude (customise this) |
| `MEMORY_INSTRUCTIONS.md` | How the memory system works |
| `bot.js` | Main bot logic |
| `claude-runner.js` | Claude Code CLI integration |

## Architecture

```
Discord message
  → bot.js (assembles context: calendar, health, memory, etc.)
    → claude-runner.js (sends to Claude Code CLI)
      → Claude responds with text + action tags
        → bot.js parses tags, executes actions, delivers clean response
```

The bot runs Claude as a persistent process, recycling every 20 exchanges. Memory, journals, and reminders persist across restarts.

## License

MIT
