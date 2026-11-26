import { readFileSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";
import { formatError } from "./errors.js";
import { locations } from "./preferences.js";
import { upstreamUrl } from "./targets.js";

/** Everything the logger needs to start, resolved once from argv and the environment. */
export interface StartOptions {
  port: number;
  logDir: string;
  preferenceFile: string;
  force: boolean;
  debug: boolean;
  /** Test-only origin that replaces the real provider. */
  testUpstream?: URL;
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "start"; options: StartOptions };

export const HELP = `Usage: agent-request-logger [options]

Inspect the HTTP requests your coding agent sends to its model provider.

  --port <number>      Local port (default: PORT or 8787)
  --log-dir <path>     Capture directory (default: ./request-logger-logs)
  --config-dir <path>  Preferences directory (default: ~/.agent-request-logger)
  --force              Choose your agent and provider again
  --debug              Include stack traces in error reports
  -h, --help           Show this help
  -v, --version        Show the version

Start this command, then launch your agent using the command it prints.
Press Ctrl+C to stop.`;

export interface Environment {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
}

/** Pure: the only place that reads flags and environment variables. */
export function parseCommand({ argv, env, cwd, home }: Environment): Command {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      debug: { type: "boolean" },
      force: { type: "boolean" },
      port: { type: "string" },
      "log-dir": { type: "string" },
      "config-dir": { type: "string" },
    },
  });
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const paths = locations(
    {
      logDir: values["log-dir"] || env.REQUEST_LOGGER_LOG_DIR,
      configDir: values["config-dir"] || env.REQUEST_LOGGER_CONFIG_DIR,
    },
    cwd,
    home,
  );
  return {
    kind: "start",
    options: {
      port: parsePort(values.port ?? (env.PORT || "8787")),
      ...paths,
      force: values.force ?? false,
      debug: (values.debug ?? false) || env.REQUEST_LOGGER_DEBUG === "1",
      testUpstream: testUpstream(env.REQUEST_LOGGER_TEST_UPSTREAM),
    },
  };
}

function parsePort(text: string): number {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535.");
  }
  return port;
}

function testUpstream(configured: string | undefined): URL | undefined {
  if (!configured) return;
  const url = upstreamUrl(configured);
  if (url.pathname !== "/") throw new Error("Test upstream must be an origin without a path.");
  return url;
}

export function version(): string {
  return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
}

/** Run the CLI and return its exit code. Errors become readable diagnostics. */
export async function run(
  environment: Environment = {
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    home: os.homedir(),
  },
): Promise<number> {
  let debug = environment.argv.includes("--debug") || environment.env.REQUEST_LOGGER_DEBUG === "1";
  try {
    const command = parseCommand(environment);
    if (command.kind === "help") console.log(HELP);
    else if (command.kind === "version") console.log(version());
    else {
      debug = command.options.debug;
      // Load the server and prompt modules only when the logger actually starts.
      const { start } = await import("./main.js");
      await start(command.options);
    }
    return 0;
  } catch (error) {
    console.error(formatError(error, debug));
    return 1;
  }
}
