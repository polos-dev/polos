"""
Slack Channel Example — bidirectional channels with output streaming.

Starts a Polos instance with Slack channel notifications. Demonstrates:

1. **Tool approval** (approval: 'always') — Slack shows inline
   Approve / Reject / View Details buttons. Per-tool channels route
   approval notifications to #ops-approvals.

2. **Bidirectional channels** — When users @mention the bot in Slack,
   the agent is triggered and output streams back to the originating
   Slack thread via `send_output()`.

3. **Agent routing** — register your Slack app with the orchestrator
   (`POST /api/v1/slack/apps`). When a user @mentions the bot,
   the agent ID is parsed from the message (`@agent-id`).

Run:
    python main.py

Environment variables:
    POLOS_PROJECT_ID     - Your project ID (default from env)
    POLOS_API_URL        - Orchestrator URL (default: http://localhost:8080)
    POLOS_API_KEY        - API key for authentication (optional for local development)
    SLACK_BOT_TOKEN      - Slack bot token, xoxb-... (required)
    SLACK_CHANNEL        - Default Slack channel (default: #agent-notifications)
    SLACK_SIGNING_SECRET - Slack app signing secret (set on orchestrator for interactive buttons)
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import Polos, SlackChannel, SlackChannelConfig

# Import agents/tools so they auto-register with the workflow registry
from agents import assistant_agent  # noqa: F401

load_dotenv()

slack_bot_token = os.environ.get("SLACK_BOT_TOKEN")
if not slack_bot_token:
    raise RuntimeError(
        "SLACK_BOT_TOKEN environment variable is required. "
        "Create a Slack app at https://api.slack.com/apps, add chat:write bot scope, "
        "install to your workspace, and copy the Bot User OAuth Token."
    )

default_channel = os.environ.get("SLACK_CHANNEL", "#agent-notifications")
ops_channel = os.environ.get("SLACK_OPS_CHANNEL", "#ops-approvals")


async def main() -> None:
    # Slack channel for output streaming and notifications.
    # When users @mention the bot in Slack with `@slack-assistant <message>`,
    # the orchestrator parses the agent ID and routes output back to the thread.
    main_slack = SlackChannel(
        SlackChannelConfig(
            bot_token=slack_bot_token,
            default_channel=default_channel,
        )
    )

    polos = Polos(
        deployment_id="slack-channel-example",
        channels=[main_slack],
        log_file="polos.log",
    )

    print("Starting Slack Channel Example (Bidirectional)...")
    print(f"  Default channel: {default_channel}")
    print(f"  Ops channel:     {ops_channel}")
    print(f"  Agent: {assistant_agent.id}")
    print()
    print("  Channel routing:")
    print(f"    send_email tool → {ops_channel} (tool approval)")
    print(f"    @mention in {default_channel} → triggers slack-assistant")
    print("    Agent output → streams back to originating Slack thread")
    print("    ask_user (from Slack trigger) → routes to originating thread")
    print(f"    fallback → {default_channel} (Worker-level default)")
    print()
    print("  Try:")
    print(f"    @mention the bot in {default_channel} with a message")
    print('    "Send an email to alice@example.com about the Q1 report"')
    print(f"      → Approve/Reject buttons in {ops_channel}")
    print()
    print("  Press Ctrl+C to stop\n")

    await polos.serve()


if __name__ == "__main__":
    asyncio.run(main())
