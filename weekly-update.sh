#!/bin/bash
# weekly-update.sh — Updates Claude Code, npm, and global packages
# Runs every Sunday at 11pm SGT via launchd
# Logs to ~/discord-bot/logs/updates.log

LOG="/Users/janet.bot/discord-bot/logs/updates.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

echo "========================================" >> "$LOG"
echo "Weekly Update — $DATE" >> "$LOG"
echo "========================================" >> "$LOG"

# Claude Code
BEFORE=$(/opt/homebrew/bin/claude --version 2>/dev/null)
echo "Claude Code before: $BEFORE" >> "$LOG"
npm install -g @anthropic-ai/claude-code@latest >> "$LOG" 2>&1
AFTER=$(/opt/homebrew/bin/claude --version 2>/dev/null)
echo "Claude Code after:  $AFTER" >> "$LOG"

# npm
BEFORE=$(npm --version 2>/dev/null)
echo "npm before: $BEFORE" >> "$LOG"
npm install -g npm@latest >> "$LOG" 2>&1
AFTER=$(npm --version 2>/dev/null)
echo "npm after:  $AFTER" >> "$LOG"

# Summary
echo "" >> "$LOG"
echo "Update complete at $(date '+%H:%M:%S')" >> "$LOG"
echo "" >> "$LOG"
