import { afterEach, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { createGateway } from "../../src/gateway.js";
import { resolveTarget } from "../../src/targets.js";
import { discoverModels } from "../../src/preferences.js";

const servers: http.Server[] = [];
let scratch: string | undefined;
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
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
  const finishSignal = new Promise<void>(resolve => { finish = resolve; });
  let received: Buffer | undefined;
  let auth: string | undefined;
  const upstream = await listen(http.createServer(async (req, res) => {
    auth = req.headers.authorization;
    expect(req.url).toBe("/prefix/v1/responses?trace=1");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received = Buffer.concat(chunks);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"type":"response.output_text.delta","delta":"first"}\n\n');
    await finishSignal;
    res.end('data: {"type":"response.output_text.delta","delta":"second"}\n\n');
  }));
  let captured!: (file: string) => void;
  const done = new Promise<string>(resolve => { captured = resolve; });
  const errors: Error[] = [];
  const gateway = await listen(createGateway({ target: resolveTarget({ agent: "codex", provider: "custom", customBaseUrl: upstream + "/prefix", customRenderer: "openai" }, 8787), directory: scratch, onCapture: captured, onError: error => errors.push(error) }));
  const payload = gzipSync(JSON.stringify({ model: "test", input: "sensitive body" }));
  const response = await fetch(gateway + "/v1/responses?trace=1", { method: "POST", headers: { authorization: "Bearer secret", "content-encoding": "gzip" }, body: payload });
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(Buffer.from(first.value!).toString()).toContain("first");
  finish();
  while (!(await reader.read()).done) { /* consume the remaining stream */ }
  const file = await done;
  expect(auth).toBe("Bearer secret"); expect(received).toEqual(payload);
  const markdown = await fs.readFile(file, "utf8");
  expect(markdown).toContain("firstsecond"); expect(markdown).toContain("sensitive body");
  expect(markdown).not.toContain("Bearer secret"); expect(markdown).toContain("[REDACTED]");
  expect(await fs.readFile(file.replace(/\.md$/, ".request.txt"))).toEqual(payload);
  expect(await fs.readdir(scratch)).toHaveLength(3);
  expect(errors).toEqual([]);
});
it("returns an HTTP error when the upstream is unavailable", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-unavailable-"));
  const origin = await listen(http.createServer());
  const stopped = servers.pop()!;
  await new Promise<void>(resolve => stopped.close(() => resolve()));
  const gateway = await listen(createGateway({ target: resolveTarget({ agent: "codex", provider: "openai" }, 8787), directory: scratch, override: new URL(origin), onError() {} }));
  const response = await fetch(gateway + "/v1/responses", { method: "POST", body: "{}" });
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("Unable to reach upstream");
});
it("rejects WebSocket negotiation promptly", async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-upgrade-"));
  const address = await listen(createGateway({ target: resolveTarget({ agent: "codex", provider: "openai" }, 8787), directory: scratch }));
  const socket = net.connect(Number(new URL(address).port), "127.0.0.1");
  socket.setTimeout(1000, () => socket.destroy(new Error("Upgrade timed out")));
  socket.write("GET /v1/responses HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  let result = "";
  socket.on("data", chunk => { result += chunk; });
  await once(socket, "close");
  expect(result).toContain("426");
});
it("discovers model IDs without credentials, deduplicates them, and respects /v1", async () => {
  const paths: string[] = [];
  const origin = await listen(http.createServer((req, res) => {
    paths.push(req.url!);
    expect(req.headers.authorization).toBeUndefined();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "one" }, { id: "one" }, { id: "two" }, {}] }));
  }));
  expect(await discoverModels(origin)).toEqual(["one", "two"]);
  expect(await discoverModels(origin + "/prefix/v1")).toEqual(["one", "two"]);
  expect(paths).toEqual(["/v1/models", "/prefix/v1/models"]);
});
