import type { StartOptions } from "./cli.js";
import { formatError, LoggerError } from "./errors.js";
import { createGateway, type Gateway } from "./gateway.js";
import { readPreference, writePreference } from "./preferences.js";
import { resolveTarget, type Target } from "./targets.js";
import { choose } from "./wizard.js";

/** Grace period for capture writes after Ctrl+C before the process gives up. */
const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Choose a setup, start the proxy, and resolve after a shutdown signal once
 * open streams are recorded. Resolves immediately when setup is cancelled.
 */
export async function start(options: StartOptions): Promise<void> {
  const target = await selectTarget(options);
  if (!target) return;

  const gateway = createGateway({
    target,
    directory: options.logDir,
    override: options.testUpstream,
    onCapture: (file) => console.log(`Captured ${file}`),
    onError: (error) => console.error(formatError(error, options.debug)),
  });
  await listen(gateway, options.port);
  printInstructions(target, options);
  await stopOnSignal(gateway);
}

async function selectTarget(options: StartOptions): Promise<Target | undefined> {
  // --force ignores the saved setup but keeps it until a new one replaces it,
  // so cancelling the wizard never loses a working configuration.
  const saved = options.force ? undefined : await readPreference(options.preferenceFile);
  if (saved) {
    try {
      return resolveTarget(saved, options.port);
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

  const selected = await choose(options.force || !!saved);
  if (!selected) return;
  const target = resolveTarget(selected.choice, options.port);
  if (selected.remember) {
    try {
      await writePreference(options.preferenceFile, selected.choice);
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

async function listen(gateway: Gateway, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    gateway.server.once("error", (error) =>
      reject(
        new LoggerError(
          "LISTEN_FAILED",
          `Cannot listen on 127.0.0.1:${port}. Use --port to choose another port.`,
          error,
        ),
      ),
    );
    gateway.server.listen(port, "127.0.0.1", resolve);
  });
}

function stopOnSignal(gateway: Gateway): Promise<void> {
  return new Promise((resolve) => {
    const stop = (signal: NodeJS.Signals) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      // A second signal exits at once, even if a capture write is stuck.
      process.once(signal, () => process.exit(130));
      console.log("\nStopping; saving open captures…");
      const timeout = setTimeout(() => {
        console.error("Capture writes did not finish in time; some files may be missing.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      timeout.unref();
      void gateway.close().then(() => {
        clearTimeout(timeout);
        resolve();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function printInstructions(target: Target, options: StartOptions): void {
  console.log(
    `\n${target.name}\nListening: http://127.0.0.1:${options.port}\nUpstream: ${target.upstream}\nCaptures: ${options.logDir}`,
  );
  if (options.testUpstream) console.log(`TEST UPSTREAM OVERRIDE: ${options.testUpstream}`);
  for (const file of target.files) console.log(`\nMerge into ${file.path}:\n${file.content}`);
  console.log(`\nRun in another terminal:\n\n${target.command}\n`);
  for (const hint of target.hints) console.log(hint);
  console.log("\nCtrl+C stops the logger. Use --force to choose another setup.");
}
