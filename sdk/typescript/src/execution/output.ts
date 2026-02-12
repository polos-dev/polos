/**
 * Output utilities for the execution framework.
 *
 * Provides functions for truncating large outputs, detecting binary content,
 * parsing grep output, and stripping ANSI escape codes.
 */

import type { GrepMatch } from './types.js';

/** Default maximum output characters */
const DEFAULT_MAX_CHARS = 100_000;

/** Head portion of truncated output (20% of max) */
const HEAD_RATIO = 0.2;

/**
 * Truncate output that exceeds the maximum character limit.
 *
 * Keeps the first 20K characters (head) and last 80K characters (tail)
 * of a 100K max, with a truncation message in between.
 */
export function truncateOutput(
  output: string,
  maxChars?: number
): { text: string; truncated: boolean } {
  const max = maxChars ?? DEFAULT_MAX_CHARS;
  if (output.length <= max) {
    return { text: output, truncated: false };
  }

  const headSize = Math.floor(max * HEAD_RATIO);
  const tailSize = max - headSize;
  const omitted = output.length - headSize - tailSize;

  const head = output.slice(0, headSize);
  const tail = output.slice(-tailSize);
  const text = `${head}\n\n--- truncated ${String(omitted)} characters ---\n\n${tail}`;

  return { text, truncated: true };
}

/**
 * Detect binary content by checking for null bytes in the first 8KB.
 */
export function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Parse `grep -rn` output into structured GrepMatch objects.
 *
 * Expected format: `filepath:linenum:matched text`
 */
export function parseGrepOutput(output: string): GrepMatch[] {
  if (!output.trim()) {
    return [];
  }

  const matches: GrepMatch[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line) continue;

    // Match format: path:line:text
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (match?.[1] && match[2] && match[3] !== undefined) {
      matches.push({ path: match[1], line: parseInt(match[2], 10), text: match[3] });
    }
  }

  return matches;
}

/**
 * Strip ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  // Matches all ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
