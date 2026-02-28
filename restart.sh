#!/bin/bash
sleep 2
kill $1 2>/dev/null
sleep 1
cd /Users/janet.bot/discord-bot
nohup node bot.js > bot.log 2>&1 &
echo "Bot restarted with PID $!"
