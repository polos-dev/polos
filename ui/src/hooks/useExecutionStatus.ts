import { useEffect, useState } from 'react';

interface ExecutionStatusState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  result: any | null;
  error: string | null;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const EXECUTION_POLL_INTERVAL_MS = 1000;
const EXECUTION_MAX_ATTEMPTS = 60;

export function useExecutionStatus(
  executionId: string | null,
  projectId: string | null
): ExecutionStatusState {
  const [state, setState] = useState<ExecutionStatusState>({
    status: 'idle',
    result: null,
    error: null,
  });

  useEffect(() => {
    if (!executionId || !projectId) {
      setState({ status: 'idle', result: null, error: null });
      return;
    }

    let cancelled = false;

    const poll = async () => {
      setState((prev) => ({ ...prev, status: 'running', error: null }));

      for (
        let attempt = 0;
        attempt < EXECUTION_MAX_ATTEMPTS && !cancelled;
        attempt++
      ) {
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/v1/executions/${executionId}`,
            {
              credentials: 'include',
              headers: {
                Accept: 'application/json',
                'X-Project-ID': projectId,
              },
            }
          );

          if (!res.ok) {
            throw new Error(`Failed to get execution status: ${res.status}`);
          }

          const execution = await res.json();
          if (cancelled) return;

          if (execution.status === 'completed') {
            setState({
              status: 'completed',
              result: execution.result ?? execution,
              error: null,
            });
            return;
          }

          if (execution.status === 'failed') {
            setState({
              status: 'failed',
              result: null,
              error: execution.error || 'Execution failed',
            });
            return;
          }
        } catch (e) {
          if (cancelled) return;
          setState({
            status: 'failed',
            result: null,
            error:
              e instanceof Error ? e.message : 'Failed to get execution status',
          });
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, EXECUTION_POLL_INTERVAL_MS)
        );
      }

      if (!cancelled) {
        setState((prev) =>
          prev.status === 'completed' || prev.status === 'failed'
            ? prev
            : { status: 'failed', result: null, error: 'Execution timed out' }
        );
      }
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [executionId, projectId]);

  return state;
}
