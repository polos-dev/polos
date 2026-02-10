import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, getJSON, postJSON } from './api';

// Mock fetch globally
global.fetch = vi.fn();

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHeaders', () => {
    it('includes X-Project-ID header when projectId is provided', () => {
      // This is tested indirectly through other functions
      // But we can test the behavior through getJSON
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      // Test through a function that uses getHeaders
      getJSON('/test', 'project-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
          }),
        })
      );
    });

    it('does not include X-Project-ID header when projectId is not provided', () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      getJSON('/test');

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty('X-Project-ID');
    });
  });

  describe('postJSON', () => {
    it('sends POST request with JSON body', async () => {
      const mockResponse = { id: '123', name: 'Test' };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const result = await postJSON('/test', { name: 'Test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ name: 'Test' }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws error when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad Request' }),
      });
      global.fetch = mockFetch;

      await expect(postJSON('/test', {})).rejects.toThrow();
    });
  });

  describe('getJSON', () => {
    it('sends GET request with correct headers', async () => {
      const mockResponse = { data: 'test' };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const result = await getJSON('/test', 'project-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('cancelExecution', () => {
    it('sends POST request to correct endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      await api.cancelExecution('project-123', 'exec-456');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/executions/exec-456/cancel'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('handles 404 error (execution not found)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Execution not found' }),
      });
      global.fetch = mockFetch;

      await expect(
        api.cancelExecution('project-123', 'exec-456')
      ).rejects.toThrow();
    });

    it('handles 500 error (server error)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });
      global.fetch = mockFetch;

      await expect(
        api.cancelExecution('project-123', 'exec-456')
      ).rejects.toThrow();
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      await expect(
        api.cancelExecution('project-123', 'exec-456')
      ).rejects.toThrow('Network error');
    });
  });

  describe('getWorkerStatus', () => {
    it('sends GET request with correct query params and headers', async () => {
      const mockResponse = { online_count: 2, has_workers: true };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const result = await api.getWorkerStatus('project-123', 'deploy-456');

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/api/v1/workers/status');
      expect(callUrl).toContain('deployment_id=deploy-456');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('returns has_workers false when no workers online', async () => {
      const mockResponse = { online_count: 0, has_workers: false };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const result = await api.getWorkerStatus('project-123', 'deploy-456');
      expect(result.has_workers).toBe(false);
      expect(result.online_count).toBe(0);
    });

    it('handles error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      global.fetch = mockFetch;

      await expect(
        api.getWorkerStatus('project-123', 'deploy-456')
      ).rejects.toThrow();
    });
  });

  describe('getWorkflowRuns', () => {
    it('builds query params correctly with all parameters', async () => {
      const mockRuns = [{ id: 'run-1' }, { id: 'run-2' }];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRuns,
      });
      global.fetch = mockFetch;

      const result = await api.getWorkflowRuns(
        'project-123',
        'agent',
        'agent-1',
        100,
        10,
        '2026-01-15T10:00:00Z',
        '2026-01-15T11:00:00Z'
      );

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('workflow_type=agent');
      expect(callUrl).toContain('workflow_id=agent-1');
      expect(callUrl).toContain('limit=100');
      expect(callUrl).toContain('offset=10');
      expect(callUrl).toContain('start_time=');
      expect(callUrl).toContain('end_time=');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
          }),
        })
      );
      expect(result).toEqual(mockRuns);
    });

    it('builds query params correctly with minimal parameters', async () => {
      const mockRuns: any[] = [];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRuns,
      });
      global.fetch = mockFetch;

      const result = await api.getWorkflowRuns('project-123');

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('workflow_type=workflow');
      expect(callUrl).toContain('limit=50');
      expect(callUrl).toContain('offset=0');
      expect(callUrl).not.toContain('workflow_id=');
      expect(callUrl).not.toContain('start_time=');
      expect(callUrl).not.toContain('end_time=');
      expect(result).toEqual(mockRuns);
    });

    it('handles empty results', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      global.fetch = mockFetch;

      const result = await api.getWorkflowRuns('project-123');
      expect(result).toEqual([]);
    });

    it('handles error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });
      global.fetch = mockFetch;

      await expect(api.getWorkflowRuns('project-123')).rejects.toThrow();
    });
  });

  describe('getTraces', () => {
    it('builds query params correctly with all parameters', async () => {
      const mockTraces = { traces: [{ id: 'trace-1' }] };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTraces,
      });
      global.fetch = mockFetch;

      const result = await api.getTraces('project-123', {
        start_time: '2026-01-15T10:00:00Z',
        end_time: '2026-01-15T11:00:00Z',
        root_span_type: 'agent',
        root_span_name: 'test-agent',
        has_error: true,
        limit: 50,
        offset: 10,
      });

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('start_time=');
      expect(callUrl).toContain('end_time=');
      expect(callUrl).toContain('root_span_type=agent');
      expect(callUrl).toContain('root_span_name=test-agent');
      expect(callUrl).toContain('has_error=true');
      expect(callUrl).toContain('limit=50');
      expect(callUrl).toContain('offset=10');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'project-123',
          }),
        })
      );
      expect(result).toEqual(mockTraces);
    });

    it('builds query params correctly with no parameters', async () => {
      const mockTraces = { traces: [] };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTraces,
      });
      global.fetch = mockFetch;

      const result = await api.getTraces('project-123');

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/api/v1/traces');
      expect(callUrl).not.toContain('?');
      expect(result).toEqual(mockTraces);
    });

    it('handles empty results', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ traces: [] }),
      });
      global.fetch = mockFetch;

      const result = await api.getTraces('project-123');
      expect(result).toEqual({ traces: [] });
    });

    it('handles error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      global.fetch = mockFetch;

      await expect(api.getTraces('project-123')).rejects.toThrow();
    });
  });

  describe('streamEvents', () => {
    it('creates EventSource with correct URL and params', () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      let eventSourceInstance: any = null;

      // Mock EventSource
      global.EventSource = class MockEventSource {
        url: string;
        withCredentials: boolean;
        private listeners: Map<string, Set<Function>> = new Map();

        constructor(url: string, options?: { withCredentials: boolean }) {
          this.url = url;
          this.withCredentials = options?.withCredentials ?? false;
          eventSourceInstance = this;
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        close() {
          // Mock close
        }

        // Helper to simulate events
        simulateMessage(data: string) {
          const handlers = this.listeners.get('message');
          if (handlers) {
            handlers.forEach((handler) => {
              handler({ data });
            });
          }
        }

        simulateError() {
          const handlers = this.listeners.get('error');
          if (handlers) {
            handlers.forEach((handler) => {
              handler(new Error('Connection failed'));
            });
          }
        }
      } as any;

      const cleanup = api.streamEvents(
        'project-123',
        'test-workflow',
        'run-456',
        onEvent,
        onError
      );

      expect(eventSourceInstance).toBeTruthy();
      expect(eventSourceInstance.url).toContain('workflow_id=test-workflow');
      expect(eventSourceInstance.url).toContain('workflow_run_id=run-456');
      expect(eventSourceInstance.url).toContain('project_id=project-123');
      expect(eventSourceInstance.url).toContain('last_sequence_id=0');
      expect(eventSourceInstance.withCredentials).toBe(true);

      // Test cleanup
      const closeSpy = vi.spyOn(eventSourceInstance, 'close');
      cleanup();
      expect(closeSpy).toHaveBeenCalled();
    });

    it('calls onEvent for valid JSON messages', () => {
      const onEvent = vi.fn();
      let eventSourceInstance: any = null;

      global.EventSource = class MockEventSource {
        private listeners: Map<string, Set<Function>> = new Map();

        constructor() {
          eventSourceInstance = this;
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        close() {}

        simulateMessage(data: string) {
          const handlers = this.listeners.get('message');
          if (handlers) {
            handlers.forEach((handler) => {
              handler({ data });
            });
          }
        }
      } as any;

      api.streamEvents('project-123', 'test-workflow', 'run-456', onEvent);

      // Simulate valid JSON message
      eventSourceInstance.simulateMessage('{"type":"test","data":"value"}');
      expect(onEvent).toHaveBeenCalledWith({ type: 'test', data: 'value' });
    });

    it('skips keepalive messages', () => {
      const onEvent = vi.fn();
      let eventSourceInstance: any = null;

      global.EventSource = class MockEventSource {
        private listeners: Map<string, Set<Function>> = new Map();

        constructor() {
          eventSourceInstance = this;
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        close() {}

        simulateMessage(data: string) {
          const handlers = this.listeners.get('message');
          if (handlers) {
            handlers.forEach((handler) => {
              handler({ data });
            });
          }
        }
      } as any;

      api.streamEvents('project-123', 'test-workflow', 'run-456', onEvent);

      // Simulate keepalive message
      eventSourceInstance.simulateMessage('keepalive');
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('calls onError on connection errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const onError = vi.fn();
      let eventSourceInstance: any = null;

      global.EventSource = class MockEventSource {
        private listeners: Map<string, Set<Function>> = new Map();
        onerror: ((err: any) => void) | null = null;

        constructor() {
          eventSourceInstance = this;
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        close() {}

        simulateError() {
          // The actual code sets eventSource.onerror, not an event listener
          // onerror receives an Event, but the handler creates a new Error
          if (this.onerror) {
            this.onerror({} as any);
          }
        }
      } as any;

      api.streamEvents(
        'project-123',
        'test-workflow',
        'run-456',
        vi.fn(),
        onError
      );

      // Wait for onerror to be set, then simulate error
      await new Promise((resolve) => setTimeout(resolve, 10));
      eventSourceInstance.simulateError();

      // The handler creates a new Error('SSE connection failed')
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'SSE connection failed' })
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles malformed JSON gracefully', () => {
      const onEvent = vi.fn();
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      let eventSourceInstance: any = null;

      global.EventSource = class MockEventSource {
        private listeners: Map<string, Set<Function>> = new Map();

        constructor() {
          eventSourceInstance = this;
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        close() {}

        simulateMessage(data: string) {
          const handlers = this.listeners.get('message');
          if (handlers) {
            handlers.forEach((handler) => {
              handler({ data });
            });
          }
        }
      } as any;

      api.streamEvents('project-123', 'test-workflow', 'run-456', onEvent);

      // Simulate malformed JSON
      eventSourceInstance.simulateMessage('invalid json');
      expect(onEvent).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
