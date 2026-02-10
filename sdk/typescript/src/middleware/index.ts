/**
 * Middleware module - hooks and guardrails for workflow/agent execution.
 */

// Hooks
export {
  type HookContext,
  type HookResultType,
  type HookHandler,
  type Hook,
  type DefineHookOptions,
  HookResult,
  defineHook,
  isHook,
  normalizeHook,
  normalizeHooks,
} from './hook.js';

export {
  HookExecutionError,
  type HookChainResult,
  type ExecuteHooksOptions,
  executeHookChain,
  executeHooksOrThrow,
  composeHooks,
  conditionalHook,
} from './hook-executor.js';

// Guardrails
export {
  type GuardrailContext,
  type GuardrailResultType,
  type GuardrailHandler,
  type Guardrail,
  type DefineGuardrailOptions,
  GuardrailResult,
  defineGuardrail,
  isGuardrail,
  normalizeGuardrail,
  normalizeGuardrails,
} from './guardrail.js';

export {
  GuardrailError,
  type GuardrailChainResult,
  type ExecuteGuardrailsOptions,
  executeGuardrailChain,
  executeGuardrailsOrThrow,
  composeGuardrails,
} from './guardrail-executor.js';
