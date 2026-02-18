# Slack Channel Notifications

This example demonstrates how to send Slack notifications when an agent suspends for user input. When the agent calls `ask_user`, a Slack message appears with a "Respond" button that links to the approval page.

## Slack App Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Give it a name (e.g., "Polos Agent") and select your workspace
3. Go to **OAuth & Permissions** > **Scopes** > **Bot Token Scopes** and add `chat:write`
4. Click **Install to Workspace** and authorize
5. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`
6. Invite the bot to your channel: `/invite @Polos Agent` in the channel

> **Tip:** Use channel IDs (e.g., `C0123456789`) instead of names (`#my-channel`) for `SLACK_CHANNEL`. Channel IDs are stable across renames. Find yours by right-clicking a channel in Slack > **View channel details** > copy the ID at the bottom.

> **Note:** You only need the Bot Token (`xoxb-...`). The App Token (`xapp-...`) is for Socket Mode (receiving events), which is not needed here — we only post notifications.

## Running

```bash
cp .env.example .env
# Edit .env with your values

npm install
npx tsx main.ts
```

The server starts and blocks until Ctrl+C. Trigger the agent via the Polos UI or API. When the agent calls `ask_user`, you'll see a Slack message with a "Respond" button.

## Thread Support

To post notifications in a specific Slack thread (e.g., replying in the thread where the agent was triggered), pass `thread_ts` in channel overrides:

```typescript
await ctx.step.suspend('review', {
  data: {
    _form: { title: 'Review needed', description: 'Please check the PR' },
    _notify: {
      slack: {
        channel: 'C0123456789',
        thread_ts: '1234567890.123456',  // reply in this thread
      },
    },
  },
});
```
