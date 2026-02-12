/**
 * Sandbox tools factory.
 *
 * Creates a set of tools (exec, read, write, edit, glob, grep) that share
 * a lazily-initialized execution environment via closure. The environment
 * is created on first tool use and reused for all subsequent calls.
 *
 * @example
 * ```typescript
 * import { defineAgent, sandboxTools } from '@polos/sdk';
 *
 * const agent = defineAgent({
 *   id: 'solver',
 *   tools: sandboxTools({
 *     env: 'docker',
 *     docker: { image: 'node:20', workspaceDir: '/path/to/project' },
 *   }),
 * });
 * ```
 */

import type { ToolWorkflow } from '../core/tool.js';
import type { ExecutionEnvironment, SandboxToolsConfig, ExecToolConfig } from './types.js';
import { DockerEnvironment } from './docker.js';
import { LocalEnvironment } from './local.js';
import { createExecTool } from './tools/exec.js';
import { createReadTool } from './tools/read.js';
import { createWriteTool } from './tools/write.js';
import { createEditTool } from './tools/edit.js';
import { createGlobTool } from './tools/glob.js';
import { createGrepTool } from './tools/grep.js';

/**
 * Return type for sandboxTools — an array of ToolWorkflow with a cleanup method.
 */
export interface SandboxToolsResult extends Array<ToolWorkflow> {
  /** Destroy the shared execution environment (remove container, etc.) */
  cleanup(): Promise<void>;
}

/**
 * Create an execution environment from config.
 * @internal
 */
function createEnvironment(config?: SandboxToolsConfig): ExecutionEnvironment {
  const envType = config?.env ?? 'docker';

  switch (envType) {
    case 'docker': {
      const dockerConfig = config?.docker ?? {
        image: 'node:20-slim',
        workspaceDir: process.cwd(),
      };
      return new DockerEnvironment(dockerConfig, config?.exec?.maxOutputChars);
    }
    case 'e2b':
      throw new Error('E2B environment is not yet implemented.');
    case 'local':
      return new LocalEnvironment(config?.local, config?.exec?.maxOutputChars);
    default:
      throw new Error(`Unknown environment type: ${String(envType)}`);
  }
}

/**
 * Create sandbox tools for AI agents.
 *
 * Returns an array of ToolWorkflow that can be passed directly to defineAgent().
 * All tools share a single execution environment that is lazily created on first use.
 *
 * The returned array has a `cleanup()` method for destroying the environment.
 */
export function sandboxTools(config?: SandboxToolsConfig): SandboxToolsResult {
  // Lazy environment — created on first tool use
  let env: ExecutionEnvironment | null = null;
  let envPromise: Promise<ExecutionEnvironment> | null = null;

  async function getEnv(): Promise<ExecutionEnvironment> {
    if (env) return env;
    if (envPromise) return envPromise;

    envPromise = (async () => {
      const created = createEnvironment(config);
      await created.initialize();
      env = created;
      return env;
    })();

    return envPromise;
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

  // For local mode, default file-mutating tools (write, edit) to approval-always
  const fileApproval = config?.fileApproval ?? (envType === 'local' ? 'always' : undefined);

  // Path restriction for read-only tools (read, glob, grep) — approval gate
  const pathConfig = config?.local?.pathRestriction
    ? { pathRestriction: config.local.pathRestriction }
    : undefined;

  // Determine which tools to include
  const include = new Set(
    config?.tools ?? (['exec', 'read', 'write', 'edit', 'glob', 'grep'] as const)
  );

  const tools: ToolWorkflow[] = [];

  if (include.has('exec')) tools.push(createExecTool(getEnv, effectiveExecConfig));
  if (include.has('read')) tools.push(createReadTool(getEnv, pathConfig));
  if (include.has('write')) tools.push(createWriteTool(getEnv, fileApproval));
  if (include.has('edit')) tools.push(createEditTool(getEnv, fileApproval));
  if (include.has('glob')) tools.push(createGlobTool(getEnv, pathConfig));
  if (include.has('grep')) tools.push(createGrepTool(getEnv, pathConfig));

  // Create result array with cleanup method
  const result = tools as SandboxToolsResult;
  result.cleanup = async () => {
    if (env) {
      await env.destroy();
      env = null;
      envPromise = null;
    }
  };

  return result;
}
