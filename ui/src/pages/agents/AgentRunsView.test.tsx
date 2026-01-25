import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { AgentRunsView } from './AgentRunsView';
import { api } from '@/lib/api';
import { mockWorkflowRuns } from '@/test/mockData';

// Mock the API
vi.mock('@/lib/api', () => ({
  api: {
    getWorkflowRuns: vi.fn(),
    cancelExecution: vi.fn(),
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockApi = vi.mocked(api);

describe('AgentRunsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getWorkflowRuns.mockResolvedValue(mockWorkflowRuns);
  });

  describe('initial render', () => {
    it('shows loading state initially', () => {
      mockApi.getWorkflowRuns.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AgentRunsView />);

      expect(screen.getByText('Loading agent runs...')).toBeInTheDocument();
    });

    it('fetches runs on mount with default 24h filter', async () => {
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(mockApi.getWorkflowRuns).toHaveBeenCalledWith(
          expect.any(String), // projectId
          'agent',
          undefined, // no workflowId filter
          100,
          0,
          expect.any(String), // startTime ISO
          expect.any(String) // endTime ISO
        );
      });
    });

    it('displays runs table when data is loaded', async () => {
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Check for table headers
      expect(screen.getByText('Input')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Started At')).toBeInTheDocument();
    });

    it('shows error message on fetch failure', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockApi.getWorkflowRuns.mockRejectedValue(
        new Error('Failed to fetch runs')
      );

      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
        expect(screen.getByText(/Failed to fetch runs/)).toBeInTheDocument();
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('filtering', () => {
    it('applies time presets correctly', async () => {
      const user = userEvent.setup();
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Open filters
      const filterButton = screen.getByText('Add Filters');
      await user.click(filterButton);

      // Click 1h preset
      const oneHourButton = screen.getByRole('button', { name: '1h' });
      await user.click(oneHourButton);

      // Click Apply Filters to trigger fetch
      const applyButton = screen.getByText('Apply Filters');
      await user.click(applyButton);

      await waitFor(() => {
        expect(mockApi.getWorkflowRuns).toHaveBeenCalledTimes(2); // Initial + after preset
      });
    });

    it('handles custom time range', async () => {
      const user = userEvent.setup();
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Open filters
      const filterButton = screen.getByText('Add Filters');
      await user.click(filterButton);

      // Select custom
      const customButton = screen.getByRole('button', { name: 'Custom' });
      await user.click(customButton);

      // Should show custom time inputs - wait for the inputs to appear
      // datetime-local inputs might not be recognized as textbox, so check by type
      await waitFor(() => {
        const inputs = document.querySelectorAll(
          'input[type="datetime-local"]'
        );
        expect(inputs.length).toBe(2); // Start and End time inputs
      });
    });

    it('refreshes data when refresh button is clicked', async () => {
      const user = userEvent.setup();
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      await waitFor(() => {
        expect(mockApi.getWorkflowRuns).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('cancel functionality', () => {
    it('shows cancel button on hover for running status', async () => {
      const runsWithRunning = [
        {
          ...mockWorkflowRuns[0],
          id: 'run-running',
          root_execution_id: 'exec-running',
          status: 'running',
        },
      ];
      mockApi.getWorkflowRuns.mockResolvedValue(runsWithRunning as any);

      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Find the status cell for the running run
      const statusCell = screen.getByText('running').closest('td');
      if (statusCell) {
        // Hover over the status cell
        await userEvent.hover(statusCell);

        // Should show cancel button
        await waitFor(() => {
          expect(screen.getByText('Cancel')).toBeInTheDocument();
        });
      }
    });

    it('shows cancel button on hover for waiting status', async () => {
      const runsWithWaiting = [
        {
          ...mockWorkflowRuns[0],
          id: 'run-waiting',
          root_execution_id: 'exec-waiting',
          status: 'waiting',
        },
      ];
      mockApi.getWorkflowRuns.mockResolvedValue(runsWithWaiting as any);

      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      const statusCell = screen.getByText('waiting').closest('td');
      if (statusCell) {
        await userEvent.hover(statusCell);

        await waitFor(() => {
          expect(screen.getByText('Cancel')).toBeInTheDocument();
        });
      }
    });

    it('does not show cancel button for completed status', async () => {
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      const statusCell = screen.getByText('completed').closest('td');
      if (statusCell) {
        await userEvent.hover(statusCell);

        // Cancel button should not appear
        expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
      }
    });
  });

  describe('table rendering', () => {
    it('displays all columns correctly', async () => {
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Check for all column headers
      expect(screen.getByText('Agent')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Started At')).toBeInTheDocument();
      expect(screen.getByText('Ended At')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Input')).toBeInTheDocument();
      expect(screen.getByText('Output')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Run ID')).toBeInTheDocument();
    });

    it('shows empty state when no runs', async () => {
      mockApi.getWorkflowRuns.mockResolvedValue([]);

      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText(/No agent runs found/)).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates to trace detail on run click', async () => {
      const user = userEvent.setup();
      render(<AgentRunsView />);

      await waitFor(() => {
        expect(screen.getByText('Agent Runs')).toBeInTheDocument();
      });

      // Find a run row and click it
      // The execution_id should be converted to trace_id (remove hyphens)
      const runRow = screen.getByText('workflow-1').closest('tr');
      if (runRow) {
        await user.click(runRow);

        await waitFor(() => {
          expect(mockNavigate).toHaveBeenCalledWith(
            expect.stringContaining('/traces/')
          );
        });
      }
    });
  });
});
