import { LoggerError, formatError } from "./errors.js";
import fs from "node:fs/promises";
import { locations, readPreference, writePreference } from "./preferences.js";
import { choose } from "./wizard.js";
import { resolveTarget, upstreamUrl } from "./targets.js";
import { createGateway } from "./gateway.js";

export async function main(): Promise<void> {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
  const paths = locations(process.env);
  const force = process.argv.includes("--force");
  if (force) await fs.rm(paths.preferenceFile, { force: true });
  let choice = force ? undefined : await readPreference(paths.preferenceFile);
  let target;
  if (choice) {
    try { target = resolveTarget(choice, port); }
    catch (error) { console.warn(formatError(new LoggerError("SETUP_FAILED", "Saved setup could not be loaded; choose a setup again.", error))); }
  }
  if (!target) {
    const selected = await choose(force || !!choice);
    if (!selected) return;
    choice = selected.choice;
    target = resolveTarget(choice, port);
    if (selected.remember) {
      try { await writePreference(paths.preferenceFile, choice); }
      catch (error) { console.warn(formatError(new LoggerError("PREFERENCES_FAILED", "Could not remember the setup.", error))); }
    }
  }
  const override = process.env.REQUEST_LOGGER_TEST_UPSTREAM ? upstreamUrl(process.env.REQUEST_LOGGER_TEST_UPSTREAM) : undefined;
  if (override && override.pathname !== "/") throw new Error("Test upstream must be an origin without a path.");
  const server = createGateway({ target, directory: paths.logDir, override,
    onCapture: file => console.log(`Captured ${file}`),
    onError: error => console.error(formatError(error, process.env.REQUEST_LOGGER_DEBUG === "1")),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", error => reject(new LoggerError("LISTEN_FAILED", `Cannot listen on 127.0.0.1:${port}. Use --port to choose another port.`, error)));
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`\n${target.name}\nListening: http://localhost:${port}\nUpstream: ${target.upstream}\nCaptures: ${paths.logDir}`);
  if (override) console.log(`TEST UPSTREAM OVERRIDE: ${override}`);
  for (const file of target.files) console.log(`\nMerge into ${file.path}:\n${file.content}`);
  console.log(`\nRun in another terminal:\n\n${target.command}\n`);
  for (const hint of target.hints) console.log(hint);
  console.log("\nCtrl+C stops the logger. Use --force to choose another setup.");
}
