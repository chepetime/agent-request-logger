import fs from "node:fs/promises";
import type http from "node:http";
import { formatError, LoggerError } from "./errors.js";
import { createGateway } from "./gateway.js";
import { type Locations, locations, readPreference, writePreference } from "./preferences.js";
import { resolveTarget, type Target, upstreamUrl } from "./targets.js";
import { choose } from "./wizard.js";

export async function main(): Promise<void> {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
  const paths = locations(process.env);
  const target = await selectTarget(paths.preferenceFile, port, process.argv.includes("--force"));
  if (!target) return;

  const override = testUpstream();
  const server = createGateway({
    target,
    directory: paths.logDir,
    override,
    onCapture: (file) => console.log(`Captured ${file}`),
    onError: (error) => console.error(formatError(error, process.env.REQUEST_LOGGER_DEBUG === "1")),
  });
  await listen(server, port);
  printInstructions(target, paths, port, override);
}

async function selectTarget(
  preferenceFile: string,
  port: number,
  force: boolean,
): Promise<Target | undefined> {
  if (force) await fs.rm(preferenceFile, { force: true });
  const saved = force ? undefined : await readPreference(preferenceFile);
  if (saved) {
    try {
      return resolveTarget(saved, port);
    } catch (error) {
      console.warn(
        formatError(
          new LoggerError(
            "SETUP_FAILED",
            "Saved setup could not be loaded; choose a setup again.",
            error,
          ),
        ),
      );
    }
  }

  const selected = await choose(force || !!saved);
  if (!selected) return;
  const target = resolveTarget(selected.choice, port);
  if (selected.remember) {
    try {
      await writePreference(preferenceFile, selected.choice);
    } catch (error) {
      // Remembering is optional: an unwritable preference directory should not
      // prevent logging with the setup the user just selected.
      console.warn(
        formatError(new LoggerError("PREFERENCES_FAILED", "Could not remember the setup.", error)),
      );
    }
  }
  return target;
}

function testUpstream(): URL | undefined {
  const configured = process.env.REQUEST_LOGGER_TEST_UPSTREAM;
  if (!configured) return;
  const url = upstreamUrl(configured);
  if (url.pathname !== "/") throw new Error("Test upstream must be an origin without a path.");
  return url;
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new LoggerError(
          "LISTEN_FAILED",
          `Cannot listen on 127.0.0.1:${port}. Use --port to choose another port.`,
          error,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
}

function printInstructions(target: Target, paths: Locations, port: number, override?: URL): void {
  console.log(
    `\n${target.name}\nListening: http://localhost:${port}\nUpstream: ${target.upstream}\nCaptures: ${paths.logDir}`,
  );
  if (override) console.log(`TEST UPSTREAM OVERRIDE: ${override}`);
  for (const file of target.files) console.log(`\nMerge into ${file.path}:\n${file.content}`);
  console.log(`\nRun in another terminal:\n\n${target.command}\n`);
  for (const hint of target.hints) console.log(hint);
  console.log("\nCtrl+C stops the logger. Use --force to choose another setup.");
}
