// Hackbrowser-internal logger.
//
// Replaces the previous `cyberstrike/util/log` import (Karar 2 — Dependency
// Inversion, INTEGRATION.md §5). Hackbrowser no longer depends on the
// cyberstrike workspace package; this module provides the same API surface
// hackbrowser code already uses (Log.create, log.debug/info/warn/error).
//
// Default behavior: write to process.stderr.
// Cyberstrike integration: call Log.setSink() to forward records into
// cyberstrike's own logging pipeline (see hackbrowser-launcher.ts).
//
// API surface — only what hackbrowser actually uses today:
//   Log.init({ level })       — set global threshold
//   Log.create({ service })   — produce a contextualized logger
//   Log.setSink(sink)         — redirect output to a custom transport
//   logger.debug/info/warn/error(message, extra?)
//
// Intentionally NOT carried over from cyberstrike util/log:
//   - .tag(), .clone(), .time()  — unused in hackbrowser, YAGNI
//   - file logging                — hackbrowser always streamed to stderr
//   - Global.Path.log dependency  — coupled to cyberstrike state

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface LogRecord {
  level: LogLevel
  service: string
  message: string
  extra?: Record<string, unknown>
  timestamp: number
}

export type LogSink = (record: LogRecord) => void

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}

export interface InitOptions {
  level?: LogLevel
}

export interface CreateOptions {
  service: string
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

let currentLevel: LogLevel = "INFO"

let sink: LogSink = defaultStderrSink

function defaultStderrSink(record: LogRecord): void {
  const ts = new Date(record.timestamp).toISOString()
  let line = `${ts} ${record.level} ${record.service} ${record.message}`
  if (record.extra && Object.keys(record.extra).length > 0) {
    try {
      line += " " + JSON.stringify(record.extra)
    } catch {
      // Circular refs or BigInt — fall back to a tag rather than throw.
      line += " [unserializable extra]"
    }
  }
  process.stderr.write(line + "\n")
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel]
}

function emit(level: LogLevel, service: string, message: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  sink({
    level,
    service,
    message,
    extra,
    timestamp: Date.now(),
  })
}

export namespace Log {
  /**
   * Set the minimum log level. Call once at startup.
   * Records below this level are dropped before reaching the sink.
   */
  export function init(options: InitOptions): void {
    if (options.level) currentLevel = options.level
  }

  /**
   * Replace the output transport. Default writes to stderr; cyberstrike
   * passes a function that forwards records into its own logger so
   * hackbrowser output appears in the same log stream as the rest of
   * the agent.
   *
   * Pass `null` (or omit and call resetSink) to restore the default.
   */
  export function setSink(custom: LogSink): void {
    sink = custom
  }

  /** Restore stderr default. Useful for tests. */
  export function resetSink(): void {
    sink = defaultStderrSink
  }

  /**
   * Produce a logger bound to a service name. Module-level singletons
   * (`const log = Log.create({ service: "hackbrowser:agent" })`) are the
   * intended pattern — same as cyberstrike util/log.
   */
  export function create(options: CreateOptions): Logger {
    const { service } = options
    return {
      debug(message, extra) { emit("DEBUG", service, message, extra) },
      info(message, extra)  { emit("INFO",  service, message, extra) },
      warn(message, extra)  { emit("WARN",  service, message, extra) },
      error(message, extra) { emit("ERROR", service, message, extra) },
    }
  }
}
