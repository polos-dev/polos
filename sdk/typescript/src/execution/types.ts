/**
 * Shared types for the execution framework.
 *
 * Defines interfaces for execution environments, command results,
 * file operations, and configuration.
 */

// ── Execution environment interface ──────────────────────────────────

/**
 * Abstract interface for an execution environment (Docker, E2B, Local).
 * All sandbox tools operate against this interface.
 */
export interface ExecutionEnvironment {
  /** Environment type discriminator */
  readonly type: 'local' | 'docker' | 'e2b';

  /** Execute a shell command in the environment */
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;

  /** Read a file's contents as UTF-8 text */
  readFile(path: string): Promise<string>;

  /** Write content to a file, creating parent directories as needed */
  writeFile(path: string, content: string): Promise<void>;

  /** Check whether a file exists */
  fileExists(path: string): Promise<boolean>;

  /** Find files matching a glob pattern */
  glob(pattern: string, opts?: GlobOptions): Promise<string[]>;

  /** Search file contents for a pattern */
  grep(pattern: string, opts?: GrepOptions): Promise<GrepMatch[]>;

  /** Initialize the environment (create container, connect to sandbox, etc.) */
  initialize(): Promise<void>;

  /** Tear down the environment (remove container, kill sandbox, etc.) */
  destroy(): Promise<void>;

  /** Get the current working directory inside the environment */
  getCwd(): string;

  /** Get environment metadata */
  getInfo(): EnvironmentInfo;
}

// ── Input/output types ───────────────────────────────────────────────

/**
 * Options for command execution.
 */
export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string | undefined;
  /** Environment variables to set */
  env?: Record<string, string> | undefined;
  /** Timeout in seconds (default: 300) */
  timeout?: number | undefined;
  /** Data to pipe to stdin */
  stdin?: string | undefined;
}

/**
 * Result of a command execution.
 */
export interface ExecResult {
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether output was truncated due to size limits */
  truncated: boolean;
}

/**
 * Options for glob file search.
 */
export interface GlobOptions {
  /** Working directory for the search */
  cwd?: string | undefined;
  /** Glob patterns to exclude */
  ignore?: string[] | undefined;
}

/**
 * Options for grep content search.
 */
export interface GrepOptions {
  /** Working directory for the search */
  cwd?: string | undefined;
  /** File glob patterns to include (e.g., "*.ts") */
  include?: string[] | undefined;
  /** Maximum number of matches to return */
  maxResults?: number | undefined;
  /** Number of context lines around each match */
  contextLines?: number | undefined;
}

/**
 * A single grep match result.
 */
export interface GrepMatch {
  /** File path (relative to search root) */
  path: string;
  /** Line number of the match */
  line: number;
  /** The matching line text */
  text: string;
  /** Context lines around the match */
  context?: string | undefined;
}

/**
 * Metadata about an execution environment.
 */
export interface EnvironmentInfo {
  /** Environment type */
  type: 'local' | 'docker' | 'e2b';
  /** Current working directory */
  cwd: string;
  /** Sandbox/container identifier (container ID for Docker, sandbox ID for E2B) */
  sandboxId?: string | undefined;
  /** Operating system info */
  os?: string | undefined;
}

// ── Configuration types ──────────────────────────────────────────────

/**
 * Configuration for a Docker execution environment.
 */
export interface DockerEnvironmentConfig {
  /** Docker image to use (e.g., "node:20-slim") */
  image: string;
  /** Host directory to mount as workspace */
  workspaceDir: string;
  /** Working directory inside the container (default: "/workspace") */
  containerWorkdir?: string | undefined;
  /** Environment variables to set in the container */
  env?: Record<string, string> | undefined;
  /** Memory limit (e.g., "512m", "2g") */
  memory?: string | undefined;
  /** CPU limit (e.g., "1", "0.5") */
  cpus?: string | undefined;
  /** Network mode (default: "none") */
  network?: string | undefined;
  /** Command to run after container creation (e.g., "npm install") */
  setupCommand?: string | undefined;
}

/**
 * Configuration for an E2B execution environment.
 */
export interface E2BEnvironmentConfig {
  /** E2B template name (default: "base") */
  template?: string | undefined;
  /** E2B API key (defaults to E2B_API_KEY env var) */
  apiKey?: string | undefined;
  /** Sandbox timeout in seconds (default: 3600) */
  timeout?: number | undefined;
  /** Working directory inside the sandbox */
  cwd?: string | undefined;
  /** Environment variables */
  env?: Record<string, string> | undefined;
  /** Setup command to run after sandbox creation */
  setupCommand?: string | undefined;
}

/**
 * Configuration for a local execution environment.
 */
export interface LocalEnvironmentConfig {
  /** Working directory (default: process.cwd()) */
  cwd?: string | undefined;
  /** Restrict file operations to this directory */
  pathRestriction?: string | undefined;
}

/**
 * Configuration for the exec tool's security and behavior.
 */
export interface ExecToolConfig {
  /** Security mode: allow-always (default), allowlist, or always require approval */
  security?: 'allow-always' | 'allowlist' | 'approval-always' | undefined;
  /** Allowed command patterns (for allowlist mode) */
  allowlist?: string[] | undefined;
  /** Default command timeout in seconds (default: 300) */
  timeout?: number | undefined;
  /** Maximum output characters before truncation (default: 100000) */
  maxOutputChars?: number | undefined;
}

/**
 * Configuration for the sandboxTools() factory.
 */
export interface SandboxToolsConfig {
  /** Environment type (default: "docker") */
  env?: 'local' | 'docker' | 'e2b' | undefined;
  /** Working directory override */
  cwd?: string | undefined;
  /** Subset of tools to include (default: all) */
  tools?: ('exec' | 'read' | 'write' | 'edit' | 'glob' | 'grep')[] | undefined;
  /** Docker environment configuration */
  docker?: DockerEnvironmentConfig | undefined;
  /** E2B environment configuration */
  e2b?: E2BEnvironmentConfig | undefined;
  /** Local environment configuration */
  local?: LocalEnvironmentConfig | undefined;
  /** Exec tool configuration */
  exec?: ExecToolConfig | undefined;
}
