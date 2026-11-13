import { randomUUID } from "node:crypto";
import { LoggerError, formatError } from "./errors.js";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { saveExchange } from "./capture.js";
import type { Target } from "./targets.js";

const hopHeaders = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
export function transportHeaders(input: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result = { ...input };
  const named = String(input.connection ?? "").split(",").map(name => name.trim().toLowerCase());
  for (const name of [...hopHeaders, ...named]) delete result[name];
  delete result.host;
  return result;
}
export function requestPath(base: URL, incoming: string): string {
  // Concatenate paths instead of resolving a URL: incoming //host must never
  // change the configured upstream, and incoming query parameters stay intact.
  return base.pathname.replace(/\/+$/, "") + (incoming.startsWith("/") ? incoming : "/" + incoming);
}
export function captureRequest(method: string, url: string, raw = false): boolean {
  if (method !== "POST") return false;
  const path = url.split("?")[0];
  if (raw) return !/count[_-]?tokens/i.test(path);
  return /\/(messages|responses|chat\/completions)$/.test(path);
}
export interface GatewayOptions {
  target: Target;
  directory: string;
  override?: URL;
  onCapture?: (file: string) => void;
  onError?: (error: Error) => void;
}
export function createGateway(options: GatewayOptions): http.Server {
  // A short sliding window limits captures of fast retry loops without changing
  // upstream responses or blocking normal client traffic.
  const recent = new Map<string, number[]>();
  const report = options.onError ?? (error => console.error(formatError(error, process.env.REQUEST_LOGGER_DEBUG === "1")));
  const server = http.createServer((incoming, outgoing) => {
    const started = performance.now();
    const requestId = randomUUID();
    let failed = false;
    const base = options.override ?? options.target.upstream;
    const url = requestPath(options.target.upstream, incoming.url ?? "/");
    const headers = transportHeaders(incoming.headers);
    // Let upstreams send uncompressed SSE while retaining the original request
    // body's encoding. Responses that ignore this still pass through as bytes.
    headers["accept-encoding"] = "identity";
    const send = base.protocol === "https:" ? https.request : http.request;
    const sent: Buffer[] = [];
    const received: Buffer[] = [];
    let responseComplete = false;
    const upstream = send({ protocol: base.protocol, hostname: base.hostname.replace(/^\[|\]$/g, ""), port: base.port || undefined,
      method: incoming.method, path: url, headers,
    }, response => {
      outgoing.writeHead(response.statusCode ?? 502, transportHeaders(response.headers));
      response.on("data", chunk => received.push(Buffer.from(chunk)));
      response.on("error", fail);
      response.on("end", () => {
        responseComplete = true;
        const method = incoming.method ?? "GET";
        if (!captureRequest(method, url, options.target.protocol === "raw")) return;
        const now = Date.now();
        const signature = `${method} ${url} ${response.statusCode}`;
        const times = (recent.get(signature) ?? []).filter(time => now - time < 2000);
        times.push(now);
        recent.set(signature, times.slice(-21));
        for (const [key, history] of recent) if (now - history[history.length - 1] > 2000) recent.delete(key);
        if (times.length > 20) return;
        void saveExchange(options.directory, {
          requestId, agent: options.target.name, protocol: options.target.protocol, method, url,
          status: response.statusCode ?? 502, headers: incoming.headers,
          request: Buffer.concat(sent), response: Buffer.concat(received), responseEncoding: String(response.headers["content-encoding"] ?? ""), elapsedMs: Math.round(performance.now() - started),
        }).then(file => options.onCapture?.(file)).catch(error => report(new LoggerError("CAPTURE_FAILED", "Could not write capture files.", error, requestId)));
      });
      response.pipe(outgoing);
    });
    function fail(error: Error): void {
      if (failed) return;
      failed = true;
      report(new LoggerError("UPSTREAM_FAILED", `${incoming.method} ${url.split("?")[0]} via ${base.origin}`, error, requestId));
      if (!outgoing.headersSent) {
        outgoing.writeHead(502, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "Unable to reach upstream", requestId }));
      } else outgoing.destroy(error);
      upstream.destroy();
    }
    upstream.on("error", fail);
    incoming.on("data", chunk => sent.push(Buffer.from(chunk)));
    incoming.on("error", error => upstream.destroy(error));
    outgoing.on("close", () => { if (!responseComplete) upstream.destroy(); });
    incoming.pipe(upstream);
  });
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return server;
}
