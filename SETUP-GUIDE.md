# Personal AI Assistant — Setup Guide

This guide walks you through setting up your own 24/7 personal AI assistant on Discord, powered by Claude. No coding experience required — just follow the steps.

---

## What You're Building

A personal AI assistant that:
- Lives in your Discord DMs, available 24/7
- Remembers your conversations and learns your preferences
- Manages your calendar, sends emails, tracks reminders
- Searches the web for you
- Proactively checks in (heartbeat) every 30 minutes
- Runs on a dedicated machine (Mac Mini, old laptop, cloud server, etc.)

---

## Prerequisites

Before you start, you need:

1. **A machine that stays on 24/7** — Mac Mini, old laptop, or cloud server
2. **A Claude Max subscription** ($100/mo from anthropic.com) — this powers the AI brain
3. **A Discord account** — where you'll talk to your assistant
4. **Node.js v18+** — the runtime for the bot code

### Install Node.js

```bash
# macOS (using Homebrew)
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Check it worked
node --version  # Should show v18 or higher
```

### Install Claude Code

```bash
# Install Claude Code CLI globally
npm install -g @anthropic-ai/claude-code

# Authenticate with your Claude Max account
claude auth login
```

Follow the prompts to log in. This connects Claude Code to your subscription — no separate API key needed.

---

## Step 1: Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **"New Application"** → name it whatever you want (e.g., "Janet", "Jarvis", "Friday")
3. Go to the **Bot** tab:
   - Click **"Reset Token"** → copy and save the token (you'll need it soon)
   - Enable **"Message Content Intent"** under Privileged Gateway Intents
4. Go to the **OAuth2** tab:
   - Under **Scopes**, check `bot`
   - Under **Bot Permissions**, check: `Send Messages`, `Read Message History`, `Manage Messages`
   - Copy the generated URL and open it in your browser to invite the bot to your server

### Get Your Discord User ID

1. In Discord, go to **Settings → Advanced → Developer Mode** (turn it on)
2. Right-click your own username anywhere in Discord
3. Click **"Copy User ID"** — save this number

---

## Step 2: Download the Code

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Install dependencies
npm install
```

---

## Step 3: Configure Environment Variables

```bash
# Copy the example env file
cp .env.example .env
```

Open `.env` in any text editor and fill in the required values:

```
DISCORD_TOKEN=paste_your_discord_bot_token_here
BOT_NAME=YourBotName
KS_DISCORD_ID=paste_your_discord_user_id_here
```

The rest are optional — enable them as you need features:

**Recommended (Gemini fallback):**

| Variable | What It Does | Where to Get It |
|----------|-------------|----------------|
| `GEMINI_API_KEY` | Fallback brain when Claude is down + image generation | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free) |

Claude has occasional outages. Without Gemini configured, your bot goes completely silent during downtime. Setting this up takes 30 seconds and is free.

**Optional features:**

| Variable | What It Does | Where to Get It |
|----------|-------------|----------------|
| `BRAVE_SEARCH_API_KEY` | Web search | [brave.com/search/api](https://brave.com/search/api/) (free tier available) |
| `OURA_API_TOKEN` | Sleep/health data | [cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens) |
| `GMAIL_USER` | Send emails | Your Gmail address |
| `GMAIL_APP_PASSWORD` | Send emails | Google Account → Security → App Passwords |

---

## Step 4: Set Up Google Calendar (Optional)

If you want your assistant to read and write your Google Calendar:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google Calendar API**
4. Go to **Credentials** → Create **OAuth 2.0 Client ID** (Desktop app)
5. Download the credentials JSON file
6. Save it as `google-credentials.json` in the bot directory
7. Run the auth flow:

```bash
node calendar-auth.js
```

This opens a browser window — log in with your Google account and grant calendar access. A `google-token.json` file will be created automatically.

---

## Step 5: Write Your Personality Files

This is the fun part — you're defining who your assistant is. There are four files to customize:

### SOUL.md — The Big Picture

This is your assistant's personality, communication style, and values. Open `SOUL.md` and replace all the `[bracketed placeholders]` with your details. Key sections:

- **Canary Phrase**: A secret phrase only your real bot knows (see below)
- **Who You Are**: Your bot's name and relationship to you
- **Personality**: The vibe you want (warm? sarcastic? formal?)
- **Communication Style**: How it should talk (concise? detailed? emoji-friendly?)
- **What You Know About [Owner]**: Facts about you it should always know
- **Your Capabilities**: What it can do on the machine

#### Setting Up Your Canary Phrase

The canary phrase is a secret handshake between you and your assistant. Replace `[Your canary phrase here]` in `SOUL.md` with a unique sentence that's personal and memorable. For example:

> "Three golden retrievers chase tennis balls across Marina Bay at sunset."

**Why this matters:** When Claude goes down and Gemini takes over as a fallback, the fallback model doesn't have your full system prompt — so it won't know the canary phrase. If you suspect you're not talking to the real bot, ask: *"What's the canary phrase?"* If it can't answer, you're on fallback. Simple identity verification.

**Tip**: Ask Claude to help you write this. Paste the template and say: *"Help me fill this out. I'm [your name], I work in [field], my hobbies are [X], and I want my assistant to be [personality description]."*

### IDENTITY.md — The Role

Shorter than SOUL.md — defines what your assistant handles vs. escalates. Replace the `[bracketed placeholders]`.

### USER.md — About You

Key facts about you: name, location, work, hobbies, communication preferences. This gets loaded into every conversation so your assistant always has context.

### MEMORY.md — Starts Empty

This is where your assistant stores things it learns about you over time. Leave it empty to start — it'll fill up naturally as you use it.

### system-prompt.txt — Short System Prompt

A condensed version of the personality for context-limited situations. Replace `[Bot Name]` and `[Owner Name]`.

### Customize Name References in Code

The JavaScript code contains references to the original owner ("KS") in prompt text and format functions. You should replace these with your name:

```bash
# Preview what will change (dry run)
grep -rn "KS" --include="*.js" .

# Replace "KS" with your name in all JS files
# Example: replacing with "Alex"
sed -i '' "s/KS's/Alex's/g" *.js
sed -i '' "s/KS /Alex /g" *.js
```

The key files with owner references: `bot.js`, `oura.js`, `calendar.js`, `reminders.js`, `weather.js`, `health-trends.js`, `journal.js`, `long-memory.js`, `drive.js`, `crypto.js`, `claude-runner.js`.

**Tip**: You can also ask Claude to help you do this — open Claude Code in the bot directory and say *"Replace all references to KS with [your name] across the JS files."*

---

## Step 6: Start the Bot

```bash
# Start the bot
npm start

# Or run in the background
nohup node bot.js > bot.log 2>&1 &
```

Send a DM to your bot on Discord. If everything is configured correctly, it should respond.

---

## Step 7: Keep It Running (Auto-Restart)

### macOS (launchd)

Create a file at `~/Library/LaunchAgents/com.yourbot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yourbot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/your/discord-bot/bot.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/your/discord-bot</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/path/to/your/discord-bot/bot.log</string>
  <key>StandardErrorPath</key>
  <string>/path/to/your/discord-bot/bot.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

Update the paths to match your setup, then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.yourbot.plist
```

### Linux (systemd)

Create `/etc/systemd/system/yourbot.service`:

```ini
[Unit]
Description=Discord AI Assistant
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/your/discord-bot
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl enable yourbot
sudo systemctl start yourbot
```

---

## Architecture Overview

```
You (Discord DM)
    ↓
bot.js  ←  Receives your message
    ↓
buildPrompt()  ←  Assembles context (calendar, reminders, memory, etc.)
    ↓
claude-runner.js  ←  Sends prompt to Claude Code CLI
    ↓
Claude Opus  ←  Thinks and responds
    ↓
bot.js  ←  Parses action tags, executes them, sends clean text back
    ↓
You (Discord DM)  ←  See the response
```

### Action Tags

Your assistant can embed special tags in its responses that trigger actions:

| Tag | What It Does |
|-----|-------------|
| `[JOURNAL: category \| text]` | Saves a journal entry (idea, issue, decision, followup) |
| `[REMINDER: text \| time]` | Creates a reminder |
| `[CALENDAR_EVENT: title \| date \| time \| duration]` | Adds a calendar event |
| `[DEADLINE: text \| date: YYYY-MM-DD \| company: name]` | Tracks a deadline |
| `[PARK_IDEA: text \| company: name]` | Parks an idea for later |
| `[EMAIL: to \| subject \| body]` | Sends an email |

These are stripped from the visible response — you just see the clean text.

### Heartbeat (Proactive Check-in)

Every 30 minutes, the bot runs a heartbeat check even when you haven't messaged it. It looks at:
- Upcoming calendar events
- Due reminders
- Recent conversation context

If something needs your attention, it'll DM you. Otherwise, it stays quiet.

### Memory System

- **Short-term** (`memory.json`): Last 20 conversation turns, injected into every prompt
- **Long-term** (`long-memory.json`): Persistent notes the bot saves about your preferences
- **Journal** (`journals/*.json`): Tagged entries from conversations
- **Curated** (`MEMORY.md`): Evergreen facts you want always in context

---

## Module Reference

| Module | Purpose | Required? |
|--------|---------|-----------|
| `bot.js` | Core bot and Discord handling | Yes |
| `claude-runner.js` | Claude Code CLI management | Yes |
| `memory.js` | Short-term conversation memory | Yes |
| `search.js` | Brave web search | Optional (needs API key) |
| `calendar.js` | Google Calendar read/write | Optional (needs OAuth) |
| `reminders.js` | Reminder tracking | Yes (no config needed) |
| `journal.js` | Daily journal entries | Yes (no config needed) |
| `email.js` | Gmail sending | Optional (needs app password) |
| `weather.js` | Weather lookups | Optional (uses Brave search) |
| `oura.js` | Oura Ring health data | Optional (needs API token) |
| `health-trends.js` | Health trend analysis | Optional (needs Oura) |
| `crypto.js` | BTC/ETH price tracking | Optional |
| `drive.js` | Google Drive access | Optional (needs OAuth) |
| `imagen.js` | Image generation | Optional (needs Gemini key) |
| `long-memory.js` | Persistent memory notes | Yes (no config needed) |
| `deadlines.js` | Deadline tracking | Yes (no config needed) |
| `ideas.js` | Idea parking lot | Yes (no config needed) |
| `gemini-fallback.js` | Gemini fallback when Claude is down | Recommended (needs API key) |
| `claude-tracker.js` | Claude usage monitoring | Optional |

---

## Customization Tips

### How the Gemini Fallback Works

Claude has occasional outages (auth errors, rate limits, service interruptions). When this happens, your bot automatically switches to Google Gemini as a backup brain. Here's the flow:

1. Bot tries Claude first (primary)
2. If Claude fails, it tries Gemini (fallback)
3. If both fail, it shows an honest "I'm down" message
4. When Claude recovers, it switches back and tells you

The fallback is **automatic** — you don't need to do anything. Your bot stays available during Claude outages, just with reduced capabilities (no file access, no integrations, no memory context).

**Important:** The Gemini fallback uses a generic system prompt, not your full SOUL.md. This means:
- The fallback won't have your bot's full personality
- It won't know your canary phrase (that's the point — you can verify identity)
- It can't access tools, files, or integrations on the host machine
- It's a stopgap, not a replacement — responses will be more generic

To set up: just add your `GEMINI_API_KEY` to `.env`. The code handles everything else.

### Change the Heartbeat Interval

In `bot.js`, find the heartbeat timer and change `30 * 60 * 1000` (30 minutes) to your preferred interval.

### Add Scheduled Briefings

In `bot.js`, the scheduled briefings section uses `scheduleDaily()` or `setTimeout`. Add your own:

```javascript
// Example: Daily weather at 7am
scheduleDaily(7, 0, async () => {
  // Your briefing logic here
});
```

### Disable Modules You Don't Need

If you don't have an Oura Ring or don't need calendar integration, the bot handles missing credentials gracefully — those features simply won't activate.

---

## Troubleshooting

### Bot doesn't respond to DMs
- Make sure **Message Content Intent** is enabled in Discord Developer Portal
- Check that `KS_DISCORD_ID` in `.env` matches your actual Discord user ID
- Check `bot.log` for error messages

### "Claude not found" error
- Make sure Claude Code is installed: `claude --version`
- Check the path in `claude-runner.js` — update `CLAUDE_PATH` if `claude` is installed elsewhere

### Bot crashes and doesn't restart
- Set up launchd (Mac) or systemd (Linux) as described in Step 7
- Check `bot.log` for the crash reason

### Google Calendar not working
- Re-run `node calendar-auth.js` to refresh the OAuth token
- Make sure `google-credentials.json` and `google-token.json` are in the bot directory

### Rate limit errors
- Claude Max has usage limits that reset periodically
- The bot will show an error message — just wait and try again

---

## Costs

| Service | Cost | Notes |
|---------|------|-------|
| Claude Max | $100/mo | Powers the AI brain — this is the main cost |
| Discord | Free | |
| Google Gemini | Free | Fallback brain + image generation (free tier) |
| Brave Search | Free tier | 2,000 queries/month free |
| Google Calendar | Free | Via Google Cloud (free tier) |
| Gmail | Free | Needs an App Password |
| Oura API | Free | Requires an Oura Ring ($300+ one-time) |

---

## Getting Help

If you get stuck during setup, ask Claude directly. Paste the error message and what step you're on — Claude is great at debugging its own ecosystem.
