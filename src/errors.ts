export type ErrorCode = "UPSTREAM_FAILED" | "CAPTURE_FAILED" | "LISTEN_FAILED" | "PREFERENCES_FAILED" | "SETUP_FAILED";

/** Context at an operation boundary, retaining the original platform error. */
export class LoggerError extends Error {
  constructor(readonly code: ErrorCode, message: string, cause?: unknown, readonly requestId?: string) {
    super(message, { cause });
    this.name = "LoggerError";
  }
}
export function formatError(value: unknown, debug = false): string {
  const lines: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = value;
  while (current != null && !visited.has(current)) {
    visited.add(current);
    const prefix = lines.length ? "  caused by: " : "";
    if (!(current instanceof Error)) { lines.push(prefix + String(current)); break; }
    const code = "code" in current && typeof current.code === "string" ? `[${current.code}] ` : "";
    const request = current instanceof LoggerError && current.requestId ? `request=${current.requestId} ` : "";
    lines.push(prefix + request + code + current.message);
    if (debug && current.stack) lines.push(...current.stack.split("\n").slice(1).map(line => "  " + line.trim()));
    current = current.cause;
  }
  return lines.join("\n");
}
