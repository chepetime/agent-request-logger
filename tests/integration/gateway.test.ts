import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { createGateway } from "../../src/gateway.js";
import { discoverModels } from "../../src/model-discovery.js";
import { resolveTarget } from "../../src/targets.js";

const servers: http.Server[] = [];
let scratch: string | undefined;
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});
async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}
it("forwards gzip bytes and credentials, streams before completion, then writes all three files", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-gateway-"));
  let finish!: () => void;
  const finishSignal = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let received: Buffer | undefined;
  let auth: string | undefined;
  const upstream = await listen(
    http.createServer(async (req, res) => {
      auth = req.headers.authorization;
      expect(req.url).toBe("/prefix/v1/responses?trace=1");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = Buffer.concat(chunks);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"response.output_text.delta","delta":"first"}\n\n');
      await finishSignal;
      res.end('data: {"type":"response.output_text.delta","delta":"second"}\n\n');
    }),
  );
  let captured!: (file: string) => void;
  const done = new Promise<string>((resolve) => {
    captured = resolve;
  });
  const errors: Error[] = [];
  const gateway = await listen(
    createGateway({
      target: resolveTarget(
        {
          agent: "codex",
          provider: "custom",
          customBaseUrl: `${upstream}/prefix`,
          customRenderer: "openai",
        },
        8787,
      ),
      directory: scratch,
      onCapture: captured,
      onError: (error) => errors.push(error),
    }).server,
  );
  const payload = gzipSync(JSON.stringify({ model: "test", input: "sensitive body" }));
  const response = await fetch(`${gateway}/v1/responses?trace=1`, {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-encoding": "gzip" },
    body: payload,
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(Buffer.from(first.value!).toString()).toContain("first");
  finish();
  while (!(await reader.read()).done) {
    /* Drain the response so the gateway can finish writing the capture. */
  }
  const file = await done;
  expect(auth).toBe("Bearer secret");
  expect(received).toEqual(payload);
  const markdown = await fs.readFile(file, "utf8");
  expect(markdown).toContain("firstsecond");
  expect(markdown).toContain("sensitive body");
  expect(markdown).not.toContain("Bearer secret");
  expect(markdown).toContain("[REDACTED]");
  expect(await fs.readFile(file.replace(/\.md$/, ".request.txt"))).toEqual(payload);
  expect(await fs.readdir(scratch)).toHaveLength(3);
  expect(errors).toEqual([]);
});
it("returns an HTTP error when the upstream is unavailable", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-unavailable-"));
  const origin = await listen(http.createServer());
  const stopped = servers.pop()!;
  await new Promise<void>((resolve) => stopped.close(() => resolve()));
  const gateway = await listen(
    createGateway({
      target: resolveTarget({ agent: "codex", provider: "openai" }, 8787),
      directory: scratch,
      override: new URL(origin),
      onError() {},
    }).server,
  );
  const response = await fetch(`${gateway}/v1/responses`, { method: "POST", body: "{}" });
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("Unable to reach upstream");
});
it("captures a streamed response when the client closes after receiving it", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-disconnect-"));
  const origin = await listen(
    http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"response.output_text.delta","delta":"hello"}\n\n');
    }),
  );
  let captured!: (file: string) => void;
  const done = new Promise<string>((resolve) => {
    captured = resolve;
  });
  const errors: Error[] = [];
  const gateway = await listen(
    createGateway({
      target: resolveTarget({ agent: "codex", provider: "chatgpt" }, 8787),
      directory: scratch,
      override: new URL(origin),
      onCapture: captured,
      onError: (error) => errors.push(error),
    }).server,
  );
  const controller = new AbortController();
  const response = await fetch(`${gateway}/backend-api/codex/responses`, {
    method: "POST",
    body: "{}",
    signal: controller.signal,
  });
  await response.body!.getReader().read();
  controller.abort();
  const file = await done;
  expect(await fs.readFile(file, "utf8")).toContain("hello");
  expect(errors).toEqual([]);
});
it("rejects WebSocket negotiation promptly", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-upgrade-"));
  const address = await listen(
    createGateway({
      target: resolveTarget({ agent: "codex", provider: "openai" }, 8787),
      directory: scratch,
    }).server,
  );
  const socket = net.connect(Number(new URL(address).port), "127.0.0.1");
  socket.setTimeout(1000, () => socket.destroy(new Error("Upgrade timed out")));
  socket.write(
    "GET /v1/responses HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  let result = "";
  socket.on("data", (chunk) => {
    result += chunk;
  });
  await once(socket, "close");
  expect(result).toContain("426");
});
it("discovers model IDs without credentials, deduplicates them, and respects /v1", async () => {
  const paths: string[] = [];
  const origin = await listen(
    http.createServer((req, res) => {
      paths.push(req.url!);
      expect(req.headers.authorization).toBeUndefined();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "one" }, { id: "one" }, { id: "two" }, {}] }));
    }),
  );
  expect(await discoverModels(origin)).toEqual(["one", "two"]);
  expect(await discoverModels(`${origin}/prefix/v1`)).toEqual(["one", "two"]);
  expect(paths).toEqual(["/v1/models", "/prefix/v1/models"]);
});

it("forwards a body larger than the capture limit intact but saves only its beginning", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-limit-"));
  let received = 0;
  const origin = await listen(
    http.createServer(async (req, res) => {
      for await (const chunk of req) received += chunk.length;
      res.end("x".repeat(5000));
    }),
  );
  let captured!: (file: string) => void;
  const done = new Promise<string>((resolve) => {
    captured = resolve;
  });
  const gateway = await listen(
    createGateway({
      target: resolveTarget({ agent: "codex", provider: "openai" }, 8787),
      directory: scratch,
      override: new URL(origin),
      maxCaptureBytes: 1000,
      onCapture: captured,
    }).server,
  );
  const response = await fetch(`${gateway}/v1/responses`, {
    method: "POST",
    body: "y".repeat(4000),
  });
  expect((await response.text()).length).toBe(5000);
  expect(received).toBe(4000);
  const file = await done;
  expect((await fs.stat(file.replace(/\.md$/, ".request.txt"))).size).toBe(1000);
  expect((await fs.stat(file.replace(/\.md$/, ".response.txt"))).size).toBe(1000);
  expect(await fs.readFile(file, "utf8")).toContain("exceeded the capture limit");
});

it("records an open stream as incomplete when the gateway closes", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-close-"));
  const origin = await listen(
    http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
    }),
  );
  const files: string[] = [];
  const gateway = createGateway({
    target: resolveTarget({ agent: "codex", provider: "openai" }, 8787),
    directory: scratch,
    override: new URL(origin),
    onCapture: (file) => files.push(file),
    onError() {},
  });
  const address = await listen(gateway.server);
  servers.pop();
  const response = await fetch(`${address}/v1/responses`, { method: "POST", body: "{}" });
  await response.body!.getReader().read();
  await gateway.close();
  expect(files).toHaveLength(1);
  const capture = await fs.readFile(files[0]!, "utf8");
  expect(capture).toContain("partial");
  expect(capture).toContain("capture may be incomplete");
});
