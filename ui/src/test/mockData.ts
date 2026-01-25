import type { User, Project, WorkflowRunSummary } from '@/types/models';

export const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  display_name: 'Test User',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  projects: [],
};

export const mockProjects: Project[] = [
  {
    id: 'project-1',
    name: 'Project 1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'project-2',
    name: 'Project 2',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

export const mockWorkflowRun: WorkflowRunSummary = {
  id: 'run-123',
  root_execution_id: 'exec-123',
  workflow_id: 'workflow-1',
  created_at: '2026-01-15T10:00:00Z',
  completed_at: '2026-01-15T10:05:00Z',
  status: 'completed',
  payload: { message: 'test input' },
  result: { result: 'test output' },
  error: undefined,
};

export const mockWorkflowRuns: WorkflowRunSummary[] = [
  mockWorkflowRun,
  {
    id: 'run-456',
    root_execution_id: 'run-456',
    workflow_id: 'workflow-2',
    status: 'running',
    created_at: '2026-01-15T11:00:00Z',
    completed_at: '2026-01-15T11:02:00Z',
    payload: { message: 'test input 2' },
    result: undefined,
    error: undefined,
  },
  {
    id: 'run-789',
    root_execution_id: 'run-789',
    workflow_id: 'workflow-3',
    status: 'failed',
    created_at: '2026-01-15T09:00:00Z',
    completed_at: '2026-01-15T09:02:00Z',
    payload: { message: 'test input 3' },
    result: undefined,
    error: 'Something went wrong',
  },
];
