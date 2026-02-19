/**
 * Sandbox tools factory.
 *
 * Creates a set of tools (exec, read, write, edit, glob, grep) that share
 * a managed sandbox. The sandbox is created lazily on first tool use
 * via the SandboxManager injected through the execution context.
 *
 * @example
 * ```typescript
 * import { defineAgent, sandboxTools } from '@polos/sdk';
 *
 * // Per-execution (default) — sandbox dies when the workflow finishes
 * const agent = defineAgent({
 *   id: 'solver',
 *   tools: sandboxTools({
 *     env: 'docker',
 *     docker: { image: 'node:20', workspaceDir: '/path/to/project' },
 *   }),
 * });
 *
 * // Per-session — sandbox lives across turns
 * const agent2 = defineAgent({
 *   id: 'coder',
 *   tools: sandboxTools({
 *     scope: 'session',
 *     env: 'docker',
 *     docker: { image: 'node:20', workspaceDir: '/path/to/project' },
 *   }),
 * });
 * ```
 */

import type { ToolWorkflow } from '../core/tool.js';
import type { ExecutionEnvironment, SandboxToolsConfig, ExecToolConfig } from './types.js';
import type { Sandbox } from './sandbox.js';
import { getExecutionContext } from '../runtime/execution-context.js';
import { createExecTool } from './tools/exec.js';
import { createReadTool } from './tools/read.js';
import { createWriteTool } from './tools/write.js';
import { createEditTool } from './tools/edit.js';
import { createGlobTool } from './tools/glob.js';
import { createGrepTool } from './tools/grep.js';

/**
 * Create sandbox tools for AI agents.
 *
 * Returns an array of ToolWorkflow that can be passed directly to defineAgent().
 * All tools share a single managed sandbox that is lazily created on first use.
 * Lifecycle is managed by the SandboxManager — no manual cleanup needed.
 */
export function sandboxTools(config?: SandboxToolsConfig): ToolWorkflow[] {
  // Cache keyed by rootExecutionId so all tool sub-workflows within the same
  // agent run share one sandbox. Each tool call runs as a separate sub-workflow
  // with its own executionId, but rootExecutionId is stable across them.
  const sandboxCache = new Map<string, Sandbox>();

  async function getEnv(): Promise<ExecutionEnvironment> {
    const ctx = getExecutionContext();
    if (!ctx) {
      throw new Error(
        'sandboxTools requires an execution context. ' +
          'Ensure tools are called within a workflow execution.'
      );
    }

    const { executionId, rootExecutionId, sessionId, sandboxManager } = ctx;
    if (!sandboxManager) {
      throw new Error(
        'No SandboxManager found in execution context. ' +
          'Ensure the Worker is configured to inject sandboxManager.'
      );
    }

    // Use rootExecutionId as cache key so all tool calls in the same agent
    // run share one sandbox. Falls back to executionId for top-level workflows.
    const cacheKey = rootExecutionId ?? executionId;

    // Check cache first
    const cached = sandboxCache.get(cacheKey);
    if (cached && !cached.destroyed) {
      return cached.getEnvironment();
    }

    // Create or retrieve sandbox via manager
    const sandbox = await sandboxManager.getOrCreateSandbox(config ?? {}, {
      executionId: cacheKey,
      sessionId,
    });
    sandboxCache.set(cacheKey, sandbox);

    return sandbox.getEnvironment();
  }

  // Validate environment type eagerly
  const envType = config?.env ?? 'docker';
  if (envType === 'e2b') {
    throw new Error('E2B environment is not yet implemented.');
  }

  // For local mode, default exec security to 'approval-always' (no sandbox isolation)
  const effectiveExecConfig: ExecToolConfig | undefined =
    envType === 'local' && !config?.exec?.security
      ? { ...config?.exec, security: 'approval-always' }
      : config?.exec;

  // Path restriction — used by read, write, edit, glob, grep for approval gating
  const pathConfig = config?.local?.pathRestriction
    ? { pathRestriction: config.local.pathRestriction }
    : undefined;

  // fileApproval overrides path-restriction behavior for write/edit.
  // 'always' = approve every write/edit regardless of path.
  // 'none' = never approve (skip path restriction too).
  // undefined = use path restriction (approve only outside cwd).
  const fileApproval = config?.fileApproval;

  // Build write/edit config: explicit approval overrides path restriction
  const writeEditConfig = fileApproval
    ? { approval: fileApproval }
    : pathConfig
      ? { pathConfig }
      : undefined;

  // Determine which tools to include
  const include = new Set(
    config?.tools ?? (['exec', 'read', 'write', 'edit', 'glob', 'grep'] as const)
  );

  const tools: ToolWorkflow[] = [];

  if (include.has('exec')) tools.push(createExecTool(getEnv, effectiveExecConfig));
  if (include.has('read')) tools.push(createReadTool(getEnv, pathConfig));
  if (include.has('write')) tools.push(createWriteTool(getEnv, writeEditConfig));
  if (include.has('edit')) tools.push(createEditTool(getEnv, writeEditConfig));
  if (include.has('glob')) tools.push(createGlobTool(getEnv, pathConfig));
  if (include.has('grep')) tools.push(createGrepTool(getEnv, pathConfig));

  return tools;
}
