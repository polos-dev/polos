-- Add channel_context column for bidirectional channels
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS channel_context jsonb;

-- Bind Slack apps to projects
CREATE TABLE IF NOT EXISTS slack_apps (
    api_app_id text PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    created_at timestamptz NOT NULL DEFAULT NOW()
);
