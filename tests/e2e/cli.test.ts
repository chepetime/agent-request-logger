import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";

const execute = promisify(execFile);
const cli = path.resolve("bin/agent-request-logger.js");
let directory: string;
const children: ReturnType<typeof spawn>[] = [];
const servers: http.Server[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "logger-cli-e2e-"));
});
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill();
      await ended;
    }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await fs.rm(directory, { recursive: true, force: true });
});
async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}
async function preference(): Promise<string> {
  const config = path.join(directory, "preferences");
  await fs.mkdir(config);
  await fs.writeFile(
    path.join(config, ".agent-choice.json"),
    JSON.stringify({ agent: "codex", provider: "openai" }),
  );
  return config;
}
function launch(args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    env: {
      ...process.env,
      REQUEST_LOGGER_LOG_DIR: "",
      REQUEST_LOGGER_CONFIG_DIR: "",
      REQUEST_LOGGER_TEST_UPSTREAM: "",
      REQUEST_LOGGER_DEBUG: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (data) => {
    output += data;
  });
  child.stderr!.on("data", (data) => {
    output += data;
  });
  return { child, output: () => output };
}
async function ready(process: ReturnType<typeof launch>) {
  for (let i = 0; i < 100; i++) {
    if (process.output().includes("Ctrl+C")) return;
    if (process.child.exitCode !== null) throw new Error(process.output());
    await delay(25);
  }
  throw new Error(`CLI did not become ready: ${process.output()}`);
}
it("documents supported flags and rejects invalid ports", async () => {
  const help = await execute(process.execPath, [cli, "--help"]);
  expect(help.stdout).toContain("--debug");
  expect(help.stdout).toContain("--config-dir");
  const version = await execute(process.execPath, [cli, "--version"]);
  expect(version.stdout.trim()).toBe(JSON.parse(await fs.readFile("package.json", "utf8")).version);
  const invalid = launch(["--port", "0"]);
  const [exit] = await once(invalid.child, "exit");
  expect(exit).toBe(1);
  expect(invalid.output()).toContain("Port must");
});
it("reports startup failures with operation and system cause, with debug stacks on demand", async () => {
  const config = await preference();
  const port = await listen(http.createServer());
  const normal = launch(["--port", String(port), "--config-dir", config]);
  expect((await once(normal.child, "exit"))[0]).toBe(1);
  expect(normal.output()).toContain("[LISTEN_FAILED]");
  expect(normal.output()).toContain("[EADDRINUSE]");
  expect(normal.output()).toContain("--port");
  expect(normal.output()).not.toContain("at Server.");
  const debug = launch(["--port", String(port), "--config-dir", config, "--debug"]);
  expect((await once(debug.child, "exit"))[0]).toBe(1);
  expect(debug.output()).toContain("at ");
});
it("gives CLI path flags precedence over environment variables", async () => {
  const config = await preference();
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const running = launch(["--port", String(port), "--config-dir", config, "--log-dir", "chosen"], {
    PORT: "1",
    REQUEST_LOGGER_LOG_DIR: "ignored",
    REQUEST_LOGGER_CONFIG_DIR: "/unavailable",
  });
  await ready(running);
  expect(running.output()).toContain(path.join(directory, "chosen"));
  expect(running.output()).toContain(`127.0.0.1:${port}`);
});
it("stops cleanly on SIGINT after saving captures", async () => {
  const config = await preference();
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const upstream = await listen(
    http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"response.output_text.delta","delta":"unfinished"}\n\n');
    }),
  );
  const running = launch(["--port", String(port), "--config-dir", config], {
    REQUEST_LOGGER_TEST_UPSTREAM: `http://127.0.0.1:${upstream}`,
  });
  await ready(running);
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    body: "{}",
  });
  await response.body!.getReader().read();
  const exited = once(running.child, "exit");
  running.child.kill("SIGINT");
  expect((await exited)[0]).toBe(0);
  // realpath: macOS reports the temporary directory through the /private link.
  const logs = await fs.realpath(path.join(directory, "request-logger-logs"));
  const files = await fs.readdir(logs);
  const capture = files.find((file) => file.endsWith(".md") && !file.endsWith(".review.md"))!;
  expect(await fs.readFile(path.join(logs, capture), "utf8")).toContain("unfinished");
  // The review path is printed at startup and again at shutdown, and lists the capture.
  const review = path.join(logs, files.find((file) => file.endsWith(".review.md"))!);
  expect(running.output().split(`Review: ${review}`)).toHaveLength(3);
  const index = await fs.readFile(review, "utf8");
  expect(index).toContain(path.join(logs, capture));
  expect(index).toContain("incomplete");
});

it("writes no review file with --no-review", async () => {
  const config = await preference();
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const running = launch(["--port", String(port), "--config-dir", config, "--no-review"]);
  await ready(running);
  expect(running.output()).not.toContain("Review:");
  await expect(fs.readdir(path.join(directory, "request-logger-logs"))).rejects.toThrow();
});
