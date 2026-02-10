/**
 * Example guardrails for validating and modifying agent responses.
 */

import {
  defineGuardrail,
  MiddlewareGuardrailResult as GuardrailResult,
} from '@polos/sdk';
import type { GuardrailResultType } from '@polos/sdk';

// List of blocked words/phrases
const BLOCKED_PHRASES = [
  'ignore previous instructions',
  'disregard',
  'pretend you are',
  'act as if',
];

// Regex patterns for PII detection
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * Block potential prompt injection attempts in LLM responses.
 */
export const blockPromptInjection = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    const content = guardrailCtx.content ?? '';
    const contentLower = content.toLowerCase();

    for (const phrase of BLOCKED_PHRASES) {
      if (contentLower.includes(phrase)) {
        return GuardrailResult.fail(
          `Response blocked: potential prompt injection detected ('${phrase}')`,
        );
      }
    }

    return GuardrailResult.continue();
  },
  { name: 'block_prompt_injection' },
);

/**
 * Redact PII (emails, phone numbers, SSNs) from responses.
 */
export const redactPii = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    let content = guardrailCtx.content ?? '';
    const original = content;

    // Redact emails
    content = content.replace(EMAIL_PATTERN, '[EMAIL REDACTED]');

    // Redact phone numbers
    content = content.replace(PHONE_PATTERN, '[PHONE REDACTED]');

    // Redact SSNs
    content = content.replace(SSN_PATTERN, '[SSN REDACTED]');

    if (content !== original) {
      return GuardrailResult.continueWith({ modifiedContent: content });
    }

    return GuardrailResult.continue();
  },
  { name: 'redact_pii' },
);

/**
 * Limit the number of tool calls per turn to prevent runaway agents.
 */
export const limitToolCalls = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    const maxCalls = 5;
    const toolCalls = guardrailCtx.toolCalls ?? [];

    if (toolCalls.length > maxCalls) {
      const limitedCalls = toolCalls.slice(0, maxCalls);
      return GuardrailResult.continueWith({ modifiedToolCalls: limitedCalls });
    }

    return GuardrailResult.continue();
  },
  { name: 'limit_tool_calls' },
);

/**
 * Add a disclaimer to AI-generated content.
 */
export const addAiDisclaimer = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    const content = guardrailCtx.content ?? '';

    if (content && !content.endsWith('[AI Generated]')) {
      const modified = content + '\n\n---\n*[AI Generated Content]*';
      return GuardrailResult.continueWith({ modifiedContent: modified });
    }

    return GuardrailResult.continue();
  },
  { name: 'add_ai_disclaimer' },
);

/**
 * Block calls to dangerous tools.
 */
export const blockDangerousTools = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    const dangerousTools = ['delete_file', 'execute_code', 'send_email'];
    const toolCalls = guardrailCtx.toolCalls ?? [];

    for (const call of toolCalls) {
      if (dangerousTools.includes(call.name)) {
        return GuardrailResult.fail(
          `Blocked: Agent attempted to call dangerous tool '${call.name}'`,
        );
      }
    }

    return GuardrailResult.continue();
  },
  { name: 'block_dangerous_tools' },
);

/**
 * Enforce maximum response length.
 */
export const enforceResponseLength = defineGuardrail(
  async (_ctx, guardrailCtx): Promise<GuardrailResultType> => {
    const maxLength = 2000;
    const content = guardrailCtx.content ?? '';

    if (content.length > maxLength) {
      const truncated = content.slice(0, maxLength) + '... [Response truncated]';
      return GuardrailResult.continueWith({ modifiedContent: truncated });
    }

    return GuardrailResult.continue();
  },
  { name: 'enforce_response_length' },
);
