-- Full database schema migration
-- This replaces all previous incremental migrations with a single comprehensive schema

-- Create project_role enum type
CREATE TYPE project_role AS ENUM (
    'ADMIN',
    'WRITE',
    'READ'
);

-- Create base tables first (no dependencies)
-- Create projects table
CREATE TABLE projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_pkey PRIMARY KEY (id)
);

-- Create users table
CREATE TABLE users (
    id text NOT NULL,
    email text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    display_name text NOT NULL,
    password_hash text,
    auth_provider text,
    external_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email)
);

-- Create deployments table (depends on projects)
CREATE TABLE deployments (
    id text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT deployments_pkey PRIMARY KEY (id, project_id),
    CONSTRAINT fk_deployments_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create workers table (depends on deployments and projects)
CREATE TABLE workers (
    id uuid NOT NULL,
    status text DEFAULT 'offline' NOT NULL,
    last_heartbeat timestamp with time zone DEFAULT now() NOT NULL,
    capabilities jsonb,
    current_deployment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    mode text DEFAULT 'push'::text NOT NULL,
    push_endpoint_url text,
    max_concurrent_executions integer DEFAULT 100 NOT NULL,
    current_execution_count integer DEFAULT 0 NOT NULL,
    last_push_attempt_at timestamp with time zone,
    push_failure_count integer DEFAULT 0 NOT NULL,
    push_failure_threshold integer DEFAULT 3 NOT NULL,
    CONSTRAINT workers_pkey PRIMARY KEY (id),
    CONSTRAINT workers_current_deployment_id_fkey FOREIGN KEY (current_deployment_id, project_id) REFERENCES deployments(id, project_id) ON DELETE SET NULL
);

-- Create workflow_executions table (depends on deployments, projects, workers)
CREATE TABLE workflow_executions (
    id uuid NOT NULL,
    workflow_id text NOT NULL,
    status text NOT NULL,
    payload jsonb NOT NULL,
    result jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    deployment_id text NOT NULL,
    assigned_to_worker uuid,
    assigned_at timestamp with time zone,
    parent_execution_id uuid,
    root_execution_id uuid,
    retry_count integer DEFAULT 0 NOT NULL,
    step_sequence integer DEFAULT 0 NOT NULL,
    concurrency_key text,
    batch_id uuid,
    queue_name text NOT NULL,
    session_id text,
    user_id text,
    project_id uuid NOT NULL,
    output_schema_name text,
    step_key text,
    otel_traceparent text,
    otel_span_id text,
    claimed_at timestamp with time zone,
    queued_at timestamp with time zone,
    initial_state jsonb,
    final_state jsonb,
    run_timeout_seconds integer,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    CONSTRAINT executions_pkey PRIMARY KEY (id),
    CONSTRAINT executions_deployment_project_id_fkey FOREIGN KEY (deployment_id, project_id) REFERENCES deployments(id, project_id) ON DELETE SET NULL,
    CONSTRAINT workflow_executions_parent_execution_id_fkey FOREIGN KEY (parent_execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL,
    CONSTRAINT workflow_executions_root_execution_id_fkey FOREIGN KEY (root_execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL,
    CONSTRAINT fk_workflow_executions_assigned_to_worker FOREIGN KEY (assigned_to_worker) REFERENCES workers(id) ON DELETE SET NULL
);

-- Create agent_definitions table (depends on deployments and projects)
CREATE TABLE agent_definitions (
    id text NOT NULL,
    deployment_id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    system_prompt text,
    tools jsonb,
    temperature numeric(5,2),
    max_output_tokens integer,
    config jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb,
    project_id uuid NOT NULL,
    CONSTRAINT agent_definitions_pkey PRIMARY KEY (id, deployment_id, project_id),
    CONSTRAINT agent_definitions_deployment_id_fkey FOREIGN KEY (deployment_id, project_id) REFERENCES deployments(id, project_id) ON DELETE CASCADE
);

-- Create api_keys table
CREATE TABLE api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    key_hash text NOT NULL,
    last_four_digits text NOT NULL,
    project_id uuid NOT NULL,
    created_by_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT api_keys_pkey PRIMARY KEY (id),
    CONSTRAINT unique_project_name UNIQUE (project_id, name),
    CONSTRAINT fk_api_keys_created_by FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_api_keys_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Create conversation_history table
CREATE SEQUENCE conversation_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE conversation_history (
    id bigint NOT NULL DEFAULT nextval('conversation_history_id_seq'::regclass),
    conversation_id text NOT NULL,
    agent_id text NOT NULL,
    role text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_run_id uuid,
    project_id uuid NOT NULL,
    deployment_id text,
    CONSTRAINT conversation_history_pkey PRIMARY KEY (id),
    CONSTRAINT fk_conversation_history_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

ALTER SEQUENCE conversation_history_id_seq OWNED BY conversation_history.id;

-- Create deployment_workflows table
CREATE TABLE deployment_workflows (
    deployment_id text NOT NULL,
    workflow_id text NOT NULL,
    workflow_type text DEFAULT 'workflow',
    description text,
    trigger_on_event boolean DEFAULT false,
    scheduled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT deployment_tasks_pkey PRIMARY KEY (deployment_id, project_id, workflow_id),
    CONSTRAINT deployment_tasks_deployment_id_fkey FOREIGN KEY (deployment_id, project_id) REFERENCES deployments(id, project_id) ON DELETE CASCADE
);

-- Create event_topics table
CREATE TABLE event_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT event_topics_pkey PRIMARY KEY (id),
    CONSTRAINT event_topics_topic_key UNIQUE (project_id, topic),
    CONSTRAINT fk_event_topics_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create event_triggers table
CREATE TABLE event_triggers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id text NOT NULL,
    deployment_id text NOT NULL,
    event_topic text NOT NULL,
    batch_size integer DEFAULT 1 NOT NULL,
    batch_timeout_seconds integer,
    last_event_timestamp timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sequence_id bigint,
    project_id uuid NOT NULL,
    CONSTRAINT event_triggers_pkey PRIMARY KEY (id),
    CONSTRAINT event_triggers_workflow_topic_key UNIQUE (deployment_id, project_id, workflow_id, event_topic),
    CONSTRAINT fk_event_triggers_workflow FOREIGN KEY (deployment_id, project_id, workflow_id) REFERENCES deployment_workflows(deployment_id, project_id, workflow_id) ON DELETE CASCADE
);

-- Create events table
CREATE TABLE events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic text NOT NULL,
    event_type text,
    data jsonb NOT NULL,
    status text DEFAULT 'valid' NOT NULL,
    execution_id uuid,
    attempt_number integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sequence_id bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
    project_id uuid NOT NULL,
    CONSTRAINT events_pkey PRIMARY KEY (id),
    CONSTRAINT events_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL,
    CONSTRAINT fk_events_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create execution_step_outputs table
CREATE TABLE execution_step_outputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    step_key text NOT NULL,
    outputs jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    error jsonb,
    success boolean,
    source_execution_id uuid,
    project_id uuid NOT NULL,
    output_schema_name text,
    CONSTRAINT execution_step_outputs_pkey PRIMARY KEY (id),
    CONSTRAINT execution_step_outputs_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
    CONSTRAINT fk_step_outputs_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create project_members table
CREATE TABLE project_members (
    id text NOT NULL,
    user_id text NOT NULL,
    project_id uuid NOT NULL,
    role project_role NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT project_members_pkey PRIMARY KEY (id),
    CONSTRAINT project_members_user_project_unique UNIQUE (user_id, project_id),
    CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create queues table
CREATE TABLE queues (
    name text NOT NULL,
    concurrency_limit integer DEFAULT 999999 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deployment_id text NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT queues_pkey PRIMARY KEY (name, deployment_id, project_id),
    CONSTRAINT fk_queues_deployment_project FOREIGN KEY (deployment_id, project_id) REFERENCES deployments(id, project_id)
);

-- Create schedules table
CREATE TABLE schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id text NOT NULL,
    cron text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    key text DEFAULT 'global'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT schedules_pkey PRIMARY KEY (id),
    CONSTRAINT schedules_task_id_key_key UNIQUE (project_id, workflow_id, key),
    CONSTRAINT fk_schedules_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create spans table
CREATE TABLE spans (
    trace_id text NOT NULL,
    project_id uuid NOT NULL,
    span_id text NOT NULL,
    parent_span_id text,
    name text NOT NULL,
    span_type text NOT NULL,
    attributes jsonb,
    events jsonb,
    input jsonb,
    output jsonb,
    error jsonb,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    initial_state jsonb,
    final_state jsonb,
    CONSTRAINT spans_pkey PRIMARY KEY (trace_id, span_id),
    CONSTRAINT fk_spans_project FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Create tool_definitions table
CREATE TABLE tool_definitions (
    id text NOT NULL,
    deployment_id text NOT NULL,
    description text,
    parameters jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'default'::text NOT NULL,
    project_id uuid NOT NULL,
    CONSTRAINT tool_definitions_pkey PRIMARY KEY (id, deployment_id, project_id),
    CONSTRAINT tool_definitions_deployment_id_fkey FOREIGN KEY (deployment_id, project_id) REFERENCES deployments(id, project_id) ON DELETE CASCADE
);

-- Create wait_steps table
CREATE TABLE wait_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    parent_execution_id uuid,
    root_execution_id uuid,
    wait_until timestamp with time zone,
    wait_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    wait_topic text,
    expires_at timestamp with time zone,
    project_id uuid NOT NULL,
    step_key text,
    metadata jsonb,
    CONSTRAINT wait_steps_pkey PRIMARY KEY (id),
    CONSTRAINT wait_steps_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
    CONSTRAINT wait_steps_parent_execution_id_fkey FOREIGN KEY (parent_execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL,
    CONSTRAINT wait_steps_root_execution_id_fkey FOREIGN KEY (root_execution_id) REFERENCES workflow_executions(id) ON DELETE SET NULL,
    CONSTRAINT fk_wait_steps_project FOREIGN KEY (project_id) REFERENCES projects(id)
);



-- Create indexes
CREATE INDEX idx_agent_definitions_deployment_id ON agent_definitions USING btree (project_id, deployment_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys USING btree (key_hash);
CREATE INDEX idx_api_keys_project_id ON api_keys USING btree (project_id);
CREATE INDEX idx_conversation_history_conversation_agent ON conversation_history USING btree (project_id, conversation_id, agent_id, created_at DESC);
CREATE INDEX idx_deployment_workflows_workflow_id ON deployment_workflows USING btree (project_id, deployment_id, workflow_id);
CREATE INDEX idx_deployment_workflows_workflow_type ON deployment_workflows USING btree (project_id, deployment_id, workflow_type);
CREATE INDEX idx_deployments_created_at ON deployments USING btree (project_id, created_at DESC);
CREATE INDEX idx_event_triggers_status ON event_triggers USING btree (status) WHERE (status = 'active'::text);
CREATE INDEX idx_event_triggers_project_topic ON event_triggers USING btree (project_id, event_topic, status);
CREATE INDEX idx_events_project_topic ON events USING btree (project_id, topic, created_at) WHERE ((status)::text = 'valid'::text);
CREATE INDEX idx_events_topic_poll ON events USING btree (project_id, topic, status, sequence_id, id, event_type, execution_id, attempt_number, created_at) WHERE ((status)::text = 'valid'::text);
CREATE INDEX idx_events_topic_sequence_cross_project ON events USING btree (topic, status, sequence_id) WHERE ((status)::text = 'valid'::text);
CREATE INDEX idx_execution_step_outputs_project_id ON execution_step_outputs USING btree (project_id);
CREATE INDEX idx_executions_batch_id ON workflow_executions USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX idx_executions_parent_execution_id ON workflow_executions USING btree (parent_execution_id);
CREATE INDEX idx_executions_parent_status ON workflow_executions USING btree (parent_execution_id, status, id) WHERE (parent_execution_id IS NOT NULL);
CREATE INDEX idx_executions_queued_poll ON workflow_executions USING btree (status, queued_at, created_at) INCLUDE (id, workflow_id, deployment_id, queue_name, concurrency_key, project_id) WHERE ((status)::text = 'queued'::text);
CREATE INDEX idx_executions_root_execution_id ON workflow_executions USING btree (root_execution_id);
CREATE INDEX idx_executions_root_project ON workflow_executions USING btree (project_id, root_execution_id, status);
CREATE INDEX idx_executions_running_concurrency ON workflow_executions USING btree (status, queue_name, deployment_id, concurrency_key) WHERE ((status)::text = ANY ((ARRAY['claimed', 'running'])::text[]));
CREATE INDEX idx_executions_session_project ON workflow_executions USING btree (project_id, session_id, status) WHERE (session_id IS NOT NULL);
CREATE INDEX idx_executions_user_project ON workflow_executions USING btree (project_id, user_id, status) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_executions_waiting ON workflow_executions USING btree (status, id, root_execution_id) WHERE ((status)::text = 'waiting'::text);
CREATE INDEX idx_executions_worker_active ON workflow_executions USING btree (assigned_to_worker, status) WHERE ((assigned_to_worker IS NOT NULL) AND ((status)::text = ANY ((ARRAY['running', 'claimed'])::text[])));
CREATE INDEX idx_executions_worker_project ON workflow_executions USING btree (project_id, assigned_to_worker, status) WHERE (assigned_to_worker IS NOT NULL);
CREATE INDEX idx_executions_workflow_deployment_status ON workflow_executions USING btree (workflow_id, deployment_id, status) WHERE ((status)::text = ANY ((ARRAY['queued', 'running', 'waiting'])::text[]));
CREATE INDEX idx_executions_workflow_project ON workflow_executions USING btree (project_id, workflow_id, status);
CREATE INDEX idx_projects_name ON projects USING btree (name);
CREATE INDEX idx_queues_project_id ON queues USING btree (project_id);
CREATE INDEX idx_schedules_key ON schedules USING btree (key);
CREATE INDEX idx_schedules_next_run ON schedules USING btree (next_run_at) WHERE (status = 'active'::text);
CREATE INDEX idx_schedules_project_id ON schedules USING btree (project_id, status);
CREATE INDEX idx_spans_name ON spans USING btree (project_id, name);
CREATE INDEX idx_spans_parent_span_id ON spans USING btree (project_id, parent_span_id);
CREATE INDEX idx_spans_span_type ON spans USING btree (project_id, span_type);
CREATE INDEX idx_spans_started_at ON spans USING btree (project_id, started_at);
CREATE INDEX idx_spans_trace_id ON spans USING btree (trace_id);
CREATE UNIQUE INDEX idx_step_outputs_execution_id_step_key ON execution_step_outputs USING btree (execution_id, step_key);
CREATE INDEX idx_tool_definitions_deployment_id ON tool_definitions USING btree (project_id, deployment_id);
CREATE INDEX idx_wait_steps_event_expired ON wait_steps USING btree (wait_type, expires_at, execution_id, root_execution_id, step_key, wait_topic) WHERE (((wait_type)::text = 'event'::text) AND (expires_at IS NOT NULL) AND (step_key IS NOT NULL));
CREATE UNIQUE INDEX idx_wait_steps_execution_id_step_key ON wait_steps USING btree (execution_id, step_key);
CREATE INDEX idx_wait_steps_execution_project ON wait_steps USING btree (project_id, execution_id, wait_type, step_key);
CREATE INDEX idx_wait_steps_root_project ON wait_steps USING btree (project_id, root_execution_id, wait_type) WHERE (root_execution_id IS NOT NULL);
CREATE INDEX idx_wait_steps_subworkflow ON wait_steps USING btree (execution_id, wait_type, step_key) WHERE (((wait_type)::text = 'subworkflow'::text) AND (step_key IS NOT NULL));
CREATE INDEX idx_wait_steps_time_ready ON wait_steps USING btree (wait_type, wait_until, execution_id, root_execution_id, step_key) WHERE (((wait_type)::text = 'time'::text) AND (wait_until IS NOT NULL) AND (step_key IS NOT NULL));
CREATE INDEX idx_wait_steps_topic_active ON wait_steps USING btree (wait_topic, wait_type, execution_id, step_key) WHERE ((wait_topic IS NOT NULL) AND ((wait_type)::text = 'event'::text));
CREATE INDEX idx_workers_push_capacity ON workers USING btree (mode, current_execution_count, max_concurrent_executions) WHERE (mode = 'push'::text);
CREATE INDEX idx_workers_push_mode ON workers USING btree (project_id, mode, status) WHERE (mode = 'push'::text);
CREATE INDEX idx_workers_status_heartbeat ON workers USING btree (status, last_heartbeat) WHERE ((status)::text = 'online'::text);
CREATE INDEX idx_workflow_executions_timeout_check ON workflow_executions USING btree (status, assigned_to_worker, started_at, run_timeout_seconds) WHERE (run_timeout_seconds IS NOT NULL);
CREATE INDEX project_members_project_id_idx ON project_members USING btree (project_id);
CREATE INDEX project_members_user_id_idx ON project_members USING btree (user_id);

-- Enable Row Level Security
ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_step_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wait_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY admin_access ON agent_definitions USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON conversation_history USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON deployment_workflows USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON deployments USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON event_topics USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON event_triggers USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON events USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON execution_step_outputs USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON projects USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON queues USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON schedules USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON tool_definitions USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON wait_steps USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON workers USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY admin_access ON workflow_executions USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY api_keys_admin_access ON api_keys USING (((current_setting('app.is_admin'::text, true))::boolean = true));
CREATE POLICY api_keys_select_project ON api_keys FOR SELECT USING (((project_id IN ( SELECT project_members.project_id
   FROM project_members
  WHERE (project_members.user_id = current_setting('app.user_id'::text, true)))) OR ((current_setting('app.is_admin'::text, true))::boolean = true)));
CREATE POLICY project_isolation ON agent_definitions USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON conversation_history USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON deployment_workflows USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON deployments USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON event_topics USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON event_triggers USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON events USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON execution_step_outputs USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON projects USING (((id = (current_setting('app.project_id'::text, true))::uuid) OR ((current_setting('app.is_admin'::text, true))::boolean = true)));
CREATE POLICY project_isolation ON queues USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON schedules USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON tool_definitions USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON wait_steps USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON workers USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_isolation ON workflow_executions USING ((project_id = (current_setting('app.project_id'::text, true))::uuid));
CREATE POLICY project_members_select_project ON project_members FOR SELECT USING (((project_id IN ( SELECT project_members_1.project_id
   FROM project_members project_members_1
  WHERE (project_members_1.user_id = current_setting('app.user_id'::text, true)))) OR ((current_setting('app.is_admin'::text, true))::boolean = true)));
CREATE POLICY users_insert_own ON users FOR INSERT WITH CHECK (true);
CREATE POLICY users_select_own ON users FOR SELECT USING (((id = current_setting('app.user_id'::text, true)) OR ((current_setting('app.is_admin'::text, true))::boolean = true)));
CREATE POLICY users_update_own ON users FOR UPDATE USING (((id = current_setting('app.user_id'::text, true)) OR ((current_setting('app.is_admin'::text, true))::boolean = true)));
