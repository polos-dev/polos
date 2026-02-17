-- Create session_memory table for storing compacted conversation state
-- Stores a rolling summary + uncompacted recent messages per session
CREATE TABLE session_memory (
    session_id text NOT NULL,
    project_id uuid NOT NULL,
    summary text,
    messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_memory_pkey PRIMARY KEY (session_id, project_id),
    CONSTRAINT fk_session_memory_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_session_memory_project ON session_memory USING btree (project_id);

-- Enable RLS
ALTER TABLE session_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_access ON session_memory USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY project_isolation ON session_memory USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
