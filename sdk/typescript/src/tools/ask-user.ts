/**
 * Ask-user tool — lets agents ask questions and receive answers from the user.
 *
 * Uses ctx.step.suspend() to pause the workflow, emit a suspend event with a
 * _form schema, and wait for the user to respond via client.resume(). Supports
 * both structured form fields and simple free-text responses.
 */

import { z } from 'zod';
import { defineTool } from '../core/tool.js';
import type { ToolWorkflow } from '../core/tool.js';

const askUserInputSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  title: z.string().optional().describe('Short title for the question (shown as heading)'),
  fields: z
    .array(
      z.object({
        key: z.string().describe('Unique key for this field'),
        type: z.enum(['text', 'textarea', 'number', 'boolean', 'select']).describe('Field type'),
        label: z.string().describe('Label shown to user'),
        description: z.string().optional().describe('Help text for the field'),
        required: z.boolean().optional().describe('Whether this field is required'),
        options: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
            })
          )
          .optional()
          .describe('Options for select fields'),
      })
    )
    .optional()
    .describe(
      'Structured form fields for the response. If omitted, shows a single text response field.'
    ),
});

/**
 * Create the ask_user tool for agent-to-user communication.
 *
 * When an agent calls this tool, the workflow suspends and emits a suspend
 * event with a `_form` schema. The client handles the event, collects the
 * user's response, and resumes the workflow with the response data.
 *
 * @example
 * ```typescript
 * import { createAskUserTool } from '@polos/sdk';
 *
 * const askUser = createAskUserTool();
 * // Add to agent tools array
 * ```
 */
export function createAskUserTool(): ToolWorkflow {
  return defineTool(
    {
      id: 'ask_user',
      description:
        'Ask the user a question and wait for their response. ' +
        'Use this when you need clarification, a decision, or any input from the user. ' +
        'You can define structured fields (text, select, boolean, etc.) ' +
        'for specific response formats, or omit fields for a free-text response.',
      inputSchema: askUserInputSchema,
    },
    async (ctx, input) => {
      const fields = input.fields ?? [
        {
          key: 'response',
          type: 'textarea' as const,
          label: input.question,
          required: true,
        },
      ];

      const response = await ctx.step.suspend('ask_user', {
        data: {
          _form: {
            title: input.title ?? 'Agent Question',
            description: input.question,
            fields,
          },
          _source: 'ask_user',
          _tool: 'ask_user',
        },
      });

      return (response as Record<string, unknown> | undefined)?.['data'] ?? {};
    }
  ) as ToolWorkflow;
}
