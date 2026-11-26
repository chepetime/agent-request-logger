import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-request-logger-package-"));
let child;
let upstream;
try {
  const packed = JSON.parse(
    execFileSync("pnpm", ["pack", "--json", "--pack-destination", scratch], { encoding: "utf8" }),
  );
  assert(packed.files.some((f) => f.path === "dist/main.js"));
  assert(packed.files.some((f) => f.path === "docs/agents.md"));
  assert(packed.files.some((f) => f.path === "LICENSE"));
  assert(
    !packed.files.some((f) =>
      /(?:\.test\.|^(?:src|tests|scripts|logs|request-logger-logs)\/|agent-choice)/.test(f.path),
    ),
  );
  fs.writeFileSync(path.join(scratch, "package.json"), '{"private":true}');
  // Install with npm to prove consumers do not need the development package manager.
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", path.resolve(scratch, packed.filename)],
    { cwd: scratch, stdio: "pipe" },
  );
  const bin = path.join(scratch, "node_modules", ".bin", "agent-request-logger");
  assert(execFileSync(bin, ["--help"], { encoding: "utf8" }).includes("--log-dir"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(execFileSync(bin, ["--version"], { encoding: "utf8" }).trim(), pkg.version);
  assert.throws(() => execFileSync(bin, ["--port", "0"], { stdio: "pipe" }));
  const config = path.join(scratch, "preferences");
  fs.mkdirSync(config);
  fs.writeFileSync(
    path.join(config, ".agent-choice.json"),
    JSON.stringify({ agent: "codex", provider: "openai" }),
  );
  let body = "";
  let auth;
  upstream = http.createServer((req, res) => {
    auth = req.headers.authorization;
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({ id: "test", output: [], usage: { input_tokens: 1, output_tokens: 0 } }),
      );
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let output = "";
  child = spawn(bin, ["--port", String(port), "--config-dir", config], {
    cwd: scratch,
    env: {
      ...process.env,
      REQUEST_LOGGER_LOG_DIR: "",
      REQUEST_LOGGER_TEST_UPSTREAM: `http://127.0.0.1:${upstream.address().port}`,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => {
    output += c;
  });
  child.stderr.on("data", (c) => {
    output += c;
  });
  for (let i = 0; i < 100 && !output.includes("Ctrl+C"); i++) {
    if (child.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  assert(output.includes("Ctrl+C"), output);
  const payload = JSON.stringify({ model: "test", input: "package-smoke-prompt" });
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer smoke-secret" },
    body: payload,
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(body, payload);
  assert.equal(auth, "Bearer smoke-secret");
  const logs = path.join(scratch, "request-logger-logs");
  // The .md file is written last, so its presence means all three files exist.
  const listed = () => (fs.existsSync(logs) ? fs.readdirSync(logs) : []);
  // The review file exists from startup, so it must not end this wait.
  const isCapture = (f) => f.endsWith(".md") && !f.endsWith(".review.md");
  for (let i = 0; i < 50 && !listed().some(isCapture); i++) await delay(100);
  // Count only capture files; the review file and its hidden temporary copy
  // are rewritten after every capture and may be present at any moment.
  const files = listed().filter((f) =>
    /^[^.].*(?<!\.review)\.(?:md|request\.txt|response\.txt)$/.test(f),
  );
  assert.equal(files.length, 3, files.join(", "));
  assert(
    !listed().some((f) => !f.startsWith(".") && f.endsWith(".tmp")),
    "Temporary files must be hidden",
  );
  const review = listed().find((f) => f.endsWith(".review.md"));
  assert(review, "The session review file must exist");
  const capture = fs.readFileSync(path.join(logs, files.find(isCapture)), "utf8");
  assert(capture.includes("package-smoke-prompt"));
  assert(!capture.includes("smoke-secret"));
  assert(capture.includes("[REDACTED]"));
  // The review index updates after the capture; wait for its row.
  const reviewText = () => fs.readFileSync(path.join(logs, review), "utf8");
  for (let i = 0; i < 50 && !reviewText().includes("## Files"); i++) await delay(100);
  assert(
    reviewText().includes(
      path.join(
        logs,
        files.find((f) => f.endsWith(".md")),
      ),
    ),
  );
  console.log(
    "Packed CLI: clean install, executable, options, forwarding, redaction, launch-directory captures, review index passed.",
  );
} finally {
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await stopped;
  }
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
