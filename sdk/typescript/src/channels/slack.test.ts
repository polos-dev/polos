import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { SlackChannel } from './slack.js';
import type { SuspendNotification, ChannelContext } from './channel.js';
import type { StreamEvent } from '../types/events.js';

/** Helper to build a minimal SuspendNotification with optional overrides. */
function makeNotification(overrides?: Partial<SuspendNotification>): SuspendNotification {
  return {
    workflowId: 'wf-1',
    executionId: 'exec-1',
    stepKey: 'step-1',
    approvalUrl: 'https://example.com/approve/exec-1/step-1',
    ...overrides,
  };
}

/** Capture the body sent to Slack by mocking global fetch. */
function mockFetch(response: { ok: boolean; error?: string }) {
  const captured: { body?: Record<string, unknown> } = {};
  const originalFetch = globalThis.fetch;

  const fetchMock = mock.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) {
      captured.body = JSON.parse(init.body as string);
    }
    return {
      json: async () => response,
    } as Response;
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return {
    captured,
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('SlackChannel', () => {
  const validConfig = { botToken: 'xoxb-test-token', defaultChannel: '#test' };
  let channel: SlackChannel;

  beforeEach(() => {
    channel = new SlackChannel(validConfig);
  });

  describe('constructor', () => {
    it('throws on invalid bot token', () => {
      assert.throws(
        () => new SlackChannel({ botToken: 'bad-token', defaultChannel: '#test' }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('xoxb-'));
          return true;
        }
      );
    });

    it('accepts valid xoxb- token', () => {
      const ch = new SlackChannel(validConfig);
      assert.strictEqual(ch.id, 'slack');
    });
  });

  describe('notify — simple approval (Approve/Reject buttons)', () => {
    it('renders Approve, Reject, and View Details buttons for simple approval form', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(
          makeNotification({
            title: 'Tool approval',
            formFields: [
              { key: 'approved', type: 'boolean', label: 'Approved' },
              { key: 'feedback', type: 'string', label: 'Feedback' },
            ],
          })
        );

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        assert.ok(actionsBlock, 'Expected an actions block');

        const elements = actionsBlock['elements'] as Record<string, unknown>[];
        assert.strictEqual(elements.length, 3, 'Expected 3 buttons');

        // Approve button
        assert.strictEqual(elements[0]?.['action_id'], 'polos_approve');
        assert.strictEqual(elements[0]?.['style'], 'primary');
        const approveValue = JSON.parse(elements[0]?.['value'] as string);
        assert.strictEqual(approveValue.executionId, 'exec-1');
        assert.strictEqual(approveValue.stepKey, 'step-1');
        assert.strictEqual(approveValue.approved, true);

        // Reject button
        assert.strictEqual(elements[1]?.['action_id'], 'polos_reject');
        assert.strictEqual(elements[1]?.['style'], 'danger');
        const rejectValue = JSON.parse(elements[1]?.['value'] as string);
        assert.strictEqual(rejectValue.approved, false);

        // View Details link button
        assert.strictEqual(elements[2]?.['url'], 'https://example.com/approve/exec-1/step-1');
        assert.strictEqual(
          (elements[2]?.['text'] as Record<string, unknown>)?.['text'],
          'View Details'
        );
      } finally {
        restore();
      }
    });

    it('encodes correct executionId and stepKey in button values', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(
          makeNotification({
            executionId: 'abc-123',
            stepKey: 'approval_step',
            formFields: [{ key: 'approved', type: 'boolean' }],
          })
        );

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        const elements = actionsBlock?.['elements'] as Record<string, unknown>[];
        const approveValue = JSON.parse(elements[0]?.['value'] as string);

        assert.strictEqual(approveValue.executionId, 'abc-123');
        assert.strictEqual(approveValue.stepKey, 'approval_step');
      } finally {
        restore();
      }
    });
  });

  describe('notify — complex form (Respond link button)', () => {
    it('renders Respond link button when no formFields', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(makeNotification());

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        assert.ok(actionsBlock);

        const elements = actionsBlock['elements'] as Record<string, unknown>[];
        assert.strictEqual(elements.length, 1, 'Expected single Respond button');
        assert.strictEqual((elements[0]?.['text'] as Record<string, unknown>)?.['text'], 'Respond');
        assert.strictEqual(elements[0]?.['url'], 'https://example.com/approve/exec-1/step-1');
        assert.strictEqual(elements[0]?.['style'], 'primary');
      } finally {
        restore();
      }
    });

    it('renders Respond link button when formFields is empty', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(makeNotification({ formFields: [] }));

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        const elements = actionsBlock?.['elements'] as Record<string, unknown>[];
        assert.strictEqual(elements.length, 1);
        assert.strictEqual((elements[0]?.['text'] as Record<string, unknown>)?.['text'], 'Respond');
      } finally {
        restore();
      }
    });

    it('renders Respond link button when fields lack boolean approved', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(
          makeNotification({
            formFields: [
              { key: 'name', type: 'string' },
              { key: 'count', type: 'number' },
            ],
          })
        );

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        const elements = actionsBlock?.['elements'] as Record<string, unknown>[];
        assert.strictEqual(elements.length, 1);
        assert.strictEqual((elements[0]?.['text'] as Record<string, unknown>)?.['text'], 'Respond');
      } finally {
        restore();
      }
    });

    it('renders Respond when approved field exists but is not boolean type', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(
          makeNotification({
            formFields: [{ key: 'approved', type: 'string' }],
          })
        );

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const actionsBlock = blocks.find((b) => b['type'] === 'actions');
        const elements = actionsBlock?.['elements'] as Record<string, unknown>[];
        assert.strictEqual(elements.length, 1);
        assert.strictEqual((elements[0]?.['text'] as Record<string, unknown>)?.['text'], 'Respond');
      } finally {
        restore();
      }
    });
  });

  describe('notify — Slack API error handling', () => {
    it('throws when Slack API returns ok: false', async () => {
      const { restore } = mockFetch({ ok: false, error: 'channel_not_found' });
      try {
        await assert.rejects(
          () => channel.notify(makeNotification()),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('channel_not_found'));
            return true;
          }
        );
      } finally {
        restore();
      }
    });
  });

  describe('notify — block structure', () => {
    it('includes header, description, context, source, expiry blocks', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        await channel.notify(
          makeNotification({
            title: 'Approval Required',
            description: 'Please approve this tool call',
            source: 'ask_before_use',
            tool: 'web_search',
            context: { query: 'test' },
            expiresAt: '2026-01-01T00:00:00Z',
          })
        );

        const blocks = captured.body?.['blocks'] as Record<string, unknown>[];
        const types = blocks.map((b) => b['type']);

        assert.ok(types.includes('header'));
        assert.ok(types.includes('section'));
        assert.ok(types.includes('context'));
        assert.ok(types.includes('actions'));
      } finally {
        restore();
      }
    });
  });

  describe('sendOutput', () => {
    it('posts to the correct channel and thread', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        const context: ChannelContext = {
          channelId: 'slack',
          source: { channel: '#general', threadTs: '1234.5678' },
        };
        const event: StreamEvent = {
          id: 'evt-1',
          sequenceId: 1,
          topic: 'workflow/test/exec-1',
          eventType: 'workflow_finish',
          data: {
            _metadata: { workflow_id: 'test-wf' },
            result: 'done',
          },
        };

        await channel.sendOutput(context, event);

        assert.ok(captured.body, 'Expected fetch to be called');
        assert.strictEqual(captured.body['channel'], '#general');
        assert.strictEqual(captured.body['thread_ts'], '1234.5678');
        assert.strictEqual(captured.body['text'], 'done');
      } finally {
        restore();
      }
    });

    it('formats workflow_finish events with result', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        const context: ChannelContext = {
          channelId: 'slack',
          source: { channel: '#general' },
        };
        const event: StreamEvent = {
          id: 'evt-1',
          sequenceId: 1,
          topic: 'workflow/test/exec-1',
          eventType: 'workflow_finish',
          data: {
            _metadata: { workflow_id: 'my-agent' },
            result: 'Task completed successfully',
          },
        };

        await channel.sendOutput(context, event);

        assert.ok(captured.body);
        const text = captured.body['text'] as string;
        assert.strictEqual(text, 'Task completed successfully');
      } finally {
        restore();
      }
    });

    it('formats tool_call events', async () => {
      const { captured, restore } = mockFetch({ ok: true });
      try {
        const context: ChannelContext = {
          channelId: 'slack',
          source: { channel: '#general' },
        };
        const event: StreamEvent = {
          id: 'evt-1',
          sequenceId: 1,
          topic: 'workflow/test/exec-1',
          eventType: 'tool_call',
          data: {
            tool_call: {
              function: { name: 'web_search', arguments: '{"query":"test"}' },
            },
          },
        };

        await channel.sendOutput(context, event);

        assert.ok(captured.body);
        const text = captured.body['text'] as string;
        assert.ok(text.includes('web_search'));
      } finally {
        restore();
      }
    });

    it('skips text_delta events', async () => {
      const { fetchMock, restore } = mockFetch({ ok: true });
      try {
        const context: ChannelContext = {
          channelId: 'slack',
          source: { channel: '#general' },
        };
        const event: StreamEvent = {
          id: 'evt-1',
          sequenceId: 1,
          topic: 'workflow/test/exec-1',
          eventType: 'text_delta',
          data: { content: 'hello' },
        };

        await channel.sendOutput(context, event);

        assert.strictEqual(fetchMock.mock.callCount(), 0, 'Expected no fetch call for text_delta');
      } finally {
        restore();
      }
    });

    it('skips when channel is missing from context', async () => {
      const { fetchMock, restore } = mockFetch({ ok: true });
      try {
        const context: ChannelContext = {
          channelId: 'slack',
          source: {},
        };
        const event: StreamEvent = {
          id: 'evt-1',
          sequenceId: 1,
          topic: 'workflow/test/exec-1',
          eventType: 'workflow_finish',
          data: { result: 'done' },
        };

        await channel.sendOutput(context, event);

        assert.strictEqual(fetchMock.mock.callCount(), 0, 'Expected no fetch call without channel');
      } finally {
        restore();
      }
    });
  });
});
