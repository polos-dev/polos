/**
 * Execution framework — sandbox tools for AI agents.
 *
 * Provides tools for running commands, reading/writing files, and searching
 * codebases inside isolated environments (Docker, E2B, Local).
 *
 * @packageDocumentation
 */

// Main entry point
export { sandboxTools, type SandboxToolsResult } from './sandbox-tools.js';

// Types
export type {
  ExecutionEnvironment,
  ExecOptions,
  ExecResult,
  GlobOptions,
  GrepOptions,
  GrepMatch,
  EnvironmentInfo,
  DockerEnvironmentConfig,
  E2BEnvironmentConfig,
  LocalEnvironmentConfig,
  ExecToolConfig,
  SandboxToolsConfig,
} from './types.js';

// Environment implementations
export { DockerEnvironment } from './docker.js';

// Security utilities
export { evaluateAllowlist, assertSafePath } from './security.js';

// Output utilities
export { truncateOutput, isBinary, parseGrepOutput, stripAnsi } from './output.js';

// Tool factories
export { createExecTool } from './tools/exec.js';
export { createReadTool } from './tools/read.js';
export { createWriteTool } from './tools/write.js';
export { createEditTool } from './tools/edit.js';
export { createGlobTool } from './tools/glob.js';
export { createGrepTool } from './tools/grep.js';
