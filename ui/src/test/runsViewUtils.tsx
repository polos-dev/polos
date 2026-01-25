import { vi } from 'vitest';
import type { WorkflowRunSummary } from '@/types/models';
import { mockWorkflowRuns } from './mockData';

/**
 * Shared test utilities for Runs views (AgentRunsView, WorkflowRunsView, ToolRunsView)
 */

export const createMockRunsViewProps = () => {
  return {
    selectedProjectId: 'project-1',
  };
};

/**
 * Mocks the api.getWorkflowRuns function
 */
export const mockGetWorkflowRuns = (
  runs: WorkflowRunSummary[] = mockWorkflowRuns
) => {
  const { api } = require('@/lib/api');
  return vi.spyOn(api, 'getWorkflowRuns').mockResolvedValue(runs);
};

/**
 * Mocks the api.cancelExecution function
 */
export const mockCancelExecution = (shouldSucceed = true) => {
  const { api } = require('@/lib/api');
  if (shouldSucceed) {
    return vi.spyOn(api, 'cancelExecution').mockResolvedValue(undefined);
  } else {
    return vi
      .spyOn(api, 'cancelExecution')
      .mockRejectedValue(new Error('Cancel failed'));
  }
};

/**
 * Helper to wait for runs to be loaded
 */
export const waitForRunsToLoad = async (
  queryByText: (text: string) => HTMLElement | null
) => {
  // Wait for loading to disappear and runs to appear
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (queryByText('Loading') === null) {
      // Loading is gone, check if runs are visible
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/**
 * Creates mock runs with different statuses for testing
 */
export const createMockRunsWithStatuses = () => {
  return [
    {
      ...mockWorkflowRuns[0],
      status: 'completed',
    },
    {
      ...mockWorkflowRuns[1],
      status: 'running',
    },
    {
      ...mockWorkflowRuns[2],
      status: 'waiting',
    },
    {
      ...mockWorkflowRuns[0],
      id: 'run-failed',
      status: 'failed',
    },
  ] as WorkflowRunSummary[];
};
