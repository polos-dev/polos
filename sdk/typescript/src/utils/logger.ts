/**
 * Simple structured logging utility.
 */

import { appendFileSync } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type LogContext = Record<string, unknown>;

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext | undefined;
}

export interface LoggerOptions {
  /** Minimum log level to output (default: 'info') */
  level?: LogLevel | undefined;
  /** Logger name/prefix */
  name?: string | undefined;
  /** Custom log handler */
  handler?: ((entry: LogEntry) => void) | undefined;
}

export interface ConfigureLoggingOptions {
  /** Custom log handler for all SDK loggers */
  handler?: ((entry: LogEntry) => void) | undefined;
  /** Path to a log file. SDK logs will be appended to this file instead of stdout. */
  file?: string | undefined;
}

/**
 * Console log handler.
 */
function consoleHandler(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] ${entry.level.toUpperCase()}`;
  const message = entry.context
    ? `${prefix}: ${entry.message} ${JSON.stringify(entry.context)}`
    : `${prefix}: ${entry.message}`;

  switch (entry.level) {
    case 'debug':
      console.debug(message);
      break;
    case 'info':
      console.info(message);
      break;
    case 'warn':
      console.warn(message);
      break;
    case 'error':
      console.error(message);
      break;
  }
}

/**
 * The active global handler. All SDK loggers created with the default handler
 * delegate to this, so calling `configureLogging()` retroactively redirects them.
 */
let _activeHandler: (entry: LogEntry) => void = consoleHandler;

/**
 * Default handler that delegates to the mutable `_activeHandler`.
 * This is the handler captured by module-level loggers at import time.
 */
function defaultHandler(entry: LogEntry): void {
  _activeHandler(entry);
}

/**
 * Configure logging for all SDK loggers globally.
 *
 * @example
 * ```typescript
 * // Redirect all SDK logs to a file
 * configureLogging({ file: 'polos.log' });
 *
 * // Use a custom handler
 * configureLogging({ handler: (entry) => myLogger.log(entry) });
 * ```
 */
export function configureLogging(options: ConfigureLoggingOptions): void {
  if (options.handler) {
    _activeHandler = options.handler;
  } else if (options.file) {
    const filePath = options.file;
    _activeHandler = (entry: LogEntry) => {
      const prefix = `[${entry.timestamp}] ${entry.level.toUpperCase()}`;
      const line = entry.context
        ? `${prefix}: ${entry.message} ${JSON.stringify(entry.context)}\n`
        : `${prefix}: ${entry.message}\n`;
      appendFileSync(filePath, line);
    };
  }
}

/**
 * Create a logger instance.
 *
 * @example
 * ```typescript
 * const logger = createLogger({ name: 'workflow', level: 'debug' });
 * logger.info('Workflow started', { workflowId: '123' });
 * logger.error('Workflow failed', { error: err.message });
 * ```
 */
export function createLogger(options: LoggerOptions = {}) {
  const { level = 'info', name, handler = defaultHandler } = options;
  const minLevel = LOG_LEVELS[level];

  function log(logLevel: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVELS[logLevel] < minLevel) {
      return;
    }

    const entry: LogEntry = {
      level: logLevel,
      message: name ? `[${name}] ${message}` : message,
      timestamp: new Date().toISOString(),
      context,
    };

    handler(entry);
  }

  return {
    debug: (message: string, context?: LogContext) => {
      log('debug', message, context);
    },
    info: (message: string, context?: LogContext) => {
      log('info', message, context);
    },
    warn: (message: string, context?: LogContext) => {
      log('warn', message, context);
    },
    error: (message: string, context?: LogContext) => {
      log('error', message, context);
    },

    /** Create a child logger with additional context */
    child: (childOptions: LoggerOptions) => {
      let childName: string | undefined;
      if (name && childOptions.name) {
        childName = `${name}:${childOptions.name}`;
      } else {
        childName = childOptions.name ?? name;
      }
      return createLogger({
        level,
        handler,
        ...childOptions,
        name: childName,
      });
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * Global SDK logger instance.
 * Log level can be configured via POLOS_LOG_LEVEL environment variable.
 */
const envLogLevel = process.env['POLOS_LOG_LEVEL'];
export const logger = createLogger({
  name: 'polos',
  level: (envLogLevel as LogLevel | undefined) ?? 'info',
});
