/**
 * Security utilities for the execution framework.
 *
 * Provides allowlist evaluation for command security and path safety
 * checks for file operations.
 */

import { resolve } from 'node:path';

/**
 * Match a text string against a simple glob pattern.
 * Supports `*` as a wildcard that matches any sequence of characters.
 *
 * @param text - The text to match
 * @param pattern - Glob pattern with `*` wildcards
 * @returns Whether the text matches the pattern
 */
export function matchGlob(text: string, pattern: string): boolean {
  // Escape regex special chars except *, then convert * to .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = `^${escaped.replace(/\*/g, '.*')}$`;
  return new RegExp(regexStr).test(text);
}

/**
 * Evaluate a command against an allowlist of glob patterns.
 *
 * Matches the full command string against each pattern.
 * Patterns support `*` wildcards (e.g., `node *`, `npm *`, `*`).
 *
 * @param command - The shell command to check
 * @param patterns - Array of glob patterns to match against
 * @returns Whether the command matches any pattern in the allowlist
 */
export function evaluateAllowlist(command: string, patterns: string[]): boolean {
  const trimmed = command.trim();
  return patterns.some((pattern) => matchGlob(trimmed, pattern));
}

/**
 * Check whether a resolved path stays within a restriction directory.
 *
 * @param resolvedPath - The fully resolved path to check
 * @param restriction - The base directory the path must stay within
 * @returns Whether the path is within the restriction
 */
export function isWithinRestriction(resolvedPath: string, restriction: string): boolean {
  const base = resolve(restriction);
  return resolvedPath === base || resolvedPath.startsWith(base + '/');
}

/**
 * Assert that a file path stays within a restriction directory.
 * Throws if path traversal is detected.
 *
 * @param filePath - The file path to check
 * @param restriction - The base directory paths must stay within
 * @throws Error if the resolved path escapes the restriction directory
 */
export function assertSafePath(filePath: string, restriction: string): void {
  const base = resolve(restriction);
  const resolved = resolve(base, filePath);

  if (!isWithinRestriction(resolved, base)) {
    throw new Error(`Path traversal detected: "${filePath}" resolves outside of "${restriction}"`);
  }
}
