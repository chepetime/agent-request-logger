#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

try {
  const { values } = parseArgs({
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
  if (values.help) {
    console.log(`Usage: agent-request-logger [options]

Inspect the HTTP requests your coding agent sends to its model provider.

  --debug              Include stack traces in error reports
  --force              Choose your agent and provider again
  --port <number>      Local port (default: PORT or 8787)
  --log-dir <path>      Capture directory (default: ./request-logger-logs)
  --config-dir <path>   Preferences directory (default: ~/.agent-request-logger)
  -h, --help           Show this help
  -v, --version        Show the version

Start this command, then launch your agent using the command it prints.
Press Ctrl+C to stop.`);
  } else if (values.version) {
    console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version);
  } else {
    const port = values.port ?? process.env.PORT ?? "8787";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("Port must be an integer between 1 and 65535.");
    }
    process.env.PORT = port;
    if (values.debug) process.env.REQUEST_LOGGER_DEBUG = "1";
    if (values["log-dir"]) process.env.REQUEST_LOGGER_LOG_DIR = values["log-dir"];
    if (values["config-dir"]) process.env.REQUEST_LOGGER_CONFIG_DIR = values["config-dir"];
    const { main } = await import("../dist/main.js");
    await main();
  }
} catch (error) {
  const { formatError } = await import("../dist/errors.js").catch(() => ({
    formatError: (error) => error.message,
  }));
  console.error(
    formatError(
      error,
      process.env.REQUEST_LOGGER_DEBUG === "1" || process.argv.includes("--debug"),
    ),
  );
  process.exitCode = 1;
}
