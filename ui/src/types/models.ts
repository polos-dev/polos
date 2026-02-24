// UI types
export interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  badge?: string | number;
  children?: NavigationItem[];
}

export interface NavigationSection extends NavigationItem {
  children?: NavigationItem[];
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  projects?: ProjectMembership[];
  // For UI compatibility
  avatar?: string; // Optional avatar URL
}

export interface ProjectMembership {
  id: string;
  project: Project;
  role: ProjectRole;
  createdAt: Date;
}

export const ProjectRole = {
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;

export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole];

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  user_id: string;
  project_id: string;
  role: ProjectRole;
  user?: User;
  project?: Project;
  created_at: string;
  updated_at: string;
}

export interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  span_type: string;
  attributes: Record<string, any> | null;
  events: Array<{
    timestamp?: string;
    name: string;
    attributes?: Record<string, any>;
  }> | null;
  input: any;
  output: any;
  error: any;
  started_at: string;
  ended_at: string | null;
  initial_state?: Record<string, any>;
  final_state?: Record<string, any>;
}

// Trace response from orchestrator API
export interface Trace {
  trace_id: string;
  spans: Span[];
  trace_start_time: string | null;
  trace_end_time: string | null;
  span_count: number;
  error_count: number;
  root_span_name: string | null;
  status: string;
}

// Trace list item
export interface TraceListItem {
  trace_id: string;
  root_span_type: string | null;
  root_span_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  input: any;
  output: any;
  root_error: any;
  status: string;
}

export interface TraceFilters {
  keyword?: string;
  start_time?: string;
  end_time?: string;
  user_id?: string;
  session_id?: string;
  service_name?: string;
  trace_type?: string;
  status?: string;
}

export interface Agent {
  id: string;
  deployment_id: string;
  provider: string;
  model: string;
  system_prompt?: string;
  tools?: any;
  temperature?: number;
  max_output_tokens?: number;
  config?: any;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface Workflow {
  workflow_id: string;
  deployment_id: string;
  workflow_type: string;
  trigger_on_event: boolean;
  scheduled: boolean;
  created_at: string;
}

export interface Tool {
  id: string;
  deployment_id: string;
  tool_type: string;
  description?: string;
  parameters?: any;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunSummary {
  id: string;
  root_execution_id: string;
  workflow_id: string;
  session_id?: string;
  created_at: string;
  completed_at: string;
  status: string;
  payload: any;
  result?: any;
  error?: string;
}

// Session types
export interface SessionListItem {
  execution_id: string;
  agent_id: string;
  session_id?: string;
  status: string;
  user_message_preview?: string;
  created_at: string;
  total_tokens?: number;
  tool_call_count: number;
  approval_count: number;
  execution_count?: number;
  error?: string;
}

export interface TimelineEntry {
  entry_type:
    | 'user_message'
    | 'assistant_message'
    | 'tool_call'
    | 'approval_request'
    | 'approval_response';
  timestamp: string;
  data: any;
}

export interface ApprovalEntry {
  step_key: string;
  requested_at: string;
  resolved_at?: string;
  status: string;
  data?: any;
}

export interface SessionDetail {
  execution_id: string;
  agent_id: string;
  session_id?: string;
  status: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
  payload: any;
  result?: any;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  tool_call_count: number;
  approval_count: number;
  timeline: TimelineEntry[];
  approvals: ApprovalEntry[];
}
