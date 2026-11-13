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
  override?: URL;
  onCapture?: (file: string) => void;
  onError?: (error: Error) => void;
}

interface ForwardingContext {
  target: Target;
  upstream: URL;
  record: (exchange: Exchange) => void;
  report: (error: Error) => void;
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

    void saveExchange(options.directory, exchange)
      .then((file) => options.onCapture?.(file))
      .catch((error) =>
        report(
          new LoggerError(
            "CAPTURE_FAILED",
            "Could not write capture files.",
            error,
            exchange.requestId,
          ),
        ),
      );
  };
}

/** The caller must start and close the server. */
export function createGateway(options: GatewayOptions): http.Server {
  const report =
    options.onError ??
    ((error) => {
      console.error(formatError(error, process.env.REQUEST_LOGGER_DEBUG === "1"));
    });
  const context: ForwardingContext = {
    target: options.target,
    upstream: options.override ?? options.target.upstream,
    record: createRecorder(options, report),
    report,
  };
  const server = http.createServer((incoming, outgoing) =>
    forwardRequest(incoming, outgoing, context),
  );
  server.on("upgrade", (_request, socket) => {
    // A prompt rejection allows clients with an HTTP fallback to use it.
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return server;
}

function forwardRequest(
  incoming: http.IncomingMessage,
  outgoing: http.ServerResponse,
  context: ForwardingContext,
): void {
  const started = performance.now();
  const requestId = randomUUID();
  const method = incoming.method ?? "GET";
  const url = requestPath(context.target.upstream, incoming.url ?? "/");
  const headers = transportHeaders(incoming.headers);
  // Ask for plain SSE, but never change the request body's content encoding.
  headers["accept-encoding"] = "identity";

  const requestChunks: Buffer[] = [];
  const send = context.upstream.protocol === "https:" ? https.request : http.request;
  let failed = false;
  let responseComplete = false;
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
    const responseChunks: Buffer[] = [];
    outgoing.writeHead(response.statusCode ?? 502, transportHeaders(response.headers));
    response.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
    response.on("error", fail);
    response.on("end", () => {
      responseComplete = true;
      context.record({
        requestId,
        agent: context.target.name,
        protocol: context.target.protocol,
        method,
        url,
        status: response.statusCode ?? 502,
        headers: incoming.headers,
        request: Buffer.concat(requestChunks),
        response: Buffer.concat(responseChunks),
        responseEncoding: String(response.headers["content-encoding"] ?? ""),
        elapsedMs: Math.round(performance.now() - started),
      });
    });
    // Pipe streams immediately. Buffered copies are used only after completion
    // to write captures, so capture formatting cannot delay individual tokens.
    response.pipe(outgoing);
  }

  function fail(error: Error): void {
    // Request and response streams can report the same failure during teardown.
    if (failed) return;
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
  incoming.on("data", (chunk) => requestChunks.push(Buffer.from(chunk)));
  incoming.on("error", (error) => upstream.destroy(error));
  outgoing.on("close", () => {
    if (!responseComplete) upstream.destroy();
  });
  incoming.pipe(upstream);
}
