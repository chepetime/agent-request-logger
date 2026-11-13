/** Run real CLIs with isolated homes and dummy API keys against a local provider. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { shellArgument } from "../../src/agent-setup.js";
import { createGateway } from "../../src/gateway.js";
import { type Choice, resolveTarget } from "../../src/targets.js";

const execute = promisify(execFile);
const root = path.resolve(".cache/agents");
const reply = "LOCAL-AGENT-LOGGER-TEST-REPLY";
const key = "sk-local-test-no-account-required";
const tools = {
  "claude-code": ["@anthropic-ai/claude-code", "2.1.318", "claude"],
  codex: ["@openai/codex", "0.166.0", "codex"],
  opencode: ["opencode-ai", "1.19.5", "opencode"],
  pi: ["@mariozechner/pi-coding-agent", "0.73.1", "pi"],
} as const;
const routes: Choice[] = [
  { agent: "claude-code", provider: "anthropic" },
  { agent: "codex", provider: "openai" },
  { agent: "opencode", provider: "anthropic" },
  { agent: "opencode", provider: "openai" },
  { agent: "pi", provider: "anthropic" },
  { agent: "pi", provider: "openai" },
];
async function listen(server: http.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}
async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function stopProcessGroup(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
async function install(agent: keyof typeof tools): Promise<string> {
  const [pkg, version] = tools[agent];
  const prefix = path.join(root, agent);
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(prefix, "node_modules", pkg, "package.json"), "utf8"),
    );
    const ready = await fs.readFile(path.join(prefix, ".installed-version"), "utf8");
    if (manifest.version === version && ready === `${pkg}@${version}`) {
      return path.join(prefix, "node_modules", ".bin");
    }
  } catch {
    /* Missing or incomplete installs are recreated below. */
  }
  await fs.mkdir(prefix, { recursive: true });
  await fs.writeFile(path.join(prefix, "package.json"), '{"private":true}');
  // Agent installers are isolated from the repository's own package manifest.
  // Only the pinned CLIs and their known native dependencies need build hooks.
  await fs.writeFile(
    path.join(prefix, "pnpm-workspace.yaml"),
    [
      "allowBuilds:",
      `  '${pkg}': true`,
      "  esbuild: true",
      "  koffi: true",
      "  protobufjs: false",
      "  '@google/genai': false",
      "",
    ].join("\n"),
  );
  await execute("pnpm", [
    "--dir",
    prefix,
    "--workspace-root",
    "add",
    "--save-exact",
    `${pkg}@${version}`,
  ]);
  await fs.writeFile(path.join(prefix, ".installed-version"), `${pkg}@${version}`);
  return path.join(prefix, "node_modules", ".bin");
}
function provider(seen: Array<{ url: string; headers: http.IncomingHttpHeaders }>): http.Server {
  return http.createServer(async (req, res) => {
    const buffers: Buffer[] = [];
    for await (const data of req) buffers.push(Buffer.from(data));
    const body = JSON.parse(Buffer.concat(buffers).toString() || "{}");
    seen.push({ url: req.url!, headers: req.headers });
    const url = req.url!.split("?")[0];
    if (url.endsWith("/count_tokens")) {
      res.end('{"input_tokens":1}');
      return;
    }
    if (url.endsWith("/models")) {
      res.end('{"object":"list","data":[{"id":"test-model"}]}');
      return;
    }
    const sse = (events: unknown[], named = false) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of events) {
        if (named) res.write(`event: ${(event as { type: string }).type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    };
    if (url.endsWith("/messages")) {
      const message = {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: reply }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      if (!body.stream) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(message));
        return;
      }
      sse(
        [
          { type: "message_start", message: { ...message, content: [], stop_reason: null } },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ],
        true,
      );
      return;
    }
    if (url.endsWith("/responses")) {
      const item = {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: reply, annotations: [] }],
      };
      const response = {
        id: "resp_test",
        object: "response",
        created_at: 0,
        status: "completed",
        model: body.model,
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      if (!body.stream) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(response));
        return;
      }
      sse(
        [
          {
            type: "response.created",
            response: { ...response, status: "in_progress", output: [] },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] },
          },
          {
            type: "response.content_part.added",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: reply,
          },
          {
            type: "response.output_text.done",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            text: reply,
          },
          {
            type: "response.content_part.done",
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: item.content[0],
          },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response },
        ].map((event, sequence_number) => ({ ...event, sequence_number })),
      );
      return;
    }
    if (url.endsWith("/chat/completions")) {
      const base = {
        id: "chatcmpl_test",
        object: "chat.completion.chunk",
        created: 0,
        model: body.model,
      };
      sse([
        {
          ...base,
          choices: [
            { index: 0, delta: { role: "assistant", content: reply }, finish_reason: null },
          ],
        },
        {
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]);
      return;
    }
    res.writeHead(404);
    res.end("Unknown local provider endpoint");
  });
}
async function run(choice: Choice): Promise<void> {
  const agent = choice.agent as keyof typeof tools;
  const bin = await install(agent);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "logger-real-agent-"));
  const home = path.join(scratch, "home");
  await fs.mkdir(home);
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const upstream = provider(seen);
  const upstreamPort = await listen(upstream);
  const probe = http.createServer();
  const port = await listen(probe);
  await close(probe);
  const target = resolveTarget(choice, port);
  const captures: string[] = [];
  const gateway = createGateway({
    target,
    directory: path.join(scratch, "captures"),
    override: new URL(`http://127.0.0.1:${upstreamPort}`),
    onCapture: (file) => captures.push(file),
  });
  await new Promise<void>((resolve) => gateway.listen(port, "127.0.0.1", resolve));
  let success = false;
  try {
    for (const file of target.files) {
      const dest = path.join(home, file.path.slice(2));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.content);
    }
    if (agent === "codex") {
      await fs.mkdir(path.join(home, ".codex"), { recursive: true });
      await fs.writeFile(
        path.join(home, ".codex/auth.json"),
        JSON.stringify({ OPENAI_API_KEY: key }),
      );
    }
    if (agent === "opencode") {
      const dest = path.join(home, ".config/opencode/opencode.json");
      const config = JSON.parse(await fs.readFile(dest, "utf8"));
      const model =
        choice.provider === "anthropic" ? "anthropic/claude-sonnet-4-5" : "openai/gpt-4o";
      await fs.writeFile(dest, JSON.stringify({ ...config, model, small_model: model }));
    }
    const prompt = "Reply with a greeting.";
    const args =
      agent === "codex"
        ? ["exec", "--skip-git-repo-check", prompt]
        : agent === "opencode"
          ? ["--print-logs", "--log-level", "DEBUG", "run", prompt]
          : agent === "pi"
            ? [
                "--provider",
                choice.provider,
                "--model",
                choice.provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5",
                "--no-extensions",
                "--no-skills",
                "--no-prompt-templates",
                "--no-themes",
                "-p",
                prompt,
              ]
            : ["-p", prompt];
    const child = spawn("bash", ["-c", `${target.command} ${args.map(shellArgument).join(" ")}`], {
      cwd: scratch,
      detached: true,
      env: {
        PATH: bin + path.delimiter + process.env.PATH,
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        PI_CODING_AGENT_DIR: path.join(home, ".pi/agent"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local/share"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        XDG_STATE_HOME: path.join(home, ".local/state"),
        ANTHROPIC_API_KEY: key,
        OPENAI_API_KEY: key,
        TERM: "dumb",
        NO_COLOR: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_ERROR_REPORTING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const timeout = setTimeout(() => {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    }, 90_000);
    let exit: number | null;
    try {
      [exit] = await once(child, "exit");
    } finally {
      clearTimeout(timeout);
      // Some CLIs leave plugin installers running after their main process exits.
      // Stop the isolated process group before removing its temporary home.
      stopProcessGroup(child.pid);
    }
    assert.equal(exit, 0, output.slice(-12000));
    assert(output.includes(reply), output.slice(-3000));
    for (let attempt = 0; captures.length === 0 && attempt < 50; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const content = (await Promise.all(captures.map((file) => fs.readFile(file, "utf8")))).join(
      "\n",
    );
    assert(content.includes(reply));
    assert(content.includes(prompt));
    assert(!content.includes(key));
    assert(content.includes("[REDACTED]"));
    assert(seen.some((request) => JSON.stringify(request.headers).includes(key)));
    console.log(`PASS ${agent}/${choice.provider}: real CLI, routing, auth, streaming and capture`);
    success = true;
  } finally {
    await close(gateway);
    await close(upstream);
    if (success)
      await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    else console.error(`Failure artifacts: ${scratch}`);
  }
}
const filters = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const selected = routes.filter(
  (route) =>
    !filters.length ||
    filters.some((filter) => `${route.agent}/${route.provider}`.startsWith(filter)),
);
assert(selected.length, "No matching agent route");
for (const choice of selected) await run(choice);
