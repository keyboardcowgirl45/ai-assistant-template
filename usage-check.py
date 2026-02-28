#!/usr/bin/env python3
"""Quick usage summary for Claude Max subscription.

Called by bot.js for the 9pm usage report. Outputs clean JSON
instead of scraping the TUI.
"""

import json
import sys

sys.path.insert(0, "/Users/janet.bot/.local/pipx/venvs/claude-monitor/lib/python3.14/site-packages")

from claude_monitor.data.analysis import analyze_usage
from claude_monitor.core.plans import Plans

plan_name = sys.argv[1] if len(sys.argv) > 1 else "max5"

token_limit = Plans.get_token_limit(plan_name)
cost_limit = Plans.get_cost_limit(plan_name)
message_limit = Plans.get_message_limit(plan_name)

# Use analyze_usage — same data source as the TUI
data = analyze_usage(hours_back=24, use_cache=False)
blocks = data.get("blocks", [])

# Sum across all blocks (full 24h picture)
total_tokens = sum(b.get("totalTokens", 0) for b in blocks if not b.get("isGap"))
total_cost = sum(b.get("costUSD", 0) for b in blocks if not b.get("isGap"))
total_messages = sum(b.get("sentMessagesCount", 0) for b in blocks if not b.get("isGap"))

token_pct = round((total_tokens / token_limit) * 100, 1) if token_limit > 0 else 0
cost_pct = round((total_cost / cost_limit) * 100, 1) if cost_limit > 0 else 0
msg_pct = round((total_messages / message_limit) * 100, 1) if message_limit > 0 else 0

print(json.dumps({
    "plan": plan_name,
    "tokens": {"used": total_tokens, "limit": token_limit, "pct": token_pct},
    "cost": {"used": round(total_cost, 2), "limit": cost_limit, "pct": cost_pct},
    "messages": {"used": total_messages, "limit": message_limit, "pct": msg_pct},
}))
