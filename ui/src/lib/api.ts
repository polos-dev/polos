import {
  ProjectRole,
  type Project,
  type Agent,
  type Workflow,
  type Tool,
  type WorkflowRunSummary,
  type Trace,
  type TraceListItem,
  type SessionListItem,
  type SessionDetail,
} from '@/types/models';
import { type CreateProjectRequest } from '@/types/api';

// Get API base URL - check window variable first (runtime injection), then build-time env var
// This function is called at runtime for each API call, not at module load time
function getApiBaseUrl(): string {
  // Check window variable (injected by polos-server at runtime)
  // This is checked first because it's set at runtime and takes precedence
  const windowUrl = (window as any).VITE_API_BASE_URL;
  const envUrl = import.meta.env.VITE_API_BASE_URL;

  if (windowUrl) {
    return windowUrl;
  }
  // Fall back to build-time env var
  if (envUrl) {
    return envUrl;
  }
  // Default fallback
  return 'http://localhost:8080';
}

// Helper function to get headers with optional X-Project-ID
function getHeaders(projectId?: string | null): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/json',
  };
  if (projectId) {
    headers['X-Project-ID'] = projectId;
  }
  return headers;
}

export async function postJSON<T>(
  path: string,
  body: unknown,
  projectId?: string | null
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(projectId && { 'X-Project-ID': projectId }),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data?.detail || data?.message || 'Request failed');
  return data;
}

export async function putJSON<T>(
  path: string,
  body: unknown,
  projectId?: string | null
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(projectId && { 'X-Project-ID': projectId }),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data?.detail || data?.message || 'Request failed');
  return data;
}

export async function getJSON<T>(
  path: string,
  projectId?: string | null
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: 'include',
    headers: getHeaders(projectId),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface ApprovalResponse {
  execution_id: string;
  step_key: string;
  status: string;
  data: Record<string, unknown> | null;
}

export const api = {
  // Approval functions
  async getApproval(
    executionId: string,
    stepKey: string
  ): Promise<ApprovalResponse> {
    return getJSON<ApprovalResponse>(
      `/api/v1/approvals/${executionId}/${encodeURIComponent(stepKey)}`
    );
  },

  async submitApproval(
    executionId: string,
    stepKey: string,
    data: unknown
  ): Promise<void> {
    return postJSON<void>(
      `/api/v1/approvals/${executionId}/${encodeURIComponent(stepKey)}/submit`,
      { data }
    );
  },

  // Project functions
  async getProjects(): Promise<{ projects: Project[] }> {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/projects`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch projects' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    const data = await response.json();
    // Convert date strings to Date objects
    return {
      projects: data.projects.map((p: any) => ({
        ...p,
        created_at: new Date(p.created_at),
        updated_at: new Date(p.updated_at),
      })),
    };
  },

  async createProject(projectData: CreateProjectRequest): Promise<Project> {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(projectData),
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to create project' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return await response.json();
  },

  async getProject(projectId: string): Promise<Project> {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/projects/${projectId}`,
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch project' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    const data = await response.json();
    // Convert date strings to Date objects
    return {
      ...data,
      created_at: new Date(data.created_at),
      updated_at: new Date(data.updated_at),
    };
  },

  // Project API Key functions
  async getProjectApiKeys(projectId: string) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/api-keys/project/${projectId}`,
      {
        credentials: 'include',
        headers: {
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  async createProjectApiKey(data: { projectId: string; name: string }) {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/api-keys`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': data.projectId,
      },
      body: JSON.stringify({ name: data.name, project_id: data.projectId }),
    });
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  async deleteProjectApiKey(data: { projectId: string; keyId: string }) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/api-keys/${data.keyId}`,
      {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-Project-ID': data.projectId,
        },
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  // Project member functions
  async getProjectMembers(projectId: string) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/projects/${projectId}/members`,
      {
        credentials: 'include',
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  async addProjectMember(data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  }) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/projects/${data.projectId}/members`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': data.projectId,
        },
        body: JSON.stringify({ userId: data.userId, role: data.role }),
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  async updateProjectMemberRole(data: {
    projectId: string;
    userId: string;
    role: string;
  }) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/projects/${data.projectId}/members/${data.userId}`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': data.projectId,
        },
        body: JSON.stringify({ role: data.role }),
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  async removeProjectMember(data: { projectId: string; userId: string }) {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/projects/${data.projectId}/members/${data.userId}`,
      {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-Project-ID': data.projectId,
        },
      }
    );
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  },

  // Agent functions
  async getAgents(projectId: string): Promise<Agent[]> {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/agents`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Project-ID': projectId,
      },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch agents' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async getAgent(
    projectId: string,
    agentId: string,
    deploymentId?: string
  ): Promise<Agent> {
    const params = deploymentId
      ? `?deployment_id=${encodeURIComponent(deploymentId)}`
      : '';
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/agents/${agentId}${params}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch agent' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  // Workflow functions
  async getWorkflows(projectId: string): Promise<Workflow[]> {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/workflows`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Project-ID': projectId,
      },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch workflows' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async getWorkflow(
    projectId: string,
    workflowId: string,
    deploymentId?: string
  ): Promise<Workflow> {
    const params = deploymentId
      ? `?deployment_id=${encodeURIComponent(deploymentId)}`
      : '';
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/workflows/${workflowId}${params}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch workflow' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async runWorkflow(
    projectId: string,
    workflowId: string,
    payload: Record<string, any>,
    options?: { sessionId?: string; deploymentId?: string }
  ): Promise<any> {
    const body: Record<string, any> = { payload };
    if (options?.sessionId) {
      body.session_id = options.sessionId;
    }
    if (options?.deploymentId) {
      body.deployment_id = options.deploymentId;
    }
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/workflows/${workflowId}/run`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to run workflow' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  // Stream events from SSE endpoint
  // Note: EventSource doesn't support custom headers, so we rely on cookies for authentication
  async updateUserProfile(
    firstName?: string,
    lastName?: string,
    displayName?: string
  ): Promise<any> {
    return await putJSON('/api/v1/auth/me', {
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
    });
  },

  streamEvents(
    projectId: string,
    workflowId: string,
    workflowRunId: string,
    onEvent: (event: any) => void,
    onError?: (error: Error) => void
  ): () => void {
    // Set last_sequence_id=0 to fetch all events from the beginning
    // Note: EventSource doesn't support custom headers, so we pass project_id as a query parameter
    const url = `${getApiBaseUrl()}/api/v1/events/stream?workflow_id=${encodeURIComponent(workflowId)}&workflow_run_id=${encodeURIComponent(workflowRunId)}&last_sequence_id=0&project_id=${encodeURIComponent(projectId)}`;

    const eventSource = new EventSource(url, {
      withCredentials: true,
    });

    eventSource.addEventListener('message', (e) => {
      try {
        // Skip keepalive messages (they're sent as plain strings, not JSON)
        if (e.data === 'keepalive') {
          return;
        }

        // Parse JSON data for actual events
        const data = JSON.parse(e.data);
        onEvent(data);
      } catch (err) {
        console.error('Failed to parse SSE event:', err, e);
        // If parsing fails and it's not a keepalive, log the error
        if (e.data !== 'keepalive') {
          console.error('Failed to parse SSE event:', err, 'Data:', e.data);
        }
      }
    });

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      if (onError) {
        onError(new Error('SSE connection failed'));
      }
      eventSource.close();
    };

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  },

  // Tool functions
  async getTools(projectId: string): Promise<Tool[]> {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/tools`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Project-ID': projectId,
      },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch tools' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async getTool(
    projectId: string,
    toolId: string,
    deploymentId?: string
  ): Promise<Tool> {
    const params = deploymentId
      ? `?deployment_id=${encodeURIComponent(deploymentId)}`
      : '';
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/tools/${toolId}${params}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch tool' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async getWorkerStatus(
    projectId: string,
    deploymentId: string
  ): Promise<{ online_count: number; has_workers: boolean }> {
    const params = new URLSearchParams({ deployment_id: deploymentId });
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/workers/status?${params.toString()}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  async getWorkflowRuns(
    projectId: string,
    workflowType: string = 'workflow',
    workflowId?: string,
    limit: number = 50,
    offset: number = 0,
    startTime?: string,
    endTime?: string
  ): Promise<WorkflowRunSummary[]> {
    const params = new URLSearchParams({
      workflow_type: workflowType,
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (workflowId) {
      params.append('workflow_id', workflowId);
    }
    if (startTime) {
      params.append('start_time', startTime);
    }
    if (endTime) {
      params.append('end_time', endTime);
    }
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/workflows/runs?${params.toString()}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch workflow runs' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  async runTool(
    projectId: string,
    toolId: string,
    parameters: Record<string, any>
  ): Promise<any> {
    // Tools are workflows, so use the submit_workflow endpoint and return execution metadata.
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/workflows/${toolId}/run`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
        body: JSON.stringify({
          payload: parameters,
        }),
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to run tool' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    // Typically { execution_id, created_at }
    return response.json();
  },

  async cancelExecution(projectId: string, executionId: string): Promise<void> {
    await postJSON<void>(
      `/api/v1/executions/${executionId}/cancel`,
      {},
      projectId
    );
  },

  async getSessionMemory(
    projectId: string,
    sessionId: string
  ): Promise<{ summary: string | null; messages: any[] }> {
    const response = await fetch(
      `${getApiBaseUrl()}/internal/session/${encodeURIComponent(sessionId)}/memory`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Project-ID': projectId,
        },
      }
    );
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Failed to fetch session memory' }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return response.json();
  },

  // Session functions
  async getSessions(
    projectId: string,
    params?: {
      start_time?: string;
      end_time?: string;
      status?: string;
      agent_id?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ sessions: SessionListItem[] }> {
    const queryParams = new URLSearchParams();
    if (params?.start_time) queryParams.append('start_time', params.start_time);
    if (params?.end_time) queryParams.append('end_time', params.end_time);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.agent_id) queryParams.append('agent_id', params.agent_id);
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.offset) queryParams.append('offset', String(params.offset));

    const query = queryParams.toString();
    return getJSON<{ sessions: SessionListItem[] }>(
      `/api/v1/sessions${query ? `?${query}` : ''}`,
      projectId
    );
  },

  async getSessionDetail(
    projectId: string,
    executionId: string
  ): Promise<SessionDetail> {
    return getJSON<SessionDetail>(`/api/v1/sessions/${executionId}`, projectId);
  },

  // Trace functions
  async getTrace(projectId: string, traceId: string): Promise<Trace> {
    return getJSON<Trace>(`/api/v1/traces/${traceId}`, projectId);
  },

  async getTraces(
    projectId: string,
    params?: {
      start_time?: string;
      end_time?: string;
      root_span_type?: string;
      root_span_name?: string;
      has_error?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ traces: TraceListItem[] }> {
    const queryParams = new URLSearchParams();
    if (params?.start_time) queryParams.append('start_time', params.start_time);
    if (params?.end_time) queryParams.append('end_time', params.end_time);
    if (params?.root_span_type)
      queryParams.append('root_span_type', params.root_span_type);
    if (params?.root_span_name)
      queryParams.append('root_span_name', params.root_span_name);
    if (params?.has_error !== undefined)
      queryParams.append('has_error', String(params.has_error));
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.offset) queryParams.append('offset', String(params.offset));

    const query = queryParams.toString();
    return getJSON<{ traces: TraceListItem[] }>(
      `/api/v1/traces${query ? `?${query}` : ''}`,
      projectId
    );
  },
};
