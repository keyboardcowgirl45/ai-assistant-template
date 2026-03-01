# Janet — Curated Memory

## KS Health
- Wants to track health this year — weight, mental and physical health
- Wears an Oura Ring for sleep tracking
- Started Mounjaro on Tuesday Feb 17, 2026 for weight management
- First week on Mounjaro: experienced nausea during polo — likely from exercising on light stomach while body adjusts
- Late meals + stress are confirmed sleep disruptors
- Sleep scores: Feb 20 = 83, Feb 21 = 82, Feb 22 dropped to 71 after late meal + stress

- Pre-polo smoothie is the working strategy for Mounjaro exercise nausea — fueling up beforehand prevents the light-stomach nausea. Electrolytes helped only slightly.
- Mounjaro week 2 (Mar 1): appetite noticeably reduced, only side effect is exercise nausea (managed). On track.

## KS Preferences
- Daily 7:30am sleep briefing via DM — no calendar event, just a message
- Does NOT want recurring check-ins cluttering her calendar
- Does NOT want automatic end-of-day digest — prefers on-demand review, Janet can nudge if items pile up
- Wants Janet to have personality: bright, optimistic, takes initiative as second brain and confidant
- Wants Claude usage reported as percentage, NOT dollar amounts
- Weekly Mounjaro check-in every Sunday 6pm

- Sleep briefing moved to 7:45am (was 7:30am) — delayed to give Oura API more processing time after stale-data incident
- Granola meeting summaries: one clean paragraph per meeting, no citation links or URLs

- Weekly polo lessons every Friday morning — recurring commitment, affects scheduling
- Top 3 AI + virtual production news stories in 8:30am briefing for X3D — folded into existing Granola debrief

## Architecture Decisions
- Using Claude Code on Mac Mini (not OpenClaw), drawing inspiration from OpenClaw-style architecture only
- Oura MCP server (tomekkorbak/oura-mcp-server) for sleep data access
- Granola integration: using official MCP (mcp.granola.ai), NOT custom granola.js module
- Built daily journal system — auto-tags conversations as idea/issue/decision/followup
- Morning schedule: 7:45am sleep briefing (Oura), 8:30am workday kickoff (Granola debrief + AI/VP news)
- Pre-meeting prep via heartbeat 15-30min before meetings
- Custom bot-level integrations (calendar, email, search) preferred over MCPs for context efficiency
- MCPs only for dynamic mid-conversation queries (Oura, Granola)

- Always use Claude, never fall back to Ollama — KS wants clear error if Claude fails, not a different model. Ollama fallback removed from bot.js
- Oura sleep data: no silent fallback to stale data. If today's scores aren't ready, return "still processing" message instead of showing yesterday's numbers
- Nightly midnight git auto-commit to private GitHub repo (keyboardcowgirl45/janet-discord-bot) — backs up code and data files daily

- Heartbeats pass `countExchange:false` to claude-runner — prevents scheduled briefings from consuming the 20-exchange recycle limit and colliding with auto-recycle
- claude-tracker.js monitors GitHub RSS + Brave Search for Claude announcements — daily 10am scheduled check, wired into bot.js
- CLAUDECODE=1 env var must be stripped from child process env in claude-runner.js — Claude Code v2.1.59+ nested session check blocks CLI spawn otherwise

## Communication Rules
- NEVER propose replacing something that already works unless replacement is clearly better
- ALWAYS present advantages AND disadvantages when suggesting changes
- Discuss before building — proper back-and-forth planning before implementing
