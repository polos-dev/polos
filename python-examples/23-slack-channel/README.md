# Slack Channel Notifications

This example demonstrates Slack notifications when an agent suspends for user input. It shows two notification styles:

- **Tool approval** (`approval: 'always'`) — Slack renders inline **Approve / Reject / View Details** buttons. Clicking Approve or Reject resumes the execution directly from Slack.
- **ask_user** (freeform text) — Slack renders a **Respond** link button pointing to the approval page, since freeform input can't be captured via a button click.

## Slack App Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Give it a name (e.g., "Polos Agent") and select your workspace
3. Go to **OAuth & Permissions** > **Scopes** > **Bot Token Scopes** and add `chat:write`
4. Click **Install to Workspace** and authorize
5. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`
6. Invite the bot to your channel: `/invite @Polos Agent` in the channel

### Interactive Buttons (optional but recommended)

To enable the Approve/Reject buttons to actually resume executions from Slack:

1. In your Slack app settings, go to **Interactivity & Shortcuts** and toggle **Interactivity** on
2. Set the **Request URL** to `https://<your-orchestrator>/slack/interactions`
3. Go to **Basic Information** and copy the **Signing Secret** — set it as `SLACK_SIGNING_SECRET` on the orchestrator

Without this setup, the buttons still render in Slack but clicks won't be handled. Users can always fall back to the "View Details" link.

> **Tip:** Use channel IDs (e.g., `C0123456789`) instead of names (`#my-channel`) for `SLACK_CHANNEL`. Channel IDs are stable across renames. Find yours by right-clicking a channel in Slack > **View channel details** > copy the ID at the bottom.

## Running

```bash
cp .env.example .env
# Edit .env with your values

uv sync
python main.py
```

The server starts and blocks until Ctrl+C. Trigger the agent via the Polos UI or API:

- **"Send an email to alice@example.com about the Q1 report"** — the `send_email` tool suspends for approval, Slack shows Approve/Reject buttons
- **"What should I work on today?"** — the agent calls `ask_user`, Slack shows a Respond link button

## Thread Support

To post notifications in a specific Slack thread (e.g., replying in the thread where the agent was triggered), pass `thread_ts` in channel overrides:

```python
await ctx.step.suspend("review", {
    "_form": {"title": "Review needed", "description": "Please check the PR"},
    "_notify": {
        "slack": {
            "channel": "C0123456789",
            "thread_ts": "1234567890.123456",  # reply in this thread
        },
    },
})
```
