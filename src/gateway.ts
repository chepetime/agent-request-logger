import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { type Exchange, saveExchange } from "./capture.js";
import { formatError, LoggerError } from "./errors.js";
import type { Target } from "./targets.js";

export interface GatewayOptions {
  target: Target;
  directory: string;
  /** Send traffic to this origin instead of the target's provider (tests only). */
  override?: URL;
  /** Bytes kept per request or response body for captures. Traffic is never cut. */
  maxCaptureBytes?: number;
  /** Called after a capture's files are written, with the exchange they describe. */
  onCapture?: (file: string, exchange: Exchange) => void;
  onError?: (error: Error) => void;
}

/** A forwarding proxy whose capture writes can be awaited before exit. */
export interface Gateway {
  server: http.Server;
  /** Resolve after every capture scheduled so far is written or has failed. */
  flush(): Promise<void>;
  /** Stop accepting traffic, end open streams, and wait for their captures. */
  close(): Promise<void>;
}

export const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

interface ForwardingContext {
  target: Target;
  upstream: URL;
  maxCaptureBytes: number;
  /** Exchanges whose client response has not closed yet. */
  open: Set<Promise<void>>;
  record: (exchange: Exchange) => void;
  report: (error: Error) => void;
}

/** Keeps a bounded copy of a body so long streams cannot exhaust memory. */
class BodyCopy {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  constructor(private readonly limit: number) {}
  add(chunk: Buffer | string): void {
    if (this.truncated) return;
    const bytes = Buffer.from(chunk);
    const room = this.limit - this.size;
    if (bytes.length > room) {
      this.chunks.push(bytes.subarray(0, room));
      this.size = this.limit;
      this.truncated = true;
      return;
    }
    this.chunks.push(bytes);
    this.size += bytes.length;
  }
  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function transportHeaders(input: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result = { ...input };
  // Connection may name additional headers that are valid only on this hop.
  const named = String(input.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase());
  for (const name of [...HOP_HEADERS, ...named]) delete result[name];
  delete result.host;
  return result;
}

export function requestPath(base: URL, incoming: string): string {
  // URL resolution would interpret //host as a new origin. Joining only paths
  // preserves the configured host, custom prefixes, and incoming query string.
  return base.pathname.replace(/\/+$/, "") + (incoming.startsWith("/") ? incoming : `/${incoming}`);
}

function isModelRequest(exchange: Exchange): boolean {
  if (exchange.method !== "POST") return false;
  const pathname = exchange.url.split("?")[0];
  if (exchange.protocol === "raw") return !/count[_-]?tokens/i.test(pathname);
  return /\/(messages|responses|chat\/completions)$/.test(pathname);
}

function createRecorder(
  options: GatewayOptions,
  report: ForwardingContext["report"],
  pending: Set<Promise<void>>,
): ForwardingContext["record"] {
  const recent = new Map<string, number[]>();
  const windowMs = 2000;
  const captureLimit = 20;

  return (exchange) => {
    if (!isModelRequest(exchange)) return;
    const now = Date.now();
    const signature = `${exchange.method} ${exchange.url} ${exchange.status}`;
    const times = (recent.get(signature) ?? []).filter((time) => now - time < windowMs);
    times.push(now);
    recent.set(signature, times.slice(-(captureLimit + 1)));
    for (const [key, history] of recent) {
      if (now - history[history.length - 1] > windowMs) recent.delete(key);
    }
    // Only capture writes are limited. Every upstream response still reaches
    // the agent, including a failing response the agent is retrying rapidly.
    if (times.length > captureLimit) return;

    const write: Promise<void> = saveExchange(options.directory, exchange)
      .then((file) => options.onCapture?.(file, exchange))
      .catch((error) =>
        report(
          new LoggerError(
            "CAPTURE_FAILED",
            "Could not write capture files.",
            error,
            exchange.requestId,
          ),
        ),
      )
      .finally(() => pending.delete(write));
    pending.add(write);
  };
}

/** The caller starts the server with `server.listen` and stops it with `close`. */
export function createGateway(options: GatewayOptions): Gateway {
  const report = options.onError ?? ((error) => console.error(formatError(error)));
  const pending = new Set<Promise<void>>();
  const context: ForwardingContext = {
    target: options.target,
    upstream: options.override ?? options.target.upstream,
    maxCaptureBytes: options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES,
    open: new Set(),
    record: createRecorder(options, report, pending),
    report,
  };
  const server = http.createServer((incoming, outgoing) =>
    forwardRequest(incoming, outgoing, context),
  );
  server.on("upgrade", (_request, socket) => {
    // A prompt rejection allows clients with an HTTP fallback to use it.
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });

  const flush = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  const close = async () => {
    const closed = server.listening
      ? new Promise<void>((resolve) => server.close(() => resolve()))
      : Promise.resolve();
    // Ending open streams makes each exchange record its partial response.
    server.closeAllConnections();
    await Promise.all([...context.open]);
    await closed;
    await flush();
  };
  return { server, flush, close };
}

function forwardRequest(
  incoming: http.IncomingMessage,
  outgoing: http.ServerResponse,
  context: ForwardingContext,
): void {
  const started = performance.now();
  const startedAt = new Date();
  const requestId = randomUUID();
  const method = incoming.method ?? "GET";
  const url = requestPath(context.target.upstream, incoming.url ?? "/");
  const headers = transportHeaders(incoming.headers);
  // Ask for plain SSE, but never change the request body's content encoding.
  headers["accept-encoding"] = "identity";

  const requestBody = new BodyCopy(context.maxCaptureBytes);
  const send = context.upstream.protocol === "https:" ? https.request : http.request;
  let failed = false;
  let responseComplete = false;
  let clientClosed = false;
  let savePartialResponse: (() => void) | undefined;
  const upstream = send(
    {
      protocol: context.upstream.protocol,
      hostname: context.upstream.hostname.replace(/^\[|\]$/g, ""),
      port: context.upstream.port || undefined,
      method: incoming.method,
      path: url,
      headers,
    },
    handleResponse,
  );

  function handleResponse(response: http.IncomingMessage): void {
    const responseBody = new BodyCopy(context.maxCaptureBytes);
    outgoing.writeHead(response.statusCode ?? 502, transportHeaders(response.headers));
    response.on("data", (chunk) => responseBody.add(chunk));
    response.on("error", fail);
    const recordResponse = () => {
      if (responseComplete) return;
      responseComplete = true;
      context.record({
        requestId,
        startedAt,
        agent: context.target.name,
        protocol: context.target.protocol,
        method,
        url,
        status: response.statusCode ?? 502,
        headers: incoming.headers,
        request: requestBody.bytes(),
        response: responseBody.bytes(),
        requestTruncated: requestBody.truncated,
        responseTruncated: responseBody.truncated,
        responseEncoding: String(response.headers["content-encoding"] ?? ""),
        elapsedMs: Math.round(performance.now() - started),
        responseIncomplete: clientClosed,
      });
    };
    savePartialResponse = recordResponse;
    response.on("end", recordResponse);
    // Pipe streams immediately. Buffered copies are used only after completion
    // to write captures, so capture formatting cannot delay individual tokens.
    response.pipe(outgoing);
  }

  function fail(error: Error): void {
    // Request and response streams can report the same failure during teardown.
    if (failed || clientClosed) return;
    failed = true;
    context.report(
      new LoggerError(
        "UPSTREAM_FAILED",
        `${incoming.method} ${url.split("?")[0]} via ${context.upstream.origin}`,
        error,
        requestId,
      ),
    );
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Unable to reach upstream", requestId }));
    } else {
      outgoing.destroy(error);
    }
    upstream.destroy();
  }

  upstream.on("error", fail);
  incoming.on("data", (chunk) => requestBody.add(chunk));
  incoming.on("error", (error) => upstream.destroy(error));
  outgoing.on("close", () => {
    if (!responseComplete) {
      clientClosed = true;
      savePartialResponse?.();
      upstream.destroy();
    }
  });
  // Registered after the handler above, so a partial capture is already
  // scheduled when this exchange counts as settled.
  const settled = new Promise<void>((resolve) => outgoing.once("close", resolve)).then(() => {
    context.open.delete(settled);
  });
  context.open.add(settled);
  incoming.pipe(upstream);
}
