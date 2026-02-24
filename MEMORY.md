# Janet — Curated Memory

## KS Health
- Wants to track health this year — weight, mental and physical health
- Wears an Oura Ring for sleep tracking
- Started Mounjaro on Tuesday Feb 17, 2026 for weight management
- First week on Mounjaro: experienced nausea during polo — likely from exercising on light stomach while body adjusts
- Late meals + stress are confirmed sleep disruptors
- Sleep scores: Feb 20 = 83, Feb 21 = 82, Feb 22 dropped to 71 after late meal + stress

## KS Preferences
- Daily 7:30am sleep briefing via DM — no calendar event, just a message
- Does NOT want recurring check-ins cluttering her calendar
- Does NOT want automatic end-of-day digest — prefers on-demand review, Janet can nudge if items pile up
- Wants Janet to have personality: bright, optimistic, takes initiative as second brain and confidant
- Wants Claude usage reported as percentage, NOT dollar amounts
- Weekly Mounjaro check-in every Sunday 6pm

## Architecture Decisions
- Using Claude Code on Mac Mini (not OpenClaw), drawing inspiration from OpenClaw-style architecture only
- Oura MCP server (tomekkorbak/oura-mcp-server) for sleep data access
- Granola integration: using official MCP (mcp.granola.ai), NOT custom granola.js module
- Built daily journal system — auto-tags conversations as idea/issue/decision/followup
- Morning schedule: 7:30am sleep briefing (Oura), 8:30am workday kickoff (Granola debrief)
- Pre-meeting prep via heartbeat 15-30min before meetings
- Custom bot-level integrations (calendar, email, search) preferred over MCPs for context efficiency
- MCPs only for dynamic mid-conversation queries (Oura, Granola)

## Communication Rules
- NEVER propose replacing something that already works unless replacement is clearly better
- ALWAYS present advantages AND disadvantages when suggesting changes
- Discuss before building — proper back-and-forth planning before implementing
